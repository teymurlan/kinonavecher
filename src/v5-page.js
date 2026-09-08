import {STYLE_1} from './v5-s1.js';
import {STYLE_2} from './v5-s2.js';
import {STYLE_3} from './v5-s3.js';
import {STYLE_4} from './v5-s4.js';
import {CLIENT_1} from './v5-c1.js';
import {CLIENT_2} from './v5-c2.js';
import {CLIENT_3} from './v5-c3.js';
import {CLIENT_4} from './v5-c4.js';
import {CLIENT_5} from './v5-c5.js';
import {CLIENT_6} from './v5-c6.js';
import {CLIENT_7} from './v5-c7.js';
import {CLIENT_8} from './v5-c8.js';
import {CLIENT_9} from './v5-c9.js';

const STYLE = STYLE_1 + STYLE_2 + STYLE_3 + STYLE_4;
const CLIENT = CLIENT_1 + CLIENT_2 + CLIENT_3 + CLIENT_4 + CLIENT_5 + CLIENT_6 + CLIENT_7 + CLIENT_8 + CLIENT_9;

export const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#f6f8fc">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<title>House Cleaning</title>
<style>${STYLE}</style>
</head>
<body>
<div class="app">
  <div class="top">
    <button id="topBack" class="topBack" aria-label="Назад">‹</button>
    <div class="brand"><b>House Cleaning</b><small>Управление клинингом</small></div>
    <div class="avatar" id="avatar">HC</div>
  </div>
  <div id="globalSearchWrap" class="search"><span>⌕</span><input id="globalSearch" placeholder="Клиент, телефон, адрес…"></div>
  <div id="searchResults"></div>
  <div id="home" class="page on"><div id="homeContent"><div class="empty">Загрузка CRM…</div></div></div>
  <div id="calendar" class="page"></div>
  <div id="clients" class="page"></div>
  <div id="more" class="page"></div>
  <div id="ordersAll" class="page"></div>
  <div id="subscriptions" class="page"></div>
  <div id="finance" class="page"></div>
  <div id="team" class="page"></div>
  <div id="debts" class="page"></div>
  <div id="detail" class="page"></div>
</div>
<nav class="nav">
  <button data-page="home" class="on"><svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg><span>Главная</span></button>
  <button data-page="calendar"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg><span>Календарь</span></button>
  <button id="addBtn"><span class="plus"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><span>Новый</span></button>
  <button data-page="clients"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Клиенты</span></button>
  <button data-page="more"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg><span>Ещё</span></button>
</nav>
<div id="sheet" class="sheet"><div class="panel"><div class="handle"></div><div id="panelContent"></div></div></div>
<div id="toast" class="toast"></div>
<script>${CLIENT}</script>
</body>
</html>`;
