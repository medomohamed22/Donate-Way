const crypto=require('crypto');
function env(){const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY||'';if(!url||!key)throw new Error('Supabase backend environment is not configured');return{url,key}}
function headers(extra={}){const {key}=env();return{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...extra}}
function parseCookies(req){const raw=String(req?.headers?.cookie||'');const out={};for(const part of raw.split(';')){const v=part.trim();if(!v)continue;const i=v.indexOf('=');if(i<=0)continue;const k=v.slice(0,i).trim();const rawValue=v.slice(i+1);try{out[k]=decodeURIComponent(rawValue)}catch{out[k]=rawValue}}return out}
function sessionSecret(){const s=process.env.ADMIN_SESSION_SECRET||process.env.PI_SECRET_KEY||'';if(!s)throw new Error('ADMIN_SESSION_SECRET (or PI_SECRET_KEY fallback) is not configured');return s}
function b64(v){return Buffer.from(v).toString('base64url')}
function signPayload(payload){const body=b64(JSON.stringify(payload));const sig=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');return `${body}.${sig}`}
function verifyToken(token){try{const [body,sig]=String(token||'').split('.');if(!body||!sig)return null;const expected=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;const p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));if(!p?.uid||!p?.exp||Date.now()>Number(p.exp))return null;return p}catch{return null}}
function makeAdminToken(user,maxAge=6*3600){return signPayload({uid:String(user.pi_uid),username:String(user.username||'pi-user'),role:'admin',exp:Date.now()+maxAge*1000})}
function makeUserToken(user,maxAge=30*24*3600){return signPayload({uid:String(user.pi_uid||user.uid),username:String(user.username||'pi-user'),role:'user',exp:Date.now()+maxAge*1000})}
function cookie(token,maxAge=6*3600){return `dw_admin_token=${encodeURIComponent(token||'')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0,Number(maxAge)||0)}`}
function userCookie(token,maxAge=30*24*3600){return `dw_pi_session=${encodeURIComponent(token||'')}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
function getUserSession(req){const p=verifyToken(parseCookies(req).dw_pi_session);if(!p?.uid)return null;return {uid:String(p.uid),username:String(p.username||'pi-user')}}
async function fetchWithTimeout(url,options={},ms=10000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal})}catch(e){if(e?.name==='AbortError')throw new Error('Backend request timed out');throw e}finally{clearTimeout(t)}}
async function getPiUser(piUid){const {url}=env();const r=await fetchWithTimeout(`${url}/rest/v1/pi_users?pi_uid=eq.${encodeURIComponent(piUid)}&select=pi_uid,username,is_admin,last_login_at&limit=1`,{headers:headers()});if(!r.ok){const t=await r.text();throw new Error(`Could not verify admin role: ${t||r.status}`)}const rows=await r.json();return rows[0]||null}
function getBearerToken(req){const h=String(req?.headers?.authorization||'');const m=h.match(/^Bearer\s+(.+)$/i);return m?m[1].trim():''}
async function getAdmin(req){const cookies=parseCookies(req);let payload=verifyToken(cookies.dw_admin_token);if(!payload||payload.role!=='admin')payload=verifyToken(getBearerToken(req));if(!payload||payload.role!=='admin')return null;const row=await getPiUser(payload.uid);if(!row||row.is_admin!==true)return null;return{user:{id:row.pi_uid,pi_uid:row.pi_uid,username:row.username,is_admin:true},payload}}
async function verifyPi(accessToken){if(!accessToken)return null;const r=await fetchWithTimeout('https://api.minepi.com/v2/me',{headers:{Authorization:`Bearer ${accessToken}`}},10000);if(!r.ok)return null;const j=await r.json().catch(()=>null);const u=j?.user||j;return u?.uid?{uid:String(u.uid),username:String(u.username||'pi-user')}:null}
async function syncPiUser(user){
  const {url}=env();
  const now=new Date().toISOString();
  // Read first so an existing admin flag is never overwritten by a login sync.
  const find=await fetchWithTimeout(`${url}/rest/v1/pi_users?pi_uid=eq.${encodeURIComponent(user.uid)}&select=pi_uid,username,is_admin,last_login_at&limit=1`,{headers:headers()});
  if(!find.ok){const t=await find.text();throw new Error(`pi_users table is not ready: ${t||find.status}`)}
  let rows=await find.json();
  if(rows.length){
    const patch=await fetchWithTimeout(`${url}/rest/v1/pi_users?pi_uid=eq.${encodeURIComponent(user.uid)}&select=pi_uid,username,is_admin,last_login_at`,{method:'PATCH',headers:headers({Prefer:'return=representation'}),body:JSON.stringify({username:user.username,last_login_at:now})});
    if(!patch.ok){const t=await patch.text();throw new Error(`Could not update Pi user: ${t||patch.status}`)}
    rows=await patch.json();
    return rows[0]||{pi_uid:user.uid,username:user.username,is_admin:false,last_login_at:now};
  }
  const insert=await fetchWithTimeout(`${url}/rest/v1/pi_users?select=pi_uid,username,is_admin,last_login_at`,{method:'POST',headers:headers({Prefer:'return=representation'}),body:JSON.stringify({pi_uid:user.uid,username:user.username,is_admin:false,last_login_at:now})});
  if(!insert.ok){const t=await insert.text();throw new Error(`Could not register Pi user: ${t||insert.status}`)}
  rows=await insert.json();
  return rows[0]||null;
}
function safeIdent(v){return typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)}
function buildQuery(table,q){const {url}=env();const p=new URLSearchParams();p.set('select',typeof q.columns==='string'&&q.columns.trim()?q.columns:'*');for(const f of Array.isArray(q.filters)?q.filters:[]){if(!safeIdent(f.column))continue;if(f.type==='eq')p.append(f.column,`eq.${String(f.value)}`);if(f.type==='in'&&Array.isArray(f.values))p.append(f.column,`in.(${f.values.map(x=>String(x).replace(/[(),]/g,'')).join(',')})`)}if(Array.isArray(q.orders)){const parts=q.orders.filter(o=>safeIdent(o.column)).map(o=>`${o.column}.${o.ascending===false?'desc':'asc'}`);if(parts.length)p.set('order',parts.join(','))}if(q.limit!==null&&q.limit!==undefined&&q.limit!==''&&Number.isFinite(Number(q.limit)))p.set('limit',String(Math.max(1,Math.min(5000,Number(q.limit)))));return`${url}/rest/v1/${table}?${p.toString()}`}
module.exports={env,headers,parseCookies,cookie,userCookie,makeAdminToken,makeUserToken,getUserSession,getAdmin,verifyPi,syncPiUser,buildQuery,fetchWithTimeout};
