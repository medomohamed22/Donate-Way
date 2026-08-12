const {getAdmin,headers,buildQuery}=require('./_backend.cjs');
const TABLES=new Set(['campaigns','donations','campaign_updates','campaign_comments','admin_activity_logs','pi_users']);
async function selectAll(table,q){
  const explicitLimit=q.limit!==null&&q.limit!==undefined&&q.limit!==''&&Number.isFinite(Number(q.limit));
  if(q.single||explicitLimit){
    const r=await fetch(buildQuery(table,q),{headers:headers()});
    if(!r.ok)throw new Error(await r.text());
    let data=await r.json();
    if(q.single)data=Array.isArray(data)?(data[0]||null):data;
    return data;
  }
  const pageSize=1000,all=[];let from=0;
  while(true){
    const r=await fetch(buildQuery(table,{...q,limit:null}),{headers:headers({Range:`${from}-${from+pageSize-1}`,'Range-Unit':'items'})});
    if(!r.ok)throw new Error(await r.text());
    const page=await r.json();
    if(!Array.isArray(page))return page;
    all.push(...page);
    if(page.length<pageSize)break;
    from+=pageSize;
    if(from>100000)throw new Error('Dataset is too large to load safely');
  }
  return all;
}
module.exports=async function(req,res){try{if(!await getAdmin(req))return res.status(401).json({error:'Unauthorized'});if(req.method==='GET'){const campaignsQ={columns:'*',filters:[],orders:[{column:'created_at',ascending:false}],limit:null,single:false};const donationsQ={columns:'*',filters:[],orders:[{column:'id',ascending:false}],limit:null,single:false};const [campaigns,donations]=await Promise.all([selectAll('campaigns',campaignsQ),selectAll('donations',donationsQ)]);const raised={};for(const d of donations||[]){const k=String(d.campaign_id??'');if(k)raised[k]=(raised[k]||0)+(Number(d.amount)||0)}const ready=(campaigns||[]).map(c=>({...c,current_amount:raised[String(c.id)]||0}));res.setHeader('Cache-Control','private, no-store');return res.status(200).json({campaigns:ready,donations:donations||[]})}if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});const q=req.body||{},table=q.table;if(!TABLES.has(table))return res.status(403).json({error:'Table not allowed'});if(q.op==='select'){const data=await selectAll(table,q);return res.status(200).json({data})}let url=buildQuery(table,q);if(q.onConflict)url+=`&on_conflict=${encodeURIComponent(q.onConflict)}`;let method,body,prefer='return=representation';if(q.op==='insert'||q.op==='upsert'){method='POST';body=JSON.stringify(q.values);if(q.op==='upsert')prefer+=',resolution=merge-duplicates'}else if(q.op==='update'){method='PATCH';body=JSON.stringify(q.values)}else if(q.op==='delete'){method='DELETE'}else return res.status(400).json({error:'Invalid operation'});const r=await fetch(url,{method,headers:headers({Prefer:prefer}),body});if(!r.ok)return res.status(r.status).json({error:await r.text()});const text=await r.text();let data=text?JSON.parse(text):[];if(q.single)data=Array.isArray(data)?(data[0]||null):data;return res.status(200).json({data})}catch(e){return res.status(500).json({error:e.message||'Admin data request failed'})}};
