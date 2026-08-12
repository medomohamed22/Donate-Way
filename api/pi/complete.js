async function verifyPiUser(accessToken){
  if(!accessToken) throw new Error('Pi authentication is required');
  const r=await fetch('https://api.minepi.com/v2/me',{headers:{Authorization:`Bearer ${accessToken}`}}); if(!r.ok)throw new Error(`Pi user authentication failed (${r.status})`);
  const j=await r.json(); const u=j?.user||j; if(!u?.uid)throw new Error('Pi user identity is invalid'); return{uid:String(u.uid),username:String(u.username||'pi-user')};
}
async function getPayment(paymentId,key){const r=await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Key ${key}`}});if(!r.ok)throw new Error(`Pi payment lookup failed (${r.status})`);return r.json()}
function fields(raw){const p=raw?.payment||raw||{};const tx=p.transaction||raw?.transaction||{};return{amount:Number(p.amount),metadata:p.metadata||{},userUid:p.user_uid||p.user?.uid||null,txid:tx.txid||null,txVerified:tx.verified===true,direction:p.direction||null,network:p.network||null,status:p.status||{}}}
async function recordDonation({paymentId,txid,user,amount,campaignId,isAnonymous}){
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';if(!base||!key)throw new Error('Supabase backend environment is not configured');
  const r=await fetch(`${base}/rest/v1/rpc/record_pi_donation`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_payment_id:paymentId,p_txid:txid,p_pi_user_id:user.uid,p_username:user.username,p_amount:amount,p_campaign_id:campaignId,p_is_anonymous:Boolean(isAnonymous)})});
  if(!r.ok){const detail=await r.text();throw new Error(`Verified payment could not be recorded: ${detail.slice(0,300)}`)}
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  const {paymentId,txid,accessToken,isAnonymous=false}=req.body||{}; if(!paymentId||!txid)return res.status(400).json({error:'Missing paymentId or txid'}); if(!accessToken)return res.status(401).json({error:'Pi authentication is required'});
  const key=process.env.PI_SECRET_KEY;if(!key)return res.status(500).json({error:'PI_SECRET_KEY is not configured'});
  try{
    const verifiedUser=await verifyPiUser(accessToken);
    const before=fields(await getPayment(paymentId,key));
    if(before.userUid&&String(before.userUid)!==verifiedUser.uid)return res.status(403).json({error:'Payment does not belong to authenticated Pi user'});
    if(before.direction&&before.direction!=='user_to_app')return res.status(409).json({error:'Invalid payment direction'});
    if(before.status?.cancelled||before.status?.user_cancelled)return res.status(409).json({error:'Payment is cancelled'});
    const complete=await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`,{method:'POST',headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'},body:JSON.stringify({txid})});
    const completeBody=await complete.json().catch(()=>({})); if(!complete.ok)return res.status(complete.status).json({error:completeBody?.error||'Pi completion failed'});
    const p=fields(await getPayment(paymentId,key)); const campaignId=Number(p.metadata?.campaignId); const amount=p.amount;
    if(!Number.isFinite(amount)||amount<=0||!Number.isInteger(campaignId)||campaignId<=0)return res.status(400).json({error:'Completed payment data is invalid'});
    if(p.txid&&String(p.txid)!==String(txid))return res.status(409).json({error:'Transaction id mismatch'});
    if(p.userUid&&String(verifiedUser.uid)!==String(p.userUid))return res.status(403).json({error:'Payment does not belong to authenticated Pi user'});
    if(p.direction&&p.direction!=='user_to_app')return res.status(409).json({error:'Invalid payment direction'});
    if(p.status?.cancelled||p.status?.user_cancelled)return res.status(409).json({error:'Payment is cancelled'});
    if(p.status?.transaction_verified!==true && p.txVerified!==true)return res.status(409).json({error:'Pi transaction is not verified'});
    if(p.status?.developer_completed!==true)return res.status(409).json({error:'Pi payment is not developer-completed'});
    await recordDonation({paymentId,txid,user:verifiedUser,amount,campaignId,isAnonymous});
    return res.status(200).json({completed:true,recorded:true,paymentId,txid,amount,campaignId});
  }catch(e){return res.status(500).json({error:e.message||'Completion failed'})}
};
