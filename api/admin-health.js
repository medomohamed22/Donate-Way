module.exports=async function(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method Not Allowed'});
  const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  const sessionConfigured=Boolean(process.env.ADMIN_SESSION_SECRET||process.env.PI_SECRET_KEY);
  if(!url||!key)return res.status(500).json({ok:false,environment:false,pi_users:false,session_secret:sessionConfigured,error:'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'});
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),8000);
  try{
    const r=await fetch(`${url}/rest/v1/pi_users?select=pi_uid,username,is_admin&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:c.signal});
    const raw=await r.text();
    if(!r.ok)return res.status(500).json({ok:false,environment:true,pi_users:false,session_secret:sessionConfigured,status:r.status,error:raw.slice(0,500)});
    return res.status(200).json({ok:true,environment:true,pi_users:true,session_secret:sessionConfigured});
  }catch(e){return res.status(500).json({ok:false,environment:true,pi_users:false,session_secret:sessionConfigured,error:e?.name==='AbortError'?'Supabase health check timed out':String(e?.message||e)})}
  finally{clearTimeout(t)}
};
