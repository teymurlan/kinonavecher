const ADMIN_ID = 835372319;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function htmlPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <title>График заказчиков</title>
  <style>
    :root{color-scheme:light dark}
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f5f7;color:#111}
    .wrap{max-width:720px;margin:0 auto;padding:18px}
    .hero{background:#111827;color:#fff;border-radius:24px;padding:22px;margin-bottom:14px}
    .hero h1{font-size:26px;margin:0 0 8px}.hero p{margin:0;opacity:.8}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .card{background:#fff;border-radius:20px;padding:18px;box-shadow:0 8px 28px rgba(0,0,0,.06)}
    .n{font-size:28px;font-weight:800;margin-top:8px}.muted{color:#6b7280;font-size:14px}
    .full{grid-column:1/-1}.ok{color:#15803d;font-weight:700}.warn{color:#b45309;font-weight:700}
    button{width:100%;border:0;border-radius:16px;padding:14px;font-size:16px;font-weight:700;background:#111827;color:#fff;margin-top:14px}
    @media (prefers-color-scheme:dark){body{background:#0b0f14;color:#fff}.card{background:#151b23}.muted{color:#9ca3af}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>График заказчиков</h1>
      <p>House Cleaning · закрытая CRM</p>
    </div>
    <div class="grid">
      <div class="card"><div class="muted">Сегодня</div><div class="n">0</div></div>
      <div class="card"><div class="muted">Завтра</div><div class="n">0</div></div>
      <div class="card"><div class="muted">7 дней</div><div class="n">0</div></div>
      <div class="card"><div class="muted">Не оплачено</div><div class="n">0 ₽</div></div>
      <div class="card full">
        <div class="ok">WebApp запущен</div>
        <p class="muted">Telegram и Cloudflare работают. Google Таблица пока не подключена, поэтому реальные заказы ещё не загружаются.</p>
        <button onclick="Telegram.WebApp?.close()">Закрыть</button>
      </div>
    </div>
  </div>
  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
  </script>
</body>
</html>`;
}

async function telegram(env, method, payload) {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN not configured');
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(payload)
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.description || 'Telegram error'}`);
  return d;
}

async function ensureWebhook(env, origin) {
  if (!env.BOT_TOKEN) return {ok:false, reason:'BOT_TOKEN missing'};
  const desired = `${origin}/telegram/webhook`;
  try {
    const info = await telegram(env, 'getWebhookInfo', {});
    if (info?.result?.url === desired) return {ok:true, url:desired, changed:false};
    await telegram(env, 'setWebhook', {
      url: desired,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ['message'],
      drop_pending_updates: false
    });
    return {ok:true, url:desired, changed:true};
  } catch (e) {
    return {ok:false, reason:e.message};
  }
}

async function handleWebhook(request, env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', {status:403});
  }

  const update = await request.json();
  const m = update.message;
  if (!m) return json({ok:true});

  const userId = Number(m.from?.id || 0);
  const chatId = Number(m.chat?.id || 0);
  const text = String(m.text || '');
  if (!chatId) return json({ok:true});

  if (text.startsWith('/start')) {
    if (userId !== ADMIN_ID) {
      await telegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Доступ закрыт. Этот бот предназначен только для руководителя и бухгалтера.'
      });
      return json({ok:true});
    }

    const appUrl = new URL(request.url).origin;
    await telegram(env, 'sendMessage', {
      chat_id: chatId,
      text: 'График заказчиков\n\nДоступ администратора подтверждён.',
      reply_markup: {
        inline_keyboard: [[{
          text: 'Открыть график',
          web_app: {url: appUrl}
        }]]
      }
    });
  }

  return json({ok:true});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        const webhook = await ensureWebhook(env, url.origin);
        return json({
          ok: true,
          telegram_configured: Boolean(env.BOT_TOKEN),
          webhook_secret_configured: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
          google_configured: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
          admin_id: ADMIN_ID,
          webhook
        });
      }

      if (url.pathname === '/setup-webhook') {
        return json(await ensureWebhook(env, url.origin));
      }

      if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
        return handleWebhook(request, env);
      }

      if (url.pathname === '/' && request.method === 'GET') {
        ctx.waitUntil(ensureWebhook(env, url.origin));
        return new Response(htmlPage(), {
          headers: {'content-type':'text/html; charset=utf-8'}
        });
      }

      return new Response('Not found', {status:404});
    } catch (e) {
      console.error(e);
      return json({ok:false, error:e.message || 'Internal error'}, 500);
    }
  }
};
