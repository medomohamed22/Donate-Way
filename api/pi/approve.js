async function supabaseCampaign(campaignId){
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,''); const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!base||!key) throw new Error('Supabase backend environment is not configured');
  const u=`${base}/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,status,target_amount,current_amount&limit=1`;
  const r=await fetch(u,{headers:{apikey:key,Authorization:`Bearer ${key}`}}); if(!r.ok) throw new Error('Could not validate campaign');
  const rows=await r.json(); return rows[0]||null;
}
async function getPayment(paymentId,key){
  const r=await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Key ${key}`}});
  if(!r.ok) throw new Error(`Pi payment lookup failed (${r.status})`); return r.json();
}
function paymentFields(raw){const p=raw?.payment||raw||{};return{amount:Number(p.amount),metadata:p.metadata||{},userUid:p.user_uid||p.user?.uid||null,status:p.status||{}}}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  const paymentId=req.body?.paymentId; if(!paymentId)return res.status(400).json({error:'Missing paymentId'});
  const key=process.env.PI_SECRET_KEY; if(!key)return res.status(500).json({error:'PI_SECRET_KEY is not configured'});
  try{
    const before=paymentFields(await getPayment(paymentId,key));
    const campaignId=Number(before.metadata?.campaignId); const amount=before.amount;
    if(!Number.isInteger(campaignId)||campaignId<=0)return res.status(400).json({error:'Payment has invalid campaign metadata'});
    if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Payment has invalid amount'});
    const max=Number(process.env.MAX_DONATION_PI||0); if(max>0&&amount>max)return res.status(400).json({error:'Donation amount exceeds server limit'});
    const camp=await supabaseCampaign(campaignId); if(!camp)return res.status(404).json({error:'Campaign does not exist'});
    if(['draft','suspended','completed'].includes(String(camp.status||'active')))return res.status(409).json({error:'Campaign is not accepting payments'});
    const r=await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/approve`,{method:'POST',headers:{Authorization:`Key ${key}`,'Content-Type':'application/json'}});
    const data=await r.json().catch(()=>({})); if(!r.ok)return res.status(r.status).json({error:data?.error||'Pi approval failed'});
    return res.status(200).json({approved:true,paymentId});
  }catch(e){return res.status(500).json({error:e.message||'Approval failed'})}
};
