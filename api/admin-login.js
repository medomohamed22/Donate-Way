const {cookie,makeAdminToken,verifyPi,syncPiUser}=require('./_backend.cjs');
module.exports=async function(req,res){res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Vary','Cookie');
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  try{
    const user=await verifyPi(req.body?.accessToken);
    if(!user)return res.status(401).json({error:'Pi authentication failed'});
    const row=await syncPiUser(user);
    if(!row||row.is_admin!==true)return res.status(403).json({error:'This Pi account is not an admin'});
    const maxAge=30*24*3600;
    const adminToken=makeAdminToken(row,maxAge);
    res.setHeader('Set-Cookie',cookie(adminToken,maxAge));
    // The HttpOnly cookie remains the primary session mechanism. The token is also returned
    // as a same-origin fallback because some Pi Browser/WebView builds can reject or drop
    // Set-Cookie between serverless requests. admin.html keeps it in sessionStorage only.
    return res.status(200).json({session:{authenticated:true,expires_in:maxAge,token:adminToken},user:{id:row.pi_uid,pi_uid:row.pi_uid,username:row.username,is_admin:true}});
  }catch(e){return res.status(500).json({error:e.message||'Login failed'})}
};
