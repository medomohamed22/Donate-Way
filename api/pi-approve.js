const {verifyPi,fetchWithTimeout}=require('./_backend.cjs');

async function supabaseCampaign(campaignId){
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!base||!key) throw new Error('Supabase backend environment is not configured');
  const u=`${base}/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,status,target_amount&limit=1`;
  const r=await fetchWithTimeout(u,{headers:{apikey:key,Authorization:`Bearer ${key}`}},10000);
  if(!r.ok) throw new Error(`Could not validate campaign (${r.status})`);
  const rows=await r.json(); return rows[0]||null;
}
async function getPayment(paymentId,key){
  const r=await fetchWithTimeout(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Key ${key}`}},10000);
  if(!r.ok) throw new Error(`Pi payment lookup failed (${r.status})`);
  return r.json();
}
function paymentFields(raw){
  const p=raw?.payment||raw||{};
  return {amount:Number(p.amount),metadata:p.metadata||{},userUid:p.user_uid||p.user?.uid||null,direction:p.direction||null,status:p.status||{}};
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  const {paymentId,accessToken}=req.body||{};
  if(!paymentId)return res.status(400).json({error:'Missing paymentId'});
  if(!accessToken)return res.status(401).json({error:'Pi authentication is required'});
  const key=process.env.PI_SECRET_KEY;
  if(!key)return res.status(500).json({error:'PI_SECRET_KEY is not configured'});
  try{
    const user=await verifyPi(accessToken);
    if(!user)return res.status(401).json({error:'Pi authentication failed'});
    const before=paymentFields(await getPayment(paymentId,key));
    const campaignId=Number(before.metadata?.campaignId),amount=before.amount;
    if(before.userUid&&String(before.userUid)!==user.uid)return res.status(403).json({error:'Payment does not belong to authenticated Pi user'});
    if(before.direction&&before.direction!=='user_to_app')return res.status(409).json({error:'Invalid payment direction'});
    if(before.status?.cancelled||before.status?.user_cancelled)return res.status(409).json({error:'Payment is cancelled'});
    if(!Number.isInteger(campaignId)||campaignId<=0)return res.status(400).json({error:'Payment has invalid campaign metadata'});
    if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Payment has invalid amount'});
    const max=Number(process.env.MAX_DONATION_PI||0);
    if(max>0&&amount>max)return res.status(400).json({error:'Donation amount exceeds server limit'});
    const camp=await supabaseCampaign(campaignId);
    if(!camp)return res.status(404).json({error:'Campaign does not exist'});
    if(['draft','suspended','completed'].includes(String(camp.status||'active')))return res.status(409).json({error:'Campaign is not accepting payments'});
    if(before.status?.developer_approved===true)return res.status(200).json({approved:true,alreadyApproved:true,paymentId});
    const r=await fetchWithTimeout(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/approve`,{method:'POST',headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'}},10000);
    const data=await r.json().catch(()=>({}));
    if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||'Pi approval failed'});
    return res.status(200).json({approved:true,paymentId});
  }catch(e){return res.status(500).json({error:e.message||'Approval failed'})}
};
