const {verifyPi,syncPiUser,userCookie,makeUserToken,getUserSession}=require('./_backend.cjs');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Vary','Cookie');
  try{
    if(req.method==='GET'){
      const user=getUserSession(req);
      if(!user)return res.status(401).json({authenticated:false,user:null});
      return res.status(200).json({authenticated:true,user:{pi_uid:user.uid,username:user.username}});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
    const user=await verifyPi(req.body?.accessToken);
    if(!user)return res.status(401).json({error:'Pi authentication failed'});
    const row=await syncPiUser(user);
    const maxAge=30*24*3600;
    res.setHeader('Set-Cookie',userCookie(makeUserToken(row||user,maxAge),maxAge));
    return res.status(200).json({authenticated:true,user:{pi_uid:row?.pi_uid||user.uid,username:row?.username||user.username,is_admin:row?.is_admin===true}});
  }catch(e){return res.status(500).json({error:e?.message||'User sync failed'})}
};
