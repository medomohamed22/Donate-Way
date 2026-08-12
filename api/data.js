const crypto = require('crypto');
const ALLOWED_TABLES = new Set(['campaigns','campaign_updates','donations','campaign_follows','campaign_comments']);
const SAFE_DONATION_FIELDS = new Set(['id','pi_user_id','username','amount','campaign_id','is_anonymous','created_at']);
const SAFE_OWN_DONATION_FIELDS = new Set([...SAFE_DONATION_FIELDS,'payment_id','txid']);

function env(){
  const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!url||!key) throw new Error('Supabase backend environment is not configured');
  return {url,key};
}
function headers(extra={}){const {key}=env();return {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra}}
function safeIdent(v){return typeof v==='string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)}
function val(v){return encodeURIComponent(String(v))}
async function verifyPi(accessToken){
  if(!accessToken) return null;
  const r=await fetch('https://api.minepi.com/v2/me',{headers:{Authorization:`Bearer ${accessToken}`}});
  if(!r.ok) return null;
  const j=await r.json().catch(()=>null); const u=j?.user||j;
  return u?.uid ? {uid:String(u.uid),username:String(u.username||'pi-user')} : null;
}
function buildQuery(table,q,forcedFilters=[]){
  const {url}=env();
  const params=new URLSearchParams();
  params.set('select', typeof q.columns==='string' && q.columns.trim() ? q.columns : '*');
  const filters=[...(Array.isArray(q.filters)?q.filters:[]),...forcedFilters];
  for(const f of filters){
    if(!safeIdent(f.column)) continue;
    if(f.type==='eq') params.append(f.column,`eq.${String(f.value)}`);
    if(f.type==='in' && Array.isArray(f.values)) params.append(f.column,`in.(${f.values.map(x=>String(x).replace(/[(),]/g,'')).join(',')})`);
  }
  if(Array.isArray(q.orders)&&q.orders.length){
    const parts=q.orders.filter(o=>safeIdent(o.column)).map(o=>`${o.column}.${o.ascending===false?'desc':'asc'}`);
    if(parts.length) params.set('order',parts.join(','));
  }
  if(q.limit !== null && q.limit !== undefined && q.limit !== '' && Number.isFinite(Number(q.limit))) params.set('limit',String(Math.max(1,Math.min(5000,Number(q.limit)))));
  return `${url}/rest/v1/${table}?${params.toString()}`;
}
async function restSelect(table,q,forcedFilters=[]){
  const explicitLimit = q.limit !== null && q.limit !== undefined && q.limit !== '' && Number.isFinite(Number(q.limit));
  if(q.single || explicitLimit){
    const r=await fetch(buildQuery(table,q,forcedFilters),{headers:headers()});
    if(!r.ok) throw new Error(await r.text());
    let data=await r.json();
    if(q.single) data=Array.isArray(data)?(data[0]||null):data;
    return data;
  }

  // No limit requested: page through PostgREST so the frontend gets the complete dataset,
  // even when Supabase's API row cap is lower than the total number of records.
  const pageSize=1000; const all=[]; let from=0;
  while(true){
    const r=await fetch(buildQuery(table,{...q,limit:null},forcedFilters),{headers:headers({Range:`${from}-${from+pageSize-1}`,'Range-Unit':'items'})});
    if(!r.ok) throw new Error(await r.text());
    const page=await r.json();
    if(!Array.isArray(page)) return page;
    all.push(...page);
    if(page.length<pageSize) break;
    from+=pageSize;
    if(from>100000) throw new Error('Dataset is too large to load safely');
  }
  return all;
}
async function restWrite(table,q,method,forcedFilters=[]){
  let url=buildQuery(table,{...q,columns:'*'},forcedFilters);
  if(q.onConflict&&typeof q.onConflict==='string') url += `&on_conflict=${encodeURIComponent(q.onConflict)}`;
  const prefer=['return=representation']; if(q.op==='upsert') prefer.push('resolution=merge-duplicates');
  const r=await fetch(url,{method,headers:headers({Prefer:prefer.join(',')}),body:method==='DELETE'?undefined:JSON.stringify(q.values)});
  if(!r.ok) throw new Error(await r.text());
  const text=await r.text(); let data=text?JSON.parse(text):[];
  if(q.single) data=Array.isArray(data)?(data[0]||null):data;
  return data;
}

function base64url(input){return Buffer.from(input).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function unbase64url(input){const s=String(input||'').replace(/-/g,'+').replace(/_/g,'/');return Buffer.from(s+'='.repeat((4-s.length%4)%4),'base64')}
function certificateSecret(){
  // Reuse an existing server-only secret so this feature does not require another Vercel env var.
  return String(process.env.ADMIN_SESSION_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY||'');
}
function signCertificateToken(payload){
  const secret=certificateSecret(); if(!secret) throw new Error('Certificate signing secret is not configured');
  const body=base64url(JSON.stringify(payload));
  const sig=base64url(crypto.createHmac('sha256',secret).update(body).digest());
  return body+'.'+sig;
}
function verifyCertificateToken(token){
  try{
    const [body,sig]=String(token||'').split('.'); if(!body||!sig) return null;
    const secret=certificateSecret(); if(!secret) return null;
    const expected=crypto.createHmac('sha256',secret).update(body).digest();
    const got=unbase64url(sig); if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected)) return null;
    const payload=JSON.parse(unbase64url(body).toString('utf8'));
    if(!payload?.uid||!payload?.campaignId||!payload?.exp||Date.now()>Number(payload.exp)) return null;
    return payload;
  }catch(e){return null}
}
function pdfEscape(value){return String(value??'').replace(/[^\x20-\x7E]/g,' ').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function centerX(text,size,W=842){return Math.max(38,(W-(String(text).length*size*0.5))/2)}
function wrapCertificateText(text,maxChars=58){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean), lines=[]; let line='';
  for(const word of words){const next=line?line+' '+word:word;if(next.length>maxChars&&line){lines.push(line);line=word}else line=next}
  if(line)lines.push(line); return lines.slice(0,3);
}
function buildCertificatePdfBuffer(data){
  const W=842,H=595;
  const donor=pdfEscape(data.donor||'Pi donor'), campaign=pdfEscape(data.campaign||'Donate Way campaign');
  const amount=(Number(data.amount)||0).toFixed(2)+' Pi', date=pdfEscape(data.date||'');
  const certId=pdfEscape(data.certificateId||'DW-CERT'), tx=pdfEscape(data.transactionId||'Not available');
  const display=data.isAnonymous?'Anonymous':'@'+donor, lines=wrapCertificateText(campaign,58), c=[];
  c.push('q','0.975 0.97 1 rg 0 0 842 595 re f','0.43 0.16 0.85 RG 4 w 24 24 794 547 re S','0.82 0.75 0.98 RG 1.2 w 34 34 774 527 re S','0.43 0.16 0.85 rg 62 520 718 3 re f','0.43 0.16 0.85 rg 62 72 718 3 re f');
  const text=(font,size,x,y,value,gray='0.08 0.10 0.16')=>c.push('BT',`/${font} ${size} Tf`,`${gray} rg`,`1 0 0 1 ${Number(x).toFixed(2)} ${Number(y).toFixed(2)} Tm`,`(${pdfEscape(value)}) Tj`,'ET');
  const centered=(font,size,y,value,gray)=>text(font,size,centerX(value,size,W),y,value,gray);
  centered('F2',27,474,'DONATE WAY','0.43 0.16 0.85'); centered('F2',18,438,'CERTIFICATE OF DONATION');
  centered('F1',10.5,414,'This certificate confirms a donation recorded from a server-verified Pi payment.','0.36 0.40 0.49');
  centered('F1',11,374,'Presented to','0.36 0.40 0.49'); centered('F2',25,340,'@'+donor,'0.08 0.10 0.16'); centered('F1',11,314,'for supporting','0.36 0.40 0.49');
  let y=281; for(const line of lines){centered('F2',16,y,line,'0.12 0.14 0.20');y-=20} centered('F2',26,218,amount,'0.43 0.16 0.85');
  c.push('0.92 0.90 0.98 rg 130 120 582 72 re f');
  text('F2',9.5,150,170,'DONATION DATE','0.36 0.40 0.49'); text('F1',10.5,150,151,date);
  text('F2',9.5,330,170,'PUBLIC DISPLAY','0.36 0.40 0.49'); text('F1',10.5,330,151,display);
  text('F2',9.5,520,170,'CERTIFICATE ID','0.36 0.40 0.49'); text('F1',9.3,520,151,certId);
  centered('F1',8.5,96,'Transaction reference: '+tx,'0.36 0.40 0.49'); centered('F1',8.5,52,"Generated by Donate Way from the donor's verified donation record.",'0.36 0.40 0.49'); c.push('Q');
  const stream=c.join('\n'); const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offsets=[0]; for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
  const xref=Buffer.byteLength(pdf,'latin1'); pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`; for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n'; pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'latin1');
}
async function certificateRecord(uid,campaignId){
  const dons=await restSelect('donations',{columns:'id,payment_id,txid,username,amount,campaign_id,is_anonymous,created_at',filters:[{type:'eq',column:'campaign_id',value:campaignId}],orders:[{column:'id',ascending:true}],limit:null,single:false},[{type:'eq',column:'pi_user_id',value:uid}]);
  if(!Array.isArray(dons)||!dons.length) return null;
  const campaign=await restSelect('campaigns',{columns:'id,title',filters:[{type:'eq',column:'id',value:campaignId}],orders:[],limit:1,single:true});
  const latest=dons[dons.length-1], total=dons.reduce((a,d)=>a+(Number(d.amount)||0),0), ref=String(latest.payment_id||latest.txid||latest.id||'record').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  return {donor:String(latest.username||'Pi donor'),campaign:String(campaign?.title||`Campaign #${campaignId}`),amount:total,date:new Date(latest.created_at||Date.now()).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),certificateId:`DW-${String(campaignId).padStart(4,'0')}-${String(latest.id||'0').padStart(6,'0')}-${ref.slice(-8)||'VERIFIED'}`,transactionId:String(latest.txid||latest.payment_id||'Recorded by Donate Way'),isAnonymous:dons.every(d=>d.is_anonymous===true)};
}

async function latestDonation(user,campaignId){
  const q={columns:'amount,is_anonymous',filters:[{type:'eq',column:'campaign_id',value:campaignId}],orders:[{column:'id',ascending:false}],limit:1,single:true};
  return restSelect('donations',q,[{type:'eq',column:'pi_user_id',value:user.uid}]);
}

module.exports = async function handler(req,res){
  try{
    if(req.method==='GET'){
      if(req.query?.certificate){
        const payload=verifyCertificateToken(req.query.certificate);
        if(!payload) return res.status(401).send('Certificate link is invalid or expired. Please generate a new certificate from Donate Way.');
        const record=await certificateRecord(String(payload.uid),Number(payload.campaignId));
        if(!record) return res.status(404).send('Verified donation record was not found.');
        const pdf=buildCertificatePdfBuffer(record);
        const filename=`Donate-Way-Certificate-${String(record.certificateId).replace(/[^a-zA-Z0-9_-]/g,'-')}.pdf`;
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
        res.setHeader('Content-Length',String(pdf.length));
        res.setHeader('Cache-Control','private, no-store, max-age=0');
        res.setHeader('X-Content-Type-Options','nosniff');
        return res.status(200).send(pdf);
      }
      const campsQ={columns:'*',filters:[],orders:[{column:'id',ascending:true}],limit:null,single:false};
      const donsQ={columns:'username,amount,campaign_id,is_anonymous',filters:[],orders:[],limit:null,single:false};
      const [allCamps,dons]=await Promise.all([restSelect('campaigns',campsQ),restSelect('donations',donsQ)]);
      const raised={}; const donors={}; let total=0;
      for(const d of Array.isArray(dons)?dons:[]){
        const amount=Number(d.amount)||0; total+=amount;
        const k=String(d.campaign_id??''); if(k)raised[k]=(raised[k]||0)+amount;
        const name=d.is_anonymous?'anonymous':String(d.username||'pi-user'); donors[name]=(donors[name]||0)+amount;
      }
      const campaigns=(Array.isArray(allCamps)?allCamps:[]).filter(c=>!['draft','suspended'].includes(String(c.status||'active'))).map(c=>({...c,current_amount:raised[String(c.id)]||0}));
      const donorStats=Object.entries(donors).map(([username,total])=>({username,total})).sort((a,b)=>b.total-a.total);
      const targetTotal=campaigns.reduce((a,c)=>a+(Number(c.target_amount)||0),0);
      res.setHeader('Cache-Control','public, s-maxage=10, stale-while-revalidate=30');
      return res.status(200).json({campaigns,donorStats,stats:{totalDonated:total,donationCount:Array.isArray(dons)?dons.length:0,targetTotal}});
    }
    if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});
    const q=req.body||{};
    if(q.op==='certificate_link'){
      const user=await verifyPi(q.accessToken);
      if(!user) return res.status(401).json({error:'Pi authentication required'});
      const campaignId=Number(q.campaignId);
      if(!Number.isInteger(campaignId)||campaignId<=0) return res.status(400).json({error:'Invalid campaign'});
      const record=await certificateRecord(user.uid,campaignId);
      if(!record) return res.status(404).json({error:'No verified donation was found for this campaign'});
      const token=signCertificateToken({uid:user.uid,campaignId,exp:Date.now()+2*60*1000});
      return res.status(200).json({url:`/api/data?certificate=${encodeURIComponent(token)}`,certificateId:record.certificateId});
    }
    const table=q.table;
    if(!ALLOWED_TABLES.has(table)) return res.status(403).json({error:'Table is not available'});
    const user=await verifyPi(q.accessToken);

    if(table==='campaigns' || table==='campaign_updates'){
      if(q.op!=='select') return res.status(403).json({error:'Read only'});
      let data=await restSelect(table,q);
      if(table==='campaigns' && Array.isArray(data)) data=data.filter(c=>!['draft','suspended'].includes(String(c.status||'active')));
      return res.status(200).json({data});
    }

    if(table==='donations'){
      if(q.op!=='select') return res.status(403).json({error:'Donations can only be created by verified payment completion'});
      const asksIdentity=(q.filters||[]).some(f=>f.column==='username'||f.column==='pi_user_id');
      let forced=[];
      if(asksIdentity){
        if(!user) return res.status(401).json({error:'Pi authentication required'});
        q.filters=(q.filters||[]).filter(f=>!['username','pi_user_id'].includes(f.column));
        forced=[{type:'eq',column:'pi_user_id',value:user.uid}];
      }
      let data=await restSelect(table,q,forced);
      const allowed=asksIdentity?SAFE_OWN_DONATION_FIELDS:SAFE_DONATION_FIELDS;
      const sanitize=d=>Object.fromEntries(Object.entries(d||{}).filter(([k])=>allowed.has(k)));
      data=Array.isArray(data)?data.map(sanitize):sanitize(data);
      return res.status(200).json({data});
    }

    if(table==='campaign_follows'){
      if(!user) return res.status(401).json({error:'Pi authentication required'});
      const campaignId=Number((q.values&&q.values.campaign_id) ?? (q.filters||[]).find(f=>f.column==='campaign_id')?.value);
      if(q.op==='select'){
        q.filters=(q.filters||[]).filter(f=>!['pi_user_id','username'].includes(f.column));
        const data=await restSelect(table,q,[{type:'eq',column:'pi_user_id',value:user.uid}]); return res.status(200).json({data});
      }
      if(!Number.isInteger(campaignId)||campaignId<=0) return res.status(400).json({error:'Invalid campaign'});
      if(q.op==='upsert'){
        const values={pi_user_id:user.uid,username:user.username,campaign_id:campaignId};
        const data=await restWrite(table,{...q,values,onConflict:'pi_user_id,campaign_id'},'POST'); return res.status(200).json({data});
      }
      if(q.op==='delete'){
        q.filters=(q.filters||[]).filter(f=>!['pi_user_id','username','campaign_id'].includes(f.column));
        const data=await restWrite(table,q,'DELETE',[{type:'eq',column:'pi_user_id',value:user.uid},{type:'eq',column:'campaign_id',value:campaignId}]); return res.status(200).json({data});
      }
      return res.status(403).json({error:'Operation not allowed'});
    }

    if(table==='campaign_comments'){
      if(q.op==='select'){
        q.filters=(q.filters||[]).filter(f=>f.column!=='status');
        const data=await restSelect(table,q,[{type:'eq',column:'status',value:'approved'}]); return res.status(200).json({data});
      }
      if(q.op==='insert'){
        if(!user) return res.status(401).json({error:'Pi authentication required'});
        const input=Array.isArray(q.values)?q.values[0]:q.values||{};
        const campaignId=Number(input.campaign_id); const message=String(input.message||'').trim().slice(0,280);
        if(!Number.isInteger(campaignId)||campaignId<=0||!message) return res.status(400).json({error:'Invalid comment'});
        const donation=await latestDonation(user,campaignId);
        if(!donation) return res.status(403).json({error:'A verified donation is required before posting a support message'});
        const values=[{campaign_id:campaignId,pi_user_id:user.uid,username:user.username,amount:Number(donation.amount)||0,message,is_anonymous:Boolean(donation.is_anonymous)||Boolean(input.is_anonymous),status:'pending'}];
        const data=await restWrite(table,{...q,values},'POST'); return res.status(200).json({data});
      }
      return res.status(403).json({error:'Operation not allowed'});
    }
  }catch(e){return res.status(500).json({error:e?.message||'Backend request failed'});}
};
