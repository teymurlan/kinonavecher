import worker from './index.js';
import {PAGE} from './v4-page.js';

function rewriteRequest(request) {
  const url = new URL(request.url);
  let changed = false;
  let method = request.method;

  if (url.pathname === '/api/boot') {
    url.pathname = '/api/bootstrap';
    changed = true;
  }

  if (url.pathname.startsWith('/api/orders/') && method === 'PUT') {
    method = 'PATCH';
    changed = true;
  }

  if (url.pathname.startsWith('/api/subscriptions/') && method === 'PUT') {
    method = 'PATCH';
    changed = true;
  }

  if (url.pathname.startsWith('/api/subscriptions/') && url.pathname.endsWith('/spend')) {
    url.pathname = url.pathname.slice(0, -'/spend'.length) + '/use';
    changed = true;
  }

  if (!changed) return request;

  const init = {
    method,
    headers: request.headers
  };
  if (method !== 'GET' && method !== 'HEAD') init.body = request.body;
  return new Request(url.toString(), init);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(PAGE, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }
    return worker.fetch(rewriteRequest(request), env, ctx);
  }
};