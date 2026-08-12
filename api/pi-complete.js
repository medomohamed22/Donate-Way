const {verifyPi,fetchWithTimeout}=require('./_backend.cjs');

async function getPayment(paymentId,key){
  const r=await fetchWithTimeout(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Key ${key}`}},10000);
  if(!r.ok)throw new Error(`Pi payment lookup failed (${r.status})`);
  return r.json();
}
function fields(raw){
  const p=raw?.payment||raw||{},tx=p.transaction||raw?.transaction||{};
  return {amount:Number(p.amount),metadata:p.metadata||{},userUid:p.user_uid||p.user?.uid||null,txid:tx.txid||null,txVerified:tx.verified===true,direction:p.direction||null,status:p.status||{}};
}
function validatePayment(p,user,txid,{requireCompleted=false}={}){
  if(p.userUid&&String(p.userUid)!==String(user.uid))return 'Payment does not belong to authenticated Pi user';
  if(p.direction&&p.direction!=='user_to_app')return 'Invalid payment direction';
  if(p.status?.cancelled||p.status?.user_cancelled)return 'Payment is cancelled';
  if(p.txid&&String(p.txid)!==String(txid))return 'Transaction id mismatch';
  if(requireCompleted){
    if(p.status?.transaction_verified!==true&&p.txVerified!==true)return 'Pi transaction is not verified';
    if(p.status?.developer_completed!==true)return 'Pi payment is not developer-completed';
  }
  return null;
}
async function recordDonation({paymentId,txid,user,amount,campaignId,isAnonymous}){
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!base||!key)throw new Error('Supabase backend environment is not configured');
  const r=await fetchWithTimeout(`${base}/rest/v1/rpc/record_pi_donation`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_payment_id:paymentId,p_txid:txid,p_pi_user_id:user.uid,p_username:user.username,p_amount:amount,p_campaign_id:campaignId,p_is_anonymous:Boolean(isAnonymous)})},10000);
  if(!r.ok){const detail=await r.text();throw new Error(`Verified payment could not be recorded: ${detail.slice(0,300)}`)}
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  const {paymentId,txid,accessToken,isAnonymous=false}=req.body||{};
  if(!paymentId||!txid)return res.status(400).json({error:'Missing paymentId or txid'});
  if(!accessToken)return res.status(401).json({error:'Pi authentication is required'});
  const key=process.env.PI_SECRET_KEY;
  if(!key)return res.status(500).json({error:'PI_SECRET_KEY is not configured'});
  try{
    const user=await verifyPi(accessToken);
    if(!user)return res.status(401).json({error:'Pi authentication failed'});
    let p=fields(await getPayment(paymentId,key));
    let invalid=validatePayment(p,user,txid);
    if(invalid)return res.status(409).json({error:invalid});

    // Pi callbacks can be retried. If Pi already marks the payment complete, do not call /complete again;
    // simply verify it and idempotently persist the donation.
    if(p.status?.developer_completed!==true){
      const complete=await fetchWithTimeout(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`,{method:'POST',headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'},body:JSON.stringify({txid})},10000);
      const completeBody=await complete.json().catch(()=>({}));
      if(!complete.ok)return res.status(complete.status).json({error:completeBody?.error||completeBody?.message||'Pi completion failed'});
      p=fields(completeBody);
      // Some API responses may be wrapped/minimal; fetch the canonical PaymentDTO if needed.
      if(!p.status?.developer_completed||!p.txid)p=fields(await getPayment(paymentId,key));
    }

    invalid=validatePayment(p,user,txid,{requireCompleted:true});
    if(invalid)return res.status(409).json({error:invalid});
    const campaignId=Number(p.metadata?.campaignId),amount=p.amount;
    if(!Number.isFinite(amount)||amount<=0||!Number.isInteger(campaignId)||campaignId<=0)return res.status(400).json({error:'Completed payment data is invalid'});
    const max=Number(process.env.MAX_DONATION_PI||0);
    if(max>0&&amount>max)return res.status(400).json({error:'Donation amount exceeds server limit'});
    await recordDonation({paymentId,txid,user,amount,campaignId,isAnonymous});
    return res.status(200).json({completed:true,recorded:true,paymentId,txid,amount,campaignId});
  }catch(e){return res.status(500).json({error:e.message||'Completion failed'})}
};
