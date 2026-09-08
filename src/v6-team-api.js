const TEAM_SHEET='CRM_Команда';
const TEAM_HEAD=['ID','Тип','Имя','Telegram ID','Телефон','Статус','Создано','Изменено'];
const enc=new TextEncoder();
let tokenCache={token:'',exp:0};
let staffCache={at:0,key:'',rows:[]};

const idSet=v=>new Set(String(v||'').split(',').map(x=>Number(x.trim())).filter(Number.isFinite));
const escSheet=s=>`'${String(s).replace(/'/g,"''")}'`;
const now=()=>new Date().toISOString();

function hex(b){return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hm(k,m){const key=await crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',key,enc.encode(m))}
function pem(p){const b=p.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,'');const x=atob(b);return Uint8Array.from(x,c=>c.charCodeAt(0)).buffer}
function b64u(a){let s='';for(const b of(a instanceof Uint8Array?a:new Uint8Array(a)))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function googleToken(env){
  if(tokenCache.token&&tokenCache.exp>Date.now()+60000)return tokenCache.token;
  let sa;try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)}catch{throw new Error('Ошибка JSON Google')}
  const ts=Math.floor(Date.now()/1000);
  const h=b64u(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const p=b64u(enc.encode(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:sa.token_uri||'https://oauth2.googleapis.com/token',iat:ts,exp:ts+3600})));
  const unsigned=`${h}.${p}`;
  const key=await crypto.subtle.importKey('pkcs8',pem(sa.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned));
  const r=await fetch(sa.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${b64u(sig)}`})});
  const x=await r.json();if(!r.ok||!x.access_token)throw new Error(x.error_description||x.error||'Google OAuth');
  tokenCache={token:x.access_token,exp:Date.now()+3500000};return x.access_token;
}
async function gf(env,path,opt={}){
  const t=await googleToken(env);
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`,{...opt,headers:{authorization:`Bearer ${t}`,'content-type':'application/json',...(opt.headers||{})}});
  const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`Google Sheets: ${x?.error?.message||r.status}`);return x;
}
async function ensureTeam(env){
  const meta=await gf(env,'?fields=sheets.properties(title)');
  if(!(meta.sheets||[]).some(s=>s.properties.title===TEAM_SHEET)){
    await gf(env,':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:TEAM_SHEET}}}]})});
  }
  const q=await gf(env,`/values/${encodeURIComponent(`${escSheet(TEAM_SHEET)}!1:1`)}?valueRenderOption=FORMATTED_VALUE`);
  if(!(q.values||[]).length){
    await gf(env,`/values/${encodeURIComponent(`${escSheet(TEAM_SHEET)}!A1:H1`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[TEAM_HEAD]})});
  }
}
function rowObj(r,i){return{id:r[0]||'',type:r[1]||'',name:r[2]||'',telegram_id:String(r[3]||''),phone:r[4]||'',status:r[5]||'Активен',created_at:r[6]||'',updated_at:r[7]||'',row:i+2}}
export async function loadStaff(env,force=false){
  const key=env.GOOGLE_SHEET_ID||'';
  if(!force&&staffCache.key===key&&Date.now()-staffCache.at<15000)return staffCache.rows;
  await ensureTeam(env);
  const x=await gf(env,`/values/${encodeURIComponent(`${escSheet(TEAM_SHEET)}!A2:H`)}?valueRenderOption=FORMATTED_VALUE`);
  const rows=(x.values||[]).filter(r=>r[0]).map(rowObj);
  staffCache={at:Date.now(),key,rows};return rows;
}
function active(rows){return rows.filter(x=>String(x.status).toLowerCase()==='активен')}
export function publicStaff(env,rows){
  const a=active(rows);
  const cleaners=a.filter(x=>x.type==='cleaner').map(x=>({id:x.id,name:x.name,phone:x.phone}));
  const dynamic=a.filter(x=>x.type==='admin').map(x=>({id:x.id,name:x.name,telegram_id:x.telegram_id,phone:x.phone,protected:false}));
  const owners=[...idSet(env.ALLOWED_TELEGRAM_IDS)].map(id=>({id:`owner:${id}`,name:'Руководитель',telegram_id:String(id),phone:'',protected:true}));
  return{cleaners,admins:[...owners,...dynamic]};
}
export function augmentEnv(env,rows){
  const dynamic=active(rows).filter(x=>x.type==='admin').map(x=>Number(x.telegram_id)).filter(Number.isFinite);
  const all=new Set([...idSet(env.ALLOWED_TELEGRAM_IDS),...dynamic]);
  return{...env,ALLOWED_TELEGRAM_IDS:[...all].join(',')};
}
async function telegramIdentity(req,env,rows){
  const d=req.headers.get('X-Telegram-Init-Data')||'';if(!d)throw Object.assign(new Error('Откройте приложение из Telegram'),{status:401});
  const p=new URLSearchParams(d),hash=p.get('hash');if(!hash)throw Object.assign(new Error('Нет подписи Telegram'),{status:401});
  p.delete('hash');const check=[...p.keys()].sort().map(k=>`${k}=${p.get(k)}`).join('\n');
  const sec=await hm(enc.encode('WebAppData'),env.BOT_TOKEN),calc=hex(await hm(new Uint8Array(sec),check));
  if(calc!==hash.toLowerCase())throw Object.assign(new Error('Неверная подпись Telegram'),{status:401});
  let u={};try{u=JSON.parse(p.get('user')||'{}')}catch{}
  const id=Number(u.id||0),owners=idSet(env.ALLOWED_TELEGRAM_IDS),accountants=idSet(env.ACCOUNTANT_TELEGRAM_IDS);
  const dyn=active(rows).find(x=>x.type==='admin'&&Number(x.telegram_id)===id);
  let role='';if(owners.has(id))role='owner';else if(dyn)role='admin';else if(accountants.has(id))role='accountant';
  if(!role)throw Object.assign(new Error('Доступ запрещён'),{status:403});
  return{id,name:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||String(id),role};
}
function sanitizeType(v){return v==='admin'?'admin':'cleaner'}
function validateName(v){const s=String(v||'').trim();if(s.length<2)throw Object.assign(new Error('Укажите имя'),{status:400});return s}
async function append(env,row){return gf(env,`/values/${encodeURIComponent(`${escSheet(TEAM_SHEET)}!A:H`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})})}
async function put(env,row,values){return gf(env,`/values/${encodeURIComponent(`${escSheet(TEAM_SHEET)}!A${row}:H${row}`)}?valueInputOption=USER_ENTERED`,{method:'PUT',body:JSON.stringify({values:[values]})})}
function clearCache(){staffCache={at:0,key:'',rows:[]}}

export async function handleStaffRequest(req,env){
  let rows=await loadStaff(env);const user=await telegramIdentity(req,env,rows);const url=new URL(req.url);
  if(req.method==='GET')return json({ok:true,me:user,team:publicStaff(env,rows)});
  if(user.role==='accountant')throw Object.assign(new Error('Недостаточно прав'),{status:403});
  if(req.method==='POST'){
    const p=await req.json(),type=sanitizeType(p.type),name=validateName(p.name),phone=String(p.phone||'').trim(),telegram=String(p.telegram_id||'').replace(/\D/g,'');
    if(type==='admin'){
      if(user.role!=='owner')throw Object.assign(new Error('Администраторов может добавлять только руководитель'),{status:403});
      if(!telegram)throw Object.assign(new Error('Укажите Telegram ID администратора'),{status:400});
      if(active(rows).some(x=>x.type==='admin'&&String(x.telegram_id)===telegram)||idSet(env.ALLOWED_TELEGRAM_IDS).has(Number(telegram)))throw Object.assign(new Error('Этот Telegram ID уже имеет доступ'),{status:409});
    }
    if(type==='cleaner'&&active(rows).some(x=>x.type==='cleaner'&&x.name.toLowerCase()===name.toLowerCase()))throw Object.assign(new Error('Такой клинер уже есть'),{status:409});
    const id=(type==='admin'?'ad_':'cl_')+crypto.randomUUID(),ts=now();await append(env,[id,type,name,telegram,phone,'Активен',ts,ts]);clearCache();rows=await loadStaff(env,true);
    return json({ok:true,item:active(rows).find(x=>x.id===id),team:publicStaff(env,rows)},201);
  }
  const id=decodeURIComponent(url.pathname.slice('/api/staff/'.length)),item=rows.find(x=>x.id===id);if(!item)throw Object.assign(new Error('Сотрудник не найден'),{status:404});
  if(item.type==='admin'&&user.role!=='owner')throw Object.assign(new Error('Администраторов может изменять только руководитель'),{status:403});
  if(req.method==='DELETE'){
    await put(env,item.row,[item.id,item.type,item.name,item.telegram_id,item.phone,'Удалён',item.created_at||now(),now()]);clearCache();rows=await loadStaff(env,true);return json({ok:true,team:publicStaff(env,rows)});
  }
  if(req.method==='PATCH'){
    const p=await req.json(),name=p.name!==undefined?validateName(p.name):item.name,phone=p.phone!==undefined?String(p.phone||'').trim():item.phone,telegram=p.telegram_id!==undefined?String(p.telegram_id||'').replace(/\D/g,''):item.telegram_id;
    if(item.type==='admin'&&!telegram)throw Object.assign(new Error('Укажите Telegram ID'),{status:400});
    await put(env,item.row,[item.id,item.type,name,telegram,phone,item.status||'Активен',item.created_at||now(),now()]);clearCache();rows=await loadStaff(env,true);return json({ok:true,team:publicStaff(env,rows)});
  }
  return json({ok:false,error:'Метод не поддерживается'},405);
}
export function json(x,s=200){return new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
