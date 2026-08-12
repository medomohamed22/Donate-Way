const {getAdmin}=require('./_shared.cjs');
module.exports=async function(req,res){if(req.method!=='GET')return res.status(405).json({error:'Method Not Allowed'});const a=await getAdmin(req);if(!a)return res.status(401).json({error:'Unauthorized',session:null});return res.status(200).json({session:{authenticated:true},user:{id:a.user.id,email:a.user.email}})};
