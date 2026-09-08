import worker from './index.js';
import {PAGE} from './v4-page.js';
import {loadStaff,publicStaff,augmentEnv,handleStaffRequest,json as staffJson} from './v6-team-api.js';

function rewriteRequest(request) {
  const url = new URL(request.url);
  let changed = false;
  let method = request.method;

  if (url.pathname === '/api/boot') {
    url.pathname = '/api/bootstrap';
    changed = true;
  }
  if (url.pathname.startsWith('/api/orders/') && method === 'PUT') {
    method = 'PATCH'; changed = true;
  }
  if (url.pathname.startsWith('/api/subscriptions/') && method === 'PUT') {
    method = 'PATCH'; changed = true;
  }
  if (url.pathname.startsWith('/api/subscriptions/') && url.pathname.endsWith('/spend')) {
    url.pathname = url.pathname.slice(0, -'/spend'.length) + '/use'; changed = true;
  }
  if (!changed) return request;
  const init = { method, headers: request.headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = request.body;
  return new Request(url.toString(), init);
}

function phoneKey(v) { return String(v || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7'); }
function normalizeBootstrap(data, team) {
  const orders = Array.isArray(data.orders) ? data.orders.map(o => ({ ...o, editable: true })) : [];
  const subscriptions = Array.isArray(data.subscriptions)
    ? data.subscriptions.map(s => {
        const total = Number(s.total || 0), used = Number(s.used || 0), key = phoneKey(s.phone);
        const nextOrder = orders.filter(o => {
          if (!o.date || (data.today && o.date < data.today)) return false;
          const okPhone = key && phoneKey(o.phone) === key;
          const okName = !key && s.client && o.client && String(o.client).toLowerCase() === String(s.client).toLowerCase();
          return okPhone || okName;
        }).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time||'').localeCompare(String(b.time||'')))[0];
        return {...s,total,used,remaining:Math.max(0,total-used),next:s.next||nextOrder?.date||'',comment:s.comment||s.note||''};
      }) : [];
  return { ...data, orders, subscriptions, team };
}

export default {
  async fetch(request, env, ctx) {
    const originalUrl = new URL(request.url);
    try {
      if (originalUrl.pathname === '/' && request.method === 'GET') {
        return new Response(PAGE,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
      }

      if (originalUrl.pathname === '/api/staff' || originalUrl.pathname.startsWith('/api/staff/')) {
        return await handleStaffRequest(request, env);
      }

      let staff=[];
      try { staff = await loadStaff(env); } catch (e) { console.error('staff load', e); }
      const runtimeEnv = augmentEnv(env, staff);
      const rewritten = rewriteRequest(request);
      const rewrittenUrl = new URL(rewritten.url);
      const response = await worker.fetch(rewritten, runtimeEnv, ctx);

      if (rewrittenUrl.pathname === '/api/bootstrap' && response.ok) {
        try {
          const data = await response.json();
          const team = publicStaff(env, staff);
          return new Response(JSON.stringify(normalizeBootstrap(data, team)),{status:response.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
        } catch { return response; }
      }
      return response;
    } catch (e) {
      console.error('wrapper',e);
      return staffJson({ok:false,error:e.message||'Внутренняя ошибка'},e.status||500);
    }
  }
};
