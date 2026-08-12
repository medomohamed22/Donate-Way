const {env,fetchWithTimeout}=require('../../lib/backend.cjs');
module.exports=async function(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method Not Allowed'});
  const out={ok:false,environment:false,pi_users:false};
  try{
    const {url,key}=env(); out.environment=Boolean(url&&key);
    const r=await fetchWithTimeout(`${url}/rest/v1/pi_users?select=pi_uid,username,is_admin,last_login_at&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}},8000);
    out.pi_users=r.ok;
    if(!r.ok)out.database_error=(await r.text()).slice(0,300);
    out.ok=out.environment&&out.pi_users;
    return res.status(out.ok?200:500).json(out);
  }catch(e){out.error=String(e?.message||e);return res.status(500).json(out)}
};
