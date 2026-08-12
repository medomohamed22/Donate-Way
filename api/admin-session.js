const {getAdmin,cookie}=require('./_backend.cjs');
module.exports=async function(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Vary','Cookie');
  if(req.method!=='GET')return res.status(405).json({error:'Method Not Allowed'});
  try{
    const a=await getAdmin(req);
    if(!a){
      res.setHeader('Set-Cookie',cookie('',0));
      return res.status(401).json({error:'Unauthorized',code:'ADMIN_SESSION_INVALID',session:null});
    }
    return res.status(200).json({session:{authenticated:true},user:{id:a.user.pi_uid,pi_uid:a.user.pi_uid,username:a.user.username,is_admin:true}});
  }catch(e){return res.status(500).json({error:e.message||'Session check failed',session:null})}
};
