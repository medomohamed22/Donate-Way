const {cookie}=require('./_backend.cjs');
module.exports=async function(req,res){if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});res.setHeader('Set-Cookie',cookie('',0));return res.status(200).json({ok:true})};
