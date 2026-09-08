import {PAGE} from './v4-page.js';
const MONTHS={январь:1,февраль:2,март:3,апрель:4,май:5,июнь:6,июль:7,август:8,сентябрь:9,октябрь:10,ноябрь:11,декабрь:12};
const SHEET_RE=/^(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь)\s+(\d{4})$/i;
const LABEL_RE=/^\s*(Время|Адрес|Тел\.?\s*Заказчика|Телефон\s*Заказчика|Вид\s*услуги|Общая\s*сумма|Оплата|Статус|Исполнитель|Примечание)\s*:\s*(.*)$/i;
const PHONE_RE=/(?:\+?7|8)[\s\-()]*\d(?:[\s\-()]*\d){9}/g;
const CRM='CRM_Заказы';
const CRM_HEAD=['ID','Дата','Время','Клиент','Телефон','Адрес','Услуга','Сумма','Оплата','Статус','Исполнитель','Примечание','Создал','Создано','Изменено'];
const SUB='CRM_Абонементы';
const SUB_HEAD=['ID','Клиент','Телефон','Тариф','Всего уборок','Использовано','Осталось','Дата начала','Дата окончания','Следующая уборка','Сумма','Статус','Примечание','Создано','Изменено'];
const enc=new TextEncoder();
let tokenCache={token:'',exp:0};
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const IDS=r=>new Set(String(r||'').split(',').map(x=>+x.trim()).filter(Number.isFinite));
function hex(b){return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hm(k,m){const key=await crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',key,enc.encode(m))}
async function auth(req,env){
  const d=req.headers.get('X-Telegram-Init-Data')||'';
  if(!d)throw Object.assign(new Error('Открой приложение из Telegram'),{status:401});
  const p=new URLSearchParams(d),h=p.get('hash');
  if(!h)throw Object.assign(new Error('Нет подписи Telegram'),{status:401});
  p.delete('hash');
  const c=[...p.keys()].sort().map(k=>`${k}=${p.get(k)}`).join('\n');
  const s=await hm(enc.encode('WebAppData'),env.BOT_TOKEN),calc=hex(await hm(new Uint8Array(s),c));
  if(calc!==h.toLowerCase())throw Object.assign(new Error('Неверная подпись Telegram'),{status:401});
  let u={};try{u=JSON.parse(p.get('user')||'{}')}catch{}
  const id=+u.id;
  if(!IDS(env.ALLOWED_TELEGRAM_IDS).has(id))throw Object.assign(new Error('Доступ запрещён'),{status:403});
  return{id,name:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||String(id),role:'Руководитель'};
}
function pem(p){const b=p.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,'');const x=atob(b);return Uint8Array.from(x,c=>c.charCodeAt(0)).buffer}
function b64u(a){let s='';for(const b of(a instanceof Uint8Array?a:new Uint8Array(a)))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function gtoken(env){
  if(tokenCache.token&&tokenCache.exp>Date.now()+60000)return tokenCache.token;
  let sa;try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)}catch{throw new Error('Ошибка JSON Google')}
  const now=Math.floor(Date.now()/1000);
  const h=b64u(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const p=b64u(enc.encode(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:sa.token_uri||'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
  const u=`${h}.${p}`;
  const k=await crypto.subtle.importKey('pkcs8',pem(sa.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',k,enc.encode(u));
  const r=await fetch(sa.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth-type:jwt-bearer',assertion:`${u}.${b64u(sig)}`})});
  const x=await r.json();
  if(!r.ok||!x.access_token)throw new Error(x.error_description||x.error||'Google OAuth');
  tokenCache={token:x.access_token,exp:Date.now()+3500000};
  return x.access_token;
}
async function gf(env,path,opt={}){
  const t=await gtoken(env);
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`,{...opt,headers:{authorization:`Bearer ${t}`,'content-type':'application/json',...(opt.headers||{})}});
  const x=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Google Sheets: ${x?.error?.message||r.status}`);
  return x;
}
async function sheetMeta(env){const x=await gf(env,'?fields=sheets.properties(title,index,sheetId)');return(x.sheets||[]).map(s=>s.properties)}
async function ensureSheet(env,title,head){
  const meta=await sheetMeta(env);
  if(!meta.some(s=>s.title===title)){
    await gf(env,':batchUpdate',{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title}}}]})});
    await gf(env,`/values/${encodeURIComponent(`'${title}'!A1:${String.fromCharCode(64+head.length)}1`)}?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({values:[head]})});
  }
}
function parts(n){const m=String(n).trim().match(SHEET_RE);return m?[MONTHS[m[1].toLowerCase()],+m[2]]:null}
function excelDay(n){return new Date(Date.UTC(1899,11,30)+Number(n)*86400000).getUTCDate()}
function hd(v,m,y){
  let d=null;
  if(typeof v==='number'&&v>10000)d=excelDay(v);
  else if(typeof v==='string'){
    const s=v.trim();let q;
    if((q=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)))d=+q[1];
    else if((q=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))d=+q[3];
    else if(/^\d{1,2}$/.test(s))d=+s;
  }
  if(!d)return null;
  const z=new Date(Date.UTC(y,m-1,d));if(z.getUTCMonth()!==m-1)return null;
  return`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function dc(name,vals){
  const [m,y]=parts(name)||[],out=new Map();if(!m)return out;
  const h=vals[1]||[];let cur=null;
  for(let c=1;c<=Math.max(h.length,...vals.map(r=>r.length));c++){const d=hd(h[c-1],m,y);if(d)cur=d;if(cur)out.set(c,cur)}
  return out;
}
function lab(s){
  s=s.replace(/\s+/g,' ').trim().toLowerCase();
  if(s==='время')return'time';if(s==='адрес')return'address';if(s.includes('заказчика'))return'contact';
  if(s==='вид услуги')return'service';if(s==='общая сумма')return'amount';if(s==='оплата')return'payment';
  if(s==='статус')return'status';if(s==='исполнитель')return'cleaner';if(s==='примечание')return'comment';
}
function contact(v){
  const raw=String(v||'').replace(/\s+/g,' ').trim(),ms=[...raw.matchAll(PHONE_RE)],phones=ms.map(m=>m[0].trim());
  let client=raw;
  for(let i=ms.length-1;i>=0;i--){const m=ms[i];client=client.slice(0,m.index)+' '+client.slice(m.index+m[0].length)}
  return[client.replace(/\s+/g,' ').replace(/^[\s,;\/-]+|[\s,;\/-]+$/g,''),phones.join(', ')];
}
function parseLegacy(text,date,sheet,row,col){
  const raw=String(text||'').trim(),low=raw.toLowerCase();
  if(!raw||!['адрес:','заказчика:','вид услуги:','общая сумма:'].some(x=>low.includes(x)))return null;
  const f={};let cur=null;
  for(const line of raw.split(/\r?\n/)){
    const m=line.match(LABEL_RE);
    if(m){cur=lab(m[1]);if(cur)f[cur]=m[2].trim()}
    else if(cur&&line.trim())f[cur]=`${f[cur]||''}\n${line.trim()}`.trim();
  }
  const [client,phone]=contact(f.contact);
  return{id:`legacy:${sheet}:${row}:${col}`,source:'legacy',editable:false,date,time:f.time||'',client,phone,address:f.address||'',service:f.service||'',amount:f.amount||'',payment:f.payment||'',status:f.status||'',cleaner:f.cleaner||'',comment:f.comment||''};
}
async function legacyOrders(env){
  const ns=(await sheetMeta(env)).map(x=>x.title).filter(parts);
  if(!ns.length)return[];
  const q=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
  for(const n of ns)q.append('ranges',`'${n}'!1:31`);
  const x=await gf(env,`/values:batchGet?${q}`),out=[];
  for(let i=0;i<ns.length;i++){
    const name=ns[i],v=x.valueRanges?.[i]?.values||[],map=dc(name,v);
    for(let r=3;r<=v.length;r++){
      const row=v[r-1]||[];
      for(let c=2;c<=row.length;c++){const d=map.get(c),cell=row[c-1];if(d&&typeof cell==='string'){const o=parseLegacy(cell,d,name,r,c);if(o)out.push(o)}}
    }
  }
  return out;
}
async function crmOrders(env){
  await ensureSheet(env,CRM,CRM_HEAD);
  const x=await gf(env,`/values/${encodeURIComponent("'CRM_Заказы'!A2:O")}?valueRenderOption=FORMATTED_VALUE`);
  return(x.values||[]).filter(r=>r[0]).map((r,i)=>({id:r[0],source:'crm',editable:true,row:i+2,date:normDate(r[1]),time:r[2]||'',client:r[3]||'',phone:r[4]||'',address:r[5]||'',service:r[6]||'',amount:r[7]||'',payment:r[8]||'',status:r[9]||'',cleaner:r[10]||'',comment:r[11]||'',created_by:r[12]||'',created_at:r[13]||'',updated_at:r[14]||''}));
}
async function allOrders(env){const[a,b]=await Promise.all([legacyOrders(env),crmOrders(env)]);return[...a,...b]}
async function subs(env){
  await ensureSheet(env,SUB,SUB_HEAD);
  const x=await gf(env,`/values/${encodeURIComponent("'CRM_Абонементы'!A2:O")}?valueRenderOption=FORMATTED_VALUE`);
  return(x.values||[]).filter(r=>r[0]).map((r,i)=>({
    id:r[0],row:i+2,client:r[1]||'',phone:r[2]||'',plan:r[3]||'Абонемент',total:+r[4]||0,used:+r[5]||0,remaining:+r[6]||Math.max(0,(+r[4]||0)-(+r[5]||0)),
    start:normDate(r[7]),end:normDate(r[8]),next:normDate(r[9]),amount:r[10]||'',status:r[11]||'Активен',comment:r[12]||'',created_at:r[13]||'',updated_at:r[14]||''
  }));
}
function num(v){const s=String(v??'').toLowerCase().replace(/₽|руб\.?/g,'').trim();if(!/^[0-9\s.,-]+$/.test(s))return 0;const n=Number(s.replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0}
function normDate(v){
  const s=String(v??'').trim();if(!s)return'';
  let m;if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))return`${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
  if((m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/))){let y=m[3];if(y.length===2)y='20'+y;return`${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`}
  return s;
}
function today(env){return new Intl.DateTimeFormat('en-CA',{timeZone:env.APP_TIMEZONE||'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function add(s,n){const d=new Date(`${s}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function build(env,user,a,ss){
  const t=today(env),tm=add(t,1),we=add(t,6),mo=t.slice(0,7),nowHM=new Intl.DateTimeFormat('en-GB',{timeZone:env.APP_TIMEZONE||'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  a.sort((x,y)=>x.date.localeCompare(y.date)||x.time.localeCompare(y.time));
  const unpaid=a.filter(o=>['не оплачено','не оплачен','долг','частично'].includes(String(o.payment).toLowerCase()));
  const month=a.filter(o=>o.date.startsWith(mo));
  const clients=new Map(),team=new Map();
  for(const o of a){
    const k=(o.phone||o.client||'').toLowerCase().trim();
    if(k){
      const c=clients.get(k)||{client:o.client||'Без имени',phone:o.phone||'',orders:0,total:0,next:'',last:''};
      c.orders++;c.total+=num(o.amount);
      if(o.date>=t&&(!c.next||o.date<c.next))c.next=o.date;
      if(o.date<t&&(!c.last||o.date>c.last))c.last=o.date;
      clients.set(k,c);
    }
    if(o.cleaner){
      const k2=o.cleaner.trim();
      const z=team.get(k2)||{name:k2,today:0,week:0,total:0,revenue:0};
      z.total++;z.revenue+=num(o.amount);if(o.date===t)z.today++;if(o.date>=t&&o.date<=we)z.week++;team.set(k2,z);
    }
  }
  const noCleaner=a.filter(o=>o.date>=t&&o.date<=we&&!o.cleaner&&String(o.status).toLowerCase()!=='отменён');
  const ending=ss.filter(s=>String(s.status).toLowerCase()!=='завершён'&&(s.remaining<=2||(s.end&&s.end<=add(t,7))));
  const attention=[];
  if(noCleaner.length)attention.push({type:'warning',title:`Без исполнителя: ${noCleaner.length}`,text:'Назначьте клинера на ближайшие заказы'});
  if(unpaid.length)attention.push({type:'danger',title:`Не оплачено: ${unpaid.length}`,text:`На сумму ${unpaid.reduce((z,o)=>z+num(o.amount),0)} ₽`});
  for(const s of ending.slice(0,3))attention.push({type:s.remaining<=1?'danger':'sub',title:`${s.client}: осталось ${s.remaining}`,text:`Абонемент ${s.plan}${s.end?` · до ${s.end}`:''}`});
  return{
    today:t,me:user,orders:a,subscriptions:ss,
    dashboard:{
      today:a.filter(o=>o.date===t).length,tomorrow:a.filter(o=>o.date===tm).length,week:a.filter(o=>o.date>=t&&o.date<=we).length,total:a.length,
      revenue_month:month.reduce((s,o)=>s+num(o.amount),0),unpaid_count:unpaid.length,unpaid_amount:unpaid.reduce((s,o)=>s+num(o.amount),0),
      active_subs:ss.filter(s=>String(s.status).toLowerCase()!=='завершён'&&s.remaining>0).length,
      next:a.find(o=>String(o.status).toLowerCase()!=='отменён'&&(o.date>t||(o.date===t&&(!o.time||o.time>=nowHM))))||a.find(o=>o.date>=t&&String(o.status).toLowerCase()!=='отменён')||null,attention
    },
    clients:[...clients.values()].sort((x,y)=>y.orders-x.orders),
    team:[...team.values()].sort((x,y)=>y.week-x.week||y.total-x.total)
  };
}
async function createOrder(env,user,p){
  await ensureSheet(env,CRM,CRM_HEAD);
  const id=`crm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,now=new Date().toISOString();
  const row=[id,p.date||'',p.time||'',p.client||'',p.phone||'',p.address||'',p.service||'',p.amount||'',p.payment||'Не оплачено',p.status||'Новый',p.cleaner||'',p.comment||'',user.name,now,now];
  await gf(env,`/values/${encodeURIComponent("'CRM_Заказы'!A:O")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})});
  return{id};
}
async function updateOrder(env,user,id,p){
  const a=await crmOrders(env),o=a.find(x=>x.id===id);
  if(!o)throw Object.assign(new Error('Старый заказ можно повторить как новый, но пока нельзя менять исходную ячейку'),{status:404});
  const now=new Date().toISOString(),row=[id,p.date??o.date,p.time??o.time,p.client??o.client,p.phone??o.phone,p.address??o.address,p.service??o.service,p.amount??o.amount,p.payment??o.payment,p.status??o.status,p.cleaner??o.cleaner,p.comment??o.comment,o.created_by||user.name,o.created_at||now,now];
  await gf(env,`/values/${encodeURIComponent(`'CRM_Заказы'!A${o.row}:O${o.row}`)}?valueInputOption=USER_ENTERED`,{method:'PUT',body:JSON.stringify({values:[row]})});
  return{id};
}
async function createSub(env,p){
  await ensureSheet(env,SUB,SUB_HEAD);
  const id=`sub-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,now=new Date().toISOString(),total=Math.max(1,+p.total||1),used=Math.max(0,+p.used||0),remaining=Math.max(0,total-used);
  const row=[id,p.client||'',p.phone||'',p.plan||'Абонемент',total,used,remaining,p.start||'',p.end||'',p.next||'',p.amount||'',remaining?'Активен':'Завершён',p.comment||'',now,now];
  await gf(env,`/values/${encodeURIComponent("'CRM_Абонементы'!A:O")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[row]})});
  return{id};
}
async function updateSub(env,id,p,spend=false){
  const a=await subs(env),s=a.find(x=>x.id===id);if(!s)throw Object.assign(new Error('Абонемент не найден'),{status:404});
  const total=Math.max(1,+((p.total??s.total)||1));
  let used=Math.max(0,+((p.used??s.used)||0));if(spend)used=Math.min(total,used+1);
  const rem=Math.max(0,total-used),now=new Date().toISOString(),status=rem===0?'Завершён':(p.status??s.status??'Активен');
  const row=[id,p.client??s.client,p.phone??s.phone,p.plan??s.plan,total,used,rem,p.start??s.start,p.end??s.end,p.next??s.next,p.amount??s.amount,status,p.comment??s.comment,s.created_at||now,now];
  await gf(env,`/values/${encodeURIComponent(`'CRM_Абонементы'!A${s.row}:O${s.row}`)}?valueInputOption=USER_ENTERED`,{method:'PUT',body:JSON.stringify({values:[row]})});
  return{id,remaining:rem};
}
async function tg(env,m,p){const r=await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${m}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});return r.json()}
async function ensureTelegram(env,origin){
  if(!env.BOT_TOKEN)return;
  try{
    const desired=`${origin}/telegram/webhook`,i=await tg(env,'getWebhookInfo',{});
    if(i?.result?.url!==desired)await tg(env,'setWebhook',{url:desired,allowed_updates:['message']});
    const n=await tg(env,'getMyName',{});
    if(n?.result?.name!=='House Cleaning CRM')await tg(env,'setMyName',{name:'House Cleaning CRM'});
    const d=await tg(env,'getMyShortDescription',{});
    if(d?.result?.short_description!=='Управление клинингом')await tg(env,'setMyShortDescription',{short_description:'Управление клинингом'});
  }catch(e){console.log('telegram setup',e.message)}
}
async function hook(req,env){
  const u=await req.json(),m=u.message;if(!m)return J({ok:true});
  const id=+m.from?.id,chat=m.chat?.id;
  if(String(m.text||'').startsWith('/start')){
    if(!IDS(env.ALLOWED_TELEGRAM_IDS).has(id))await tg(env,'sendMessage',{chat_id:chat,text:'Доступ закрыт.'});
    else await tg(env,'sendMessage',{chat_id:chat,text:'House Cleaning CRM\n\nЗаказы, клиенты, абонементы и финансы.',reply_markup:{inline_keyboard:[[{text:'Открыть CRM',web_app:{url:new URL(req.url).origin}}]]}});
  }
  return J({ok:true});
}
function page(){return PAGE}

export default{async fetch(req,env,ctx){const u=new URL(req.url);try{
  if(u.pathname==='/'){ctx.waitUntil(ensureTelegram(env,u.origin));return new Response(page(),{headers:{'content-type':'text/html; charset=utf-8'}})}
  if(u.pathname==='/health'){let ga=false,ge='';try{await sheetMeta(env);ga=true}catch(e){ge=e.message}ctx.waitUntil(ensureTelegram(env,u.origin));return J({ok:true,telegram_configured:!!env.BOT_TOKEN,google_configured:!!env.GOOGLE_SERVICE_ACCOUNT_JSON,google_access:ga,google_error:ge})}
  if(u.pathname==='/telegram/webhook'&&req.method==='POST')return hook(req,env);
  if(u.pathname==='/api/boot'){const user=await auth(req,env);const[a,s]=await Promise.all([allOrders(env),subs(env)]);return J(build(env,user,a,s))}
  if(u.pathname==='/api/orders'&&req.method==='POST'){const user=await auth(req,env),p=await req.json();return J(await createOrder(env,user,p),201)}
  const om=u.pathname.match(/^\/api\/orders\/(.+)$/);if(om&&req.method==='PUT'){const user=await auth(req,env),p=await req.json();return J(await updateOrder(env,user,decodeURIComponent(om[1]),p))}
  if(u.pathname==='/api/subscriptions'&&req.method==='POST'){await auth(req,env);return J(await createSub(env,await req.json()),201)}
  const sm=u.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);if(sm&&req.method==='PUT'){await auth(req,env);return J(await updateSub(env,decodeURIComponent(sm[1]),await req.json(),false))}
  const sp=u.pathname.match(/^\/api\/subscriptions\/([^/]+)\/spend$/);if(sp&&req.method==='POST'){await auth(req,env);return J(await updateSub(env,decodeURIComponent(sp[1]),{},true))}
  return J({error:'Не найдено'},404)
}catch(e){console.error(e);return J({error:e.message||'Ошибка'},e.status||500)}}};
