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
async function latestDonation(user,campaignId){
  const q={columns:'amount,is_anonymous',filters:[{type:'eq',column:'campaign_id',value:campaignId}],orders:[{column:'id',ascending:false}],limit:1,single:true};
  return restSelect('donations',q,[{type:'eq',column:'pi_user_id',value:user.uid}]);
}

module.exports = async function handler(req,res){
  try{
    if(req.method==='GET'){
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
    const q=req.body||{}; const table=q.table;
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
