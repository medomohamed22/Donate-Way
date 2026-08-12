const {verifyPi,syncPiUser}=require('./_backend.cjs');
module.exports=async function(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  try{
    const user=await verifyPi(req.body?.accessToken);
    if(!user)return res.status(401).json({error:'Pi authentication failed'});
    const row=await syncPiUser(user);
    return res.status(200).json({user:{pi_uid:row.pi_uid,username:row.username,is_admin:row.is_admin===true}});
  }catch(e){return res.status(500).json({error:e.message||'User sync failed'})}
};
