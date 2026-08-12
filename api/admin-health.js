const {env,headers,fetchWithTimeout}=require('./_backend.cjs');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method Not Allowed'});
  const sessionConfigured=Boolean(process.env.ADMIN_SESSION_SECRET||process.env.PI_SECRET_KEY);
  try{
    const {url}=env();
    const checks={};
    for(const table of ['pi_users','campaigns','donations']){
      const r=await fetchWithTimeout(`${url}/rest/v1/${table}?select=*&limit=1`,{headers:headers()},8000);
      checks[table]=r.ok;
      if(!r.ok)checks[`${table}_status`]=r.status;
    }
    const ok=sessionConfigured&&checks.pi_users&&checks.campaigns&&checks.donations;
    return res.status(ok?200:500).json({ok,environment:true,session_secret:sessionConfigured,...checks});
  }catch(e){
    return res.status(500).json({ok:false,environment:false,session_secret:sessionConfigured,error:String(e?.message||e)});
  }
};
