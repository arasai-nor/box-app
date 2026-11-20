// BOX — galvenā aplikācijas loģika (bez ietvariem, darbojas tieši pārlūkā)
import { CONFIG } from './config.js';
import { createDemoApi } from './api-demo.js';

const api = CONFIG.SUPABASE_URL
  ? (await import('./api-supabase.js')).createSupabaseApi(CONFIG)
  : createDemoApi();

const $app = document.getElementById('app');
const state = { session: null, settings: null, timers: [] };
const MIN = 60000;

// ===================================================================
// Palīgfunkcijas
// ===================================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DOW = ['Sv', 'Pr', 'Ot', 'Tr', 'Ce', 'Pk', 'Se'];
const MON = ['janv.', 'febr.', 'marts', 'apr.', 'maijs', 'jūn.', 'jūl.', 'aug.', 'sept.', 'okt.', 'nov.', 'dec.'];
const fTime = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fDate = d => { d = new Date(d); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fDay = d => { d = new Date(d); return `${DOW[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };
const fDT = d => `${fDay(d)} ${fTime(d)}`;
const fEur = x => (Math.round((+x || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const fDur = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h} h ${pad(m % 60)} min` : `${m} min`; };
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ym = d => ymd(d).slice(0, 7);
const startOfDay = d => { d = new Date(d); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
const monthRange = (y, m) => [new Date(y, m, 1), new Date(y, m + 1, 1)];
const isAdmin = () => state.session?.profile?.role === 'admin';
const me = () => state.session?.profile;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const appUrl = () => location.origin + location.pathname;

function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), bad ? 4500 : 2600);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(e.message || String(e), true); throw e; }
}
function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => { bg.dispatchEvent(new Event('closing')); bg.remove(); };
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  bg.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  document.body.appendChild(bg);
  onMount?.(bg.querySelector('.modal'), close, bg);
  return close;
}
function confirmBox(text, yes = 'Jā', cls = 'primary') {
  return new Promise(res => {
    modal(`<h3>${esc(text)}</h3><div class="grid2" style="margin-top:16px">
      <button class="btn ghost" data-close>Atcelt</button><button class="btn ${cls}" id="yes">${esc(yes)}</button></div>`,
      (m, close, bg) => { m.querySelector('#yes').onclick = () => { res(true); close(); }; bg.addEventListener('closing', () => res(false)); });
  });
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Neizdevās ielādēt ' + src));
    document.head.appendChild(s);
  });
}
function timeOptions(sel) {
  let o = '';
  for (let m = 0; m <= 24 * 60; m += 15) {
    const v = m === 1440 ? '24:00' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    o += `<option ${v === sel ? 'selected' : ''}>${v}</option>`;
  }
  return o;
}
const toDate = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(day + 'T00:00:00'); d.setMinutes(h * 60 + m); return d; };
function estCost(minutes) {
  const s = state.settings || { hourly_rate: 2, min_minutes: 60 };
  return Math.max(minutes, s.min_minutes) / 60 * s.hourly_rate;
}
function parseHash() {
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  return { parts: (path || '/').split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

// ===================================================================
// Rāmis
// ===================================================================
function shell(active, inner) {
  const p = me();
  const tabs = [['', '🏠', 'Sākums'], ['kalendars', '📅', 'Kalendārs'], ['konts', '👤', 'Mans konts'], ['kase', '💶', 'Kase']];
  if (isAdmin()) tabs.push(['admin', '⚙️', 'Admins']);
  $app.innerHTML = `
    ${api.demo ? `<div class="demo-band">DEMO režīms — dati glabājas tikai šajā ierīcē</div>` : ''}
    <header class="topbar"><img src="icons/icon-192.png" alt=""><div class="title">BOX</div>
      <div class="who">${esc(p.full_name)}${isAdmin() ? '<br><span class="small">admins</span>' : ''}</div></header>
    <main id="main">${inner}</main>
    <nav class="nav">${tabs.map(([r, ic, t]) => `<a href="#/${r}" class="${active === r ? 'on' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('')}</nav>`;
  return document.getElementById('main');
}

// ===================================================================
// Ielogošanās / reģistrācija
// ===================================================================
function viewLogin(q) {
  if (api.demo) {
    const users = api.demoUsers();
    $app.innerHTML = `<div class="login-wrap">
      <img class="login-logo" src="icons/icon-192.png" alt="BOX">
      <h2 class="center">BOX — DEMO</h2>
      <p class="muted center small">Šī ir izmēģinājuma versija. Izvēlies, kā kurš lietotājs ienākt.</p>
      <div class="userpick">${users.map(u => `<button class="btn ghost" data-u="${u.id}">${esc(u.full_name)}${u.role === 'admin' ? ' ⭐' : ''}</button>`).join('')}</div>
      <div class="sp"></div><button class="btn sm ghost block" id="reset">Atjaunot demo datus</button></div>`;
    $app.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { api.demoLogin(b.dataset.u); boot(); });
    $app.querySelector('#reset').onclick = () => { api.demoReset(); viewLogin(q); toast('Demo dati atjaunoti'); };
    return;
  }
  const code = q.get('code') || '';
  const reg = !!code || q.get('mode') === 'reg';
  $app.innerHTML = `<div class="login-wrap">
    <img class="login-logo" src="icons/icon-192.png" alt="BOX">
    <h2 class="center">${reg ? 'Reģistrācija BOX' : 'Ienākt BOX'}</h2>
    <div class="card">
      <form id="f">
        ${reg ? `
          <label>Vārds, uzvārds</label><input name="full_name" required autocomplete="name">
          <label>Telefons</label><input name="phone" type="tel" autocomplete="tel" placeholder="+371 …">
          <label>Auto (marka, numurs) — nav obligāti</label><input name="car">
          <label>Ielūguma kods</label><input name="invite_code" value="${esc(code)}" required style="text-transform:uppercase">` : ''}
        <label>E-pasts</label><input name="email" type="email" required autocomplete="email">
        <label>Parole ${reg ? '(vismaz 6 simboli)' : ''}</label><input name="password" type="password" minlength="6" required autocomplete="${reg ? 'new-password' : 'current-password'}">
        <div class="err" id="err"></div><div class="sp"></div>
        <button class="btn primary block lg">${reg ? 'Reģistrēties' : 'Ienākt'}</button>
      </form>
    </div>
    <p class="center small">${reg ? `Jau ir konts? <a href="#/login">Ienākt</a>` : `Saņēmi ielūgumu? <a href="#/login?mode=reg">Reģistrēties</a><br><a href="#" id="forgot">Aizmirsi paroli?</a>`}</p>
  </div>`;
  const f = $app.querySelector('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const err = $app.querySelector('#err'); err.textContent = '';
    try {
      if (reg) { await api.signUp({ ...d, invite_code: d.invite_code.trim().toUpperCase() }); await api.signIn(d.email, d.password).catch(() => {}); }
      else await api.signIn(d.email, d.password);
      location.hash = '#/'; boot();
    } catch (x) { err.textContent = x.message === 'Invalid login credentials' ? 'Nepareizs e-pasts vai parole' : x.message; }
  };
  const fg = $app.querySelector('#forgot');
  if (fg) fg.onclick = async e => {
    e.preventDefault(); const email = f.email.value.trim();
    if (!email) return toast('Ieraksti e-pastu un spied vēlreiz', true);
    await run(() => api.resetPassword(email), 'Paroles atjaunošanas saite nosūtīta uz e-pastu');
  };
}

function viewPending() {
  $app.innerHTML = `<div class="login-wrap"><img class="login-logo" src="icons/icon-192.png" alt="">
    <div class="card center"><h3>Konts gaida apstiprinājumu</h3>
    <p class="muted">Tavs konts ir izveidots, bet vēl nav aktivizēts. Administrators to apstiprinās — pēc tam atver aplikāciju vēlreiz.</p>
    <button class="btn ghost block" id="re">Pārbaudīt vēlreiz</button><div class="sp"></div>
    <button class="btn ghost block" id="out">Iziet</button></div></div>`;
  $app.querySelector('#re').onclick = boot;
  $app.querySelector('#out').onclick = async () => { await api.signOut(); boot(); };
}

// ===================================================================
// Sākums
// ===================================================================
async function viewHome(q) {
  const main = shell('', '<div class="loading">Ielādē…</div>');
  const now = new Date();
  const [status, todays, upcoming] = await Promise.all([
    api.boxStatus(),
    api.listBookings(startOfDay(now).toISOString(), addDays(startOfDay(now), 1).toISOString()),
    api.listBookings(now.toISOString(), addDays(now, 60).toISOString()),
  ]);
  const mine = status && status.user_id === me().id;
  const myNext = upcoming.filter(b => b.user_id === me().id && b.status === 'active');

  let statusHtml;
  if (!status) {
    const next = upcoming.find(b => b.status === 'active' && new Date(b.starts_at) > now);
    statusHtml = `<div class="status free"><div class="big">● BOX BRĪVS</div>
      <div class="muted small">${next ? `Nākamā rezervācija: ${fDT(next.starts_at)} — ${esc(next.full_name)}` : 'Tuvākajā laikā nav rezervāciju'}</div>
      <div class="sp"></div><button class="btn green block lg" id="cin">Iečekoties BOX</button></div>`;
  } else if (mine) {
    statusHtml = `<div class="status mine"><div class="big">● TU STRĀDĀ BOX</div>
      <div class="muted small">Iečekojies ${fTime(status.checked_in_at)}${status.booking_ends ? ` · rezervēts līdz ${fTime(status.booking_ends)}` : ''}</div>
      <div class="timer" id="tm">—</div><div id="tc" class="muted"></div>
      <div id="over" class="err"></div>
      <div class="sp"></div><button class="btn red block lg" id="cout">Izčekoties un beigt</button></div>`;
  } else {
    statusHtml = `<div class="status busy"><div class="big">● BOX AIZŅEMTS</div>
      <div><b>${esc(status.full_name)}</b>${status.car ? ` · ${esc(status.car)}` : ''}</div>
      <div class="muted small">no ${fTime(status.checked_in_at)}${status.booking_ends ? `, rezervēts līdz ${fTime(status.booking_ends)}` : ''}</div>
      ${isAdmin() ? `<div class="sp"></div><button class="btn sm ghost" id="acout">Izčekot (admins)</button>` : ''}</div>`;
  }

  main.innerHTML = `
    ${statusHtml}
    ${!standalone() ? `<div class="card flat small">📲 <b>Instalē BOX uz telefona:</b> iPhone — Safari ⇧ <i>Kopīgot</i> → <i>Pievienot sākuma ekrānam</i>. Android — Chrome ⋮ → <i>Instalēt lietotni</i>.</div>` : ''}
    <div class="card"><div class="row"><h3 class="grow">Manas rezervācijas</h3><a class="btn sm primary" href="#/kalendars?new=1">+ Rezervēt</a></div>
      ${myNext.length ? `<ul class="list">${myNext.slice(0, 5).map(b => `<li class="row"><div class="grow"><b>${fDay(b.starts_at)}</b><br>
        <span class="muted">${fTime(b.starts_at)}–${fTime(b.ends_at)}${b.note ? ' · ' + esc(b.note) : ''}</span></div>
        ${new Date(b.starts_at) > now ? `<button class="btn sm ghost" data-cancel="${b.id}">Atcelt</button>` : '<span class="badge blue">notiek</span>'}</li>`).join('')}</ul>`
        : `<p class="muted small">Nav aktīvu rezervāciju.</p>`}</div>
    <div class="card"><h3>Šodien BOX</h3>
      ${todays.length ? `<ul class="list">${todays.map(b => `<li class="row"><div class="grow">${fTime(b.starts_at)}–${fTime(b.ends_at)} · <b>${esc(b.full_name)}</b></div>
        ${b.status === 'completed' ? '<span class="badge">beigts</span>' : ''}</li>`).join('')}</ul>` : `<p class="muted small">Šodien nav rezervāciju.</p>`}</div>
    <div class="card disabled-card"><h3>📹 Video novērošana</h3><p class="muted small" style="margin:0">BOX statuss no kamerām — tiks pieslēgts nākamajā posmā.</p></div>`;

  main.querySelector('#cin')?.addEventListener('click', () => openCheckIn());
  main.querySelector('#cout')?.addEventListener('click', async () => {
    if (!(await confirmBox('Beigt darbu un izčekoties no BOX?', 'Izčekoties', 'red'))) return;
    const s = await run(() => api.checkOut());
    modal(`<h3>Paldies! BOX atbrīvots</h3><p>Laiks: <b>${fDur(s.minutes)}</b>${s.billed_minutes > s.minutes ? ` (aprēķinam ${fDur(s.billed_minutes)} — minimums)` : ''}<br>
      Summa: <b class="money">${fEur(s.amount)}</b></p><p class="muted small">Summa pievienota tavam šī mēneša aprēķinam.</p>
      <button class="btn primary block" data-close>Labi</button>`);
    viewHome();
  });
  main.querySelector('#acout')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Izčekot ${status.full_name} no BOX?`, 'Izčekot', 'red'))) return;
    await run(() => api.checkOut(status.session_id), 'Izčekots'); viewHome();
  });
  main.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Atcelt šo rezervāciju?', 'Atcelt rezervāciju', 'red'))) return;
    await run(() => api.cancelBooking(+b.dataset.cancel), 'Rezervācija atcelta'); viewHome();
  });

  if (mine) {
    const tick = () => {
      const m = (Date.now() - new Date(status.checked_in_at)) / MIN;
      const el = document.getElementById('tm'); if (!el) return;
      el.textContent = `${pad(Math.floor(m / 60))}:${pad(Math.floor(m % 60))}`;
      document.getElementById('tc').textContent = `Pašreizējā summa: ${fEur(estCost(Math.ceil(m)))} (min. ${state.settings.min_minutes} min)`;
      const over = status.booking_ends && Date.now() > new Date(status.booking_ends);
      const ov = document.getElementById('over');
      if (ov) ov.textContent = over ? '⚠ Rezervētais laiks beidzies — pabeidz darbu vai pagarini rezervāciju kalendārā.' : '';
    };
    tick(); state.timers.push(setInterval(tick, 15000));
  }
  state.timers.push(setInterval(() => { if (location.hash === '#/' || location.hash === '') viewHome(); }, 60000));
  if (q?.get('k')) openCheckIn(q.get('k'));
}

// Iečekošanās: QR skenēšana vai koda ievade
function openCheckIn(prefill = '') {
  let stream = null, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); stream = null; };
  modal(`<h3>Iečekoties BOX</h3>
    <p class="muted small">Noskenē QR kodu, kas piestiprināts BOX iekšpusē, vai ieraksti zem tā redzamo kodu.</p>
    <button class="btn blue block" id="scan">📷 Skenēt QR kodu</button>
    <video class="scan" id="vid" playsinline muted hidden></video>
    <label>BOX kods</label><input id="code" value="${esc(prefill)}" autocapitalize="characters" style="text-transform:uppercase;font-size:22px;letter-spacing:3px;text-align:center">
    <div class="err" id="err"></div><div class="sp"></div>
    <div class="grid2"><button class="btn ghost" data-close>Atcelt</button><button class="btn green" id="go">Iečekoties</button></div>`,
  (m, close, bg) => {
    bg.addEventListener('closing', stop);
    const go = async (code) => {
      stop();
      try {
        await api.checkIn(code);
        close(); toast('Iečekojies! Veiksmīgu darbu 🔧');
        location.hash = '#/'; viewHome();
      } catch (e) { m.querySelector('#err').textContent = e.message; }
    };
    m.querySelector('#go').onclick = () => go(m.querySelector('#code').value);
    m.querySelector('#scan').onclick = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = m.querySelector('#vid'); v.hidden = false; v.srcObject = stream; await v.play();
        const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
        const loop = () => {
          if (!stream) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0);
            const r = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
            if (r?.data) {
              const txt = r.data.trim(); const code = (txt.match(/BOX-CHECKIN:([A-Z0-9]+)/i) || txt.match(/[?&]k=([A-Z0-9]+)/i) || [null, txt])[1];
              m.querySelector('#code').value = code.toUpperCase(); v.hidden = true; go(code); return;
            }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) { m.querySelector('#err').textContent = 'Kamera nav pieejama — ieraksti kodu ar roku. (' + e.message + ')'; }
    };
    if (prefill) setTimeout(() => go(prefill), 50);
  });
}

// ===================================================================
// Kalendārs
// ===================================================================
async function viewCalendar(q) {
  const main = shell('kalendars', '');
  const today = startOfDay(new Date());
  let sel = q.get('d') ? startOfDay(new Date(q.get('d') + 'T00:00:00')) : today;
  let weekStart = addDays(today, Math.floor((sel - today) / 86400000 / 14) * 14);

  async function draw() {
    const from = weekStart, to = addDays(weekStart, 14);
    const all = await api.listBookings(from.toISOString(), to.toISOString());
    const dayBk = all.filter(b => new Date(b.starts_at) < addDays(sel, 1) && new Date(b.ends_at) > sel);
    const HP = 44; // px stundā
    main.innerHTML = `
      <div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Kalendārs</h2>
        <button class="btn sm ghost" id="prev">‹</button><button class="btn sm ghost" id="tdy">Šodien</button><button class="btn sm ghost" id="next">›</button></div>
      <div class="days">${Array.from({ length: 14 }, (_, i) => {
        const d = addDays(from, i); const has = all.some(b => new Date(b.starts_at) < addDays(d, 1) && new Date(b.ends_at) > d);
        return `<div class="day ${+d === +sel ? 'on' : ''} ${+d === +today ? 'today' : ''} ${has ? 'has' : ''}" data-d="${ymd(d)}">
          <div class="dw">${DOW[d.getDay()]}</div><div class="dn">${d.getDate()}</div><div class="dot"></div></div>`;
      }).join('')}</div>
      <div class="row" style="margin:4px 2px 8px"><b class="grow">${fDay(sel)}</b>
        <button class="btn sm primary" id="add">+ Rezervēt</button></div>
      <div class="timeline" id="tl"><div class="tl-inner" style="height:${24 * HP}px">
        ${Array.from({ length: 24 }, (_, h) => `<div class="tl-hour" data-h="${h}" style="top:${h * HP}px;height:${HP}px">${pad(h)}:00</div>`).join('')}
        ${dayBk.map(b => {
          const s = Math.max(new Date(b.starts_at), sel), e = Math.min(new Date(b.ends_at), addDays(sel, 1));
          const top = (s - sel) / 3600000 * HP, hgt = Math.max(18, (e - s) / 3600000 * HP - 2);
          return `<div class="tl-b ${b.user_id === me().id ? 'mine' : ''} ${b.status === 'completed' ? 'done' : ''}" data-b="${b.id}" style="top:${top}px;height:${hgt}px">
            <b>${fTime(b.starts_at)}–${fTime(b.ends_at)}</b> ${esc(b.full_name)}${b.note ? ' · ' + esc(b.note) : ''}</div>`;
        }).join('')}
        ${+sel === +today ? `<div class="tl-now" style="top:${(Date.now() - today) / 3600000 * HP}px"></div>` : ''}
      </div></div>
      <p class="muted small">🔵 tavas rezervācijas · 🔴 citu · Pieskaries brīvai stundai, lai rezervētu.</p>`;
    const tl = main.querySelector('#tl');
    tl.scrollTop = Math.max(0, ((+sel === +today ? new Date().getHours() - 1 : 7)) * HP);
    main.querySelectorAll('.day').forEach(el => el.onclick = () => { sel = startOfDay(new Date(el.dataset.d + 'T00:00:00')); draw(); });
    main.querySelector('#prev').onclick = () => { weekStart = addDays(weekStart, -14); sel = weekStart; draw(); };
    main.querySelector('#next').onclick = () => { weekStart = addDays(weekStart, 14); sel = weekStart; draw(); };
    main.querySelector('#tdy').onclick = () => { weekStart = today; sel = today; draw(); };
    main.querySelector('#add').onclick = () => bookForm(sel, null, all, draw);
    main.querySelectorAll('.tl-hour').forEach(el => el.onclick = () => bookForm(sel, +el.dataset.h, all, draw));
    main.querySelectorAll('.tl-b').forEach(el => el.onclick = () => {
      const b = dayBk.find(x => x.id === +el.dataset.b);
      const can = (b.user_id === me().id || isAdmin()) && b.status === 'active' && new Date(b.starts_at) > Date.now() - 0;
      modal(`<h3>${esc(b.full_name)}</h3><p>${fDay(b.starts_at)}<br><b>${fTime(b.starts_at)}–${fTime(b.ends_at)}</b> (${fDur((new Date(b.ends_at) - new Date(b.starts_at)) / MIN)})
        ${b.note ? `<br><span class="muted">${esc(b.note)}</span>` : ''}</p>
        ${b.status === 'completed' ? '<p class="badge">pabeigts</p>' : ''}
        <div class="grid2"><button class="btn ghost" data-close>Aizvērt</button>
        ${can ? `<button class="btn red" id="cx">Atcelt rezervāciju</button>` : '<span></span>'}</div>`,
        (m, close) => { m.querySelector('#cx')?.addEventListener('click', async () => { await run(() => api.cancelBooking(b.id), 'Rezervācija atcelta'); close(); draw(); }); });
    });
  }
  await draw();
  if (q.get('new')) bookForm(sel, null, [], draw);
}

function bookForm(day, hour, existing, after) {
  const now = new Date();
  let s = hour != null ? `${pad(hour)}:00` : '';
  if (!s) {
    const base = +startOfDay(day) === +startOfDay(now) ? Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15 : 9 * 60;
    s = `${pad(Math.min(23, Math.floor(base / 60)))}:${pad(base % 60)}`;
  }
  const [sh, sm] = s.split(':').map(Number);
  const em = Math.min(24 * 60, sh * 60 + sm + 120);
  const e = em === 1440 ? '24:00' : `${pad(Math.floor(em / 60))}:${pad(em % 60)}`;
  modal(`<h3>Rezervēt BOX</h3>
    <label>Datums</label><input type="date" id="d" value="${ymd(day)}" min="${ymd(now)}">
    <div class="grid2"><div><label>No</label><select id="s">${timeOptions(s)}</select></div>
      <div><label>Līdz</label><select id="e">${timeOptions(e)}</select></div></div>
    <label>Piezīme (ko remontēsi) — nav obligāti</label><input id="n" maxlength="80" placeholder="piem. bremžu kluči">
    <div class="card flat small" style="margin-top:12px" id="est"></div>
    <div class="err" id="err"></div>
    <div class="grid2"><button class="btn ghost" data-close>Atcelt</button><button class="btn primary" id="ok">Rezervēt</button></div>`,
  (m, close) => {
    const upd = () => {
      const a = toDate(m.querySelector('#d').value, m.querySelector('#s').value), b = toDate(m.querySelector('#d').value, m.querySelector('#e').value);
      const mins = (b - a) / MIN;
      m.querySelector('#est').innerHTML = mins > 0
        ? `Ilgums: <b>${fDur(mins)}</b> · Ja izmanto visu laiku: <b>${fEur(estCost(mins))}</b><br><span class="muted">Maksā par faktisko laiku no iečekošanās līdz izčekošanās (${fEur(state.settings.hourly_rate)}/h, minimums ${state.settings.min_minutes} min).</span>`
        : `<span class="err">Beigu laikam jābūt pēc sākuma</span>`;
    };
    m.querySelectorAll('input,select').forEach(x => x.oninput = upd); upd();
    m.querySelector('#ok').onclick = async () => {
      const d = m.querySelector('#d').value;
      const a = toDate(d, m.querySelector('#s').value), b = toDate(d, m.querySelector('#e').value);
      try { await api.createBooking(a.toISOString(), b.toISOString(), m.querySelector('#n').value.trim()); close(); toast('Rezervēts ✔'); after?.(); }
      catch (x) { m.querySelector('#err').textContent = x.message; }
    };
  });
}

// ===================================================================
// Mans konts
// ===================================================================
async function viewAccount() {
  const main = shell('konts', '<div class="loading">Ielādē…</div>');
  const [sessions, ledger] = await Promise.all([api.mySessions(), api.myLedger()]);
  const now = new Date(); const [mf] = monthRange(now.getFullYear(), now.getMonth());
  const thisMonth = sessions.filter(s => s.checked_out_at && new Date(s.checked_in_at) >= mf);
  const tmMin = thisMonth.reduce((a, s) => a + s.billed_minutes, 0), tmEur = thisMonth.reduce((a, s) => a + +s.amount, 0);
  const balance = ledger.reduce((a, l) => a + +l.amount, 0);
  const kindLv = { usage: 'Lietošana', work: 'Darbs BOX labā', cash: 'Skaidra nauda', adjustment: 'Korekcija' };
  const p = me();
  main.innerHTML = `
    <h2>Mans konts</h2>
    <div class="grid2">
      <div class="card"><div class="kpi-l">Šomēnes (${MON[now.getMonth()]})</div><div class="kpi">${fEur(tmEur)}</div><div class="small muted">${fDur(tmMin)} · ${thisMonth.length} reizes</div></div>
      <div class="card"><div class="kpi-l">${balance > 0.004 ? 'Uzkrātais parāds BOX kasei' : balance < -0.004 ? 'Priekšā samaksāts' : 'Atlikums'}</div>
        <div class="kpi" style="color:${balance > 0.004 ? 'var(--red)' : 'var(--green)'}">${fEur(Math.abs(balance))}</div><div class="small muted">par slēgtajiem mēnešiem</div></div>
    </div>
    <p class="muted small">Šī mēneša summa tiek pievienota atlikumam nākamā mēneša 1. datumā. Norēķinu (ar darbu vai naudu) saskaņo ar administratoru.</p>
    <div class="card"><h3>Lietošanas vēsture</h3>
      ${sessions.length ? `<table><tr><th>Datums</th><th>Laiks</th><th class="num">Ilgums</th><th class="num">€</th></tr>
        ${sessions.map(s => `<tr><td>${fDate(s.checked_in_at)}</td><td>${fTime(s.checked_in_at)}–${s.checked_out_at ? fTime(s.checked_out_at) : '<span class="badge blue">tagad</span>'}</td>
          <td class="num">${s.minutes != null ? fDur(s.minutes) : ''}</td><td class="num">${s.amount != null ? fEur(s.amount) : ''}</td></tr>`).join('')}</table>`
        : '<p class="muted small">Vēl nav lietots.</p>'}</div>
    <div class="card"><h3>Konta kustība</h3>
      ${ledger.length ? `<ul class="list">${ledger.map(l => `<li class="row"><div class="grow"><b>${kindLv[l.kind]}</b> <span class="muted small">${fDate(l.created_at)}</span><br>
        <span class="small muted">${esc(l.description || '')}</span></div><div class="money" style="color:${l.amount > 0 ? 'var(--red)' : 'var(--green)'}">${l.amount > 0 ? '+' : '−'}${fEur(Math.abs(l.amount))}</div></li>`).join('')}</ul>`
        : '<p class="muted small">Vēl nav ierakstu.</p>'}</div>
    <div class="card"><h3>Mani dati</h3><form id="pf">
      <label>Vārds, uzvārds</label><input name="full_name" value="${esc(p.full_name)}" required>
      <label>Telefons</label><input name="phone" value="${esc(p.phone)}">
      <label>Auto</label><input name="car" value="${esc(p.car)}">
      <div class="sp"></div><button class="btn primary block">Saglabāt</button></form></div>
    <button class="btn ghost block" id="out">Iziet no konta</button>`;
  main.querySelector('#pf').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await run(() => api.updateMyProfile(d), 'Saglabāts'); Object.assign(state.session.profile, d);
  };
  main.querySelector('#out').onclick = async () => { await api.signOut(); state.session = null; location.hash = '#/'; boot(); };
}

// ===================================================================
// Kase
// ===================================================================
const CATS = ['elektrība', 'siltums', 'nodokļi', 'instrumenti', 'serviss', 'tīrīšana', 'cits'];
async function viewCash() {
  const main = shell('kase', '<div class="loading">Ielādē…</div>');
  const rows = await api.listCash();
  const inn = rows.filter(r => r.direction === 'in').reduce((a, r) => a + +r.amount, 0);
  const out = rows.filter(r => r.direction === 'out').reduce((a, r) => a + +r.amount, 0);
  main.innerHTML = `
    <h2>BOX kase</h2>
    <p class="muted small">BOX nav paredzēts peļņai. Iemaksas sedz elektrību, siltumu un nodokļus, atlikums — instrumentus un servisa iekārtas.</p>
    <div class="grid2">
      <div class="card"><div class="kpi-l">Kasē šobrīd</div><div class="kpi">${fEur(inn - out)}</div></div>
      <div class="card"><div class="kpi-l">Ienākumi / izdevumi</div><div class="small"><span class="money" style="color:var(--green)">+${fEur(inn)}</span><br><span class="money" style="color:var(--red)">−${fEur(out)}</span></div></div>
    </div>
    ${isAdmin() ? `<div class="card"><h3>Pievienot ierakstu</h3><form id="cf">
      <div class="grid2"><div><label>Datums</label><input type="date" name="entry_date" value="${ymd(new Date())}" required></div>
      <div><label>Veids</label><select name="direction"><option value="out">Izdevumi</option><option value="in">Ienākumi</option></select></div></div>
      <div class="grid2"><div><label>Kategorija</label><select name="category">${['iemaksa', ...CATS].map(c => `<option ${c === 'instrumenti' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div><label>Summa €</label><input name="amount" type="number" step="0.01" min="0.01" required></div></div>
      <label>Apraksts</label><input name="description" placeholder="piem. elektrība oktobris / jauns domkrats">
      <div class="sp"></div><button class="btn primary block">Pievienot</button></form>
      <p class="muted small">Skaidras naudas iemaksas no lietotājiem labāk reģistrēt sadaļā Admins → Norēķini — tad tās samazina arī lietotāja parādu.</p></div>` : ''}
    <div class="card"><h3>Ieraksti</h3>
      ${rows.length ? `<ul class="list">${rows.map(r => `<li class="row"><div class="grow"><b>${esc(r.category)}</b> <span class="muted small">${fDate(r.entry_date)}</span><br>
        <span class="small muted">${esc(r.description || '')}</span></div>
        <div class="money" style="color:${r.direction === 'in' ? 'var(--green)' : 'var(--red)'}">${r.direction === 'in' ? '+' : '−'}${fEur(r.amount)}</div>
        ${isAdmin() ? `<button class="btn sm ghost" data-del="${r.id}">✕</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Vēl nav ierakstu.</p>'}</div>`;
  main.querySelector('#cf')?.addEventListener('submit', async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.amount = +d.amount;
    await run(() => api.addCash(d), 'Pievienots'); viewCash();
  });
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Dzēst šo kases ierakstu?', 'Dzēst', 'red'))) return;
    await run(() => api.deleteCash(+b.dataset.del), 'Dzēsts'); viewCash();
  });
}

// ===================================================================
// Administrators
// ===================================================================
const ADMIN_TABS = [['lietotaji', 'Lietotāji'], ['ieluigumi', 'Ielūgumi'], ['menesis', 'Mēneša atskaite'], ['norekini', 'Norēķini'],
  ['iestatijumi', 'Iestatījumi un QR'], ['iekartas', 'Iekārtas']];

async function viewAdmin(sub, q) {
  if (!isAdmin()) { location.hash = '#/'; return; }
  sub = sub || 'lietotaji';
  const main = shell('admin', `<div class="tabs">${ADMIN_TABS.map(([k, t]) => `<a href="#/admin/${k}" class="${k === sub ? 'on' : ''}">${t}</a>`).join('')}</div><div id="ad"><div class="loading">Ielādē…</div></div>`);
  const el = main.querySelector('#ad');
  const fn = { lietotaji: adUsers, ieluigumi: adInvites, menesis: adMonth, norekini: adPay, iestatijumi: adSettings, iekartas: adDevices }[sub] || adUsers;
  await fn(el, q);
}

async function adUsers(el) {
  const [users, bal] = await Promise.all([api.listProfiles(), api.balances()]);
  const b = Object.fromEntries(bal.map(x => [x.user_id, +x.balance]));
  el.innerHTML = `<div class="card"><h3>Lietotāji (${users.length})</h3><ul class="list">${users.map(u => `<li>
      <div class="row"><div class="grow"><b>${esc(u.full_name)}</b> ${u.role === 'admin' ? '<span class="badge amber">admins</span>' : ''}
        ${u.active ? '<span class="badge green">aktīvs</span>' : '<span class="badge red">neaktīvs</span>'}<br>
        <span class="small muted">${esc(u.phone || '')} ${u.car ? '· ' + esc(u.car) : ''}</span></div>
        <div class="money right" style="color:${(b[u.id] || 0) > 0 ? 'var(--red)' : 'var(--ink)'}">${fEur(b[u.id] || 0)}</div></div>
      ${u.id !== me().id ? `<div class="row" style="margin-top:6px;gap:6px">
        <button class="btn sm ghost" data-act="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Bloķēt' : 'Aktivizēt'}</button>
        <button class="btn sm ghost" data-role="${u.id}" data-v="${u.role === 'admin' ? 'member' : 'admin'}">${u.role === 'admin' ? 'Noņemt admina tiesības' : 'Padarīt par adminu'}</button></div>` : ''}
    </li>`).join('')}</ul><p class="muted small">Summa labajā pusē — uzkrātais parāds BOX kasei par slēgtajiem mēnešiem.</p></div>`;
  el.querySelectorAll('[data-act]').forEach(x => x.onclick = async () => { await run(() => api.updateProfile(x.dataset.act, { active: x.dataset.v === '1' }), 'Saglabāts'); adUsers(el); });
  el.querySelectorAll('[data-role]').forEach(x => x.onclick = async () => {
    if (!(await confirmBox(x.dataset.v === 'admin' ? 'Piešķirt administratora tiesības?' : 'Noņemt administratora tiesības?'))) return;
    await run(() => api.updateProfile(x.dataset.role, { role: x.dataset.v }), 'Saglabāts'); adUsers(el);
  });
}

async function adInvites(el) {
  const list = await api.listInvites();
  const link = c => `${appUrl()}#/login?code=${c}`;
  const waText = (c, n) => `Sveiks${n ? ', ' + n : ''}! 🔧 Šeit tavs personīgais ielūgums BOX garāžas aplikācijā (rezervācija un uzskaite).\n\n1) Atver saiti: ${link(c)}\n2) Reģistrējies (kods jau ievadīts: ${c})\n3) Pievieno aplikāciju telefona sākuma ekrānam:\n   iPhone — Safari ⇧ Kopīgot → Pievienot sākuma ekrānam\n   Android — Chrome ⋮ → Instalēt lietotni\n\nLikme 2 €/h par faktisko lietošanas laiku (min. 1 h). Ar cieņu, Aras`;
  el.innerHTML = `<div class="card"><h3>Jauns ielūgums</h3>
    <p class="muted small">Katram cilvēkam savs vienreizējs kods. Pēc izveides nospied <b>Sūtīt WhatsApp</b> — atvērsies WhatsApp ar gatavu ziņu.</p>
    <form id="f" class="row"><input class="grow" name="note" placeholder="Kam? piem. Roberts" required><button class="btn primary">Izveidot</button></form></div>
    <div class="card"><h3>Ielūgumi</h3>${list.length ? `<ul class="list">${list.map(i => `<li><div class="row"><div class="grow"><b>${esc(i.note || '—')}</b> <span class="code" style="font-size:15px;letter-spacing:1px">${i.code}</span><br>
        ${i.used_by ? `<span class="badge green">izmantots: ${esc(i.used?.full_name || '')}</span>` : '<span class="badge amber">gaida reģistrāciju</span>'}</div></div>
        ${!i.used_by ? `<div class="row" style="margin-top:6px;gap:6px">
          <a class="btn sm wa" target="_blank" href="https://wa.me/?text=${encodeURIComponent(waText(i.code, i.note))}">Sūtīt WhatsApp</a>
          <button class="btn sm ghost" data-copy="${i.code}">Kopēt saiti</button><button class="btn sm ghost" data-del="${i.code}">Dzēst</button></div>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted small">Vēl nav ielūgumu.</p>'}</div>`;
  el.querySelector('#f').onsubmit = async e => { e.preventDefault(); await run(() => api.createInvite(e.target.note.value.trim()), 'Ielūgums izveidots'); adInvites(el); };
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { await navigator.clipboard.writeText(link(b.dataset.copy)).catch(() => {}); toast('Saite nokopēta'); });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await run(() => api.deleteInvite(b.dataset.del), 'Dzēsts'); adInvites(el); });
}

async function adMonth(el, q) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sel = q.get('m') || ym(prev);
  const [y, m] = sel.split('-').map(Number);
  const [f, t] = monthRange(y, m - 1);
  const [sess, status] = await Promise.all([api.listSessions(f.toISOString(), t.toISOString()), api.boxStatus()]);
  const by = {};
  sess.filter(s => s.checked_out_at).forEach(s => { const o = (by[s.user_id] ||= { name: s.full_name, n: 0, min: 0, bill: 0, eur: 0 }); o.n++; o.min += s.minutes; o.bill += s.billed_minutes; o.eur += +s.amount; });
  const rows = Object.values(by).sort((a, b) => b.eur - a.eur);
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, bill: a.bill + r.bill, eur: a.eur + r.eur }), { n: 0, bill: 0, eur: 0 });
  const isPast = t <= now;
  el.innerHTML = `
    ${status ? `<div class="card flat"><b>Šobrīd BOX:</b> ${esc(status.full_name)} kopš ${fDT(status.checked_in_at)}
      <button class="btn sm red" id="fco" style="margin-left:8px">Izčekot</button></div>` : ''}
    <div class="card"><div class="row"><h3 class="grow">Mēneša atskaite</h3><input type="month" id="m" value="${sel}" style="width:auto"></div>
      ${rows.length ? `<table><tr><th>Lietotājs</th><th class="num">Reizes</th><th class="num">Stundas</th><th class="num">Summa</th></tr>
        ${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${(r.bill / 60).toFixed(2).replace('.', ',')}</td><td class="num money">${fEur(r.eur)}</td></tr>`).join('')}
        <tr><th>Kopā</th><th class="num">${tot.n}</th><th class="num">${(tot.bill / 60).toFixed(2).replace('.', ',')}</th><th class="num money">${fEur(tot.eur)}</th></tr></table>`
        : '<p class="muted small">Šajā mēnesī nav pabeigtu lietošanas reižu.</p>'}
      <div class="sp"></div>
      <div class="grid2"><button class="btn ghost" id="csv">⬇ Excel (CSV)</button>
        <button class="btn primary" id="close" ${isPast ? '' : 'disabled'}>Slēgt mēnesi</button></div>
      <p class="muted small">Mēneša slēgšana pārnes katra lietotāja summu uz viņa virtuālo kontu (parādu BOX kasei). To var darīt vienreiz — atkārtota slēgšana neko nedublē.
        Automātiski tas notiek katra mēneša 1. datumā.</p></div>
    <div class="card"><h3>Visas reizes</h3>${sess.length ? `<table><tr><th>Datums</th><th>Kas</th><th>Laiks</th><th class="num">€</th></tr>
      ${sess.map(s => `<tr><td>${fDate(s.checked_in_at)}</td><td>${esc(s.full_name)}</td><td>${fTime(s.checked_in_at)}–${s.checked_out_at ? fTime(s.checked_out_at) : '…'}${s.closed_by ? ' <span class="badge">admins</span>' : ''}</td>
        <td class="num">${s.amount != null ? fEur(s.amount) : ''}</td></tr>`).join('')}</table>` : '<p class="muted small">—</p>'}</div>`;
  el.querySelector('#m').onchange = e => { location.hash = `#/admin/menesis?m=${e.target.value}`; };
  el.querySelector('#fco')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Izčekot ${status.full_name}?`, 'Izčekot', 'red'))) return;
    await run(() => api.checkOut(status.session_id), 'Izčekots'); adMonth(el, q);
  });
  el.querySelector('#close').onclick = async () => {
    if (!(await confirmBox(`Slēgt ${sel} un pārnest summas uz lietotāju kontiem?`, 'Slēgt mēnesi'))) return;
    const n = await run(() => api.closeMonth(`${sel}-01`));
    toast(n ? `Slēgts: ${n} lietotāji` : 'Šis mēnesis jau bija slēgts');
  };
  el.querySelector('#csv').onclick = () => {
    const lines = [['Mēnesis', 'Lietotājs', 'Reizes', 'Faktiskās min', 'Aprēķina min', 'Stundas', 'Summa EUR'].join(';'),
      ...rows.map(r => [sel, r.name, r.n, r.min, r.bill, (r.bill / 60).toFixed(2).replace('.', ','), r.eur.toFixed(2).replace('.', ',')].join(';')),
      '', ['Datums', 'Lietotājs', 'No', 'Līdz', 'Min', 'Aprēķina min', 'EUR'].join(';'),
      ...sess.filter(s => s.checked_out_at).map(s => [fDate(s.checked_in_at), s.full_name, fTime(s.checked_in_at), fTime(s.checked_out_at), s.minutes, s.billed_minutes, (+s.amount).toFixed(2).replace('.', ',')].join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `BOX_atskaite_${sel}.csv`; a.click();
  };
}

async function adPay(el) {
  const [users, bal, led] = await Promise.all([api.listProfiles(), api.balances(), api.listLedgerAll()]);
  const kindLv = { usage: 'Lietošana', work: 'Darbs BOX labā', cash: 'Skaidra nauda', adjustment: 'Korekcija' };
  el.innerHTML = `
    <div class="card"><h3>Atlikumi</h3><table><tr><th>Lietotājs</th><th class="num">Parāds BOX kasei</th></tr>
      ${bal.map(b => `<tr><td>${esc(b.full_name)}</td><td class="num money" style="color:${+b.balance > 0 ? 'var(--red)' : 'var(--ink)'}">${fEur(b.balance)}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>Reģistrēt norēķinu</h3><form id="f">
      <label>Lietotājs</label><select name="user" required>${users.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>
      <label>Veids</label><select name="kind" id="kind">
        <option value="work">Darbs BOX labā (tīrīšana, kurināšana, remonts…)</option>
        <option value="cash">Skaidra nauda (nonāk kasē)</option>
        <option value="adjustment">Korekcija (+ palielina, − samazina parādu)</option></select>
      <div class="grid2"><div><label>Summa €</label><input name="amount" type="number" step="0.01" required></div>
        <div id="hw"><label>Darba stundas</label><input name="hours" type="number" step="0.25" min="0"></div></div>
      <label>Apraksts</label><input name="description" required placeholder="piem. BOX tīrīšana 23.11. / iemaksa skaidrā">
      <div class="sp"></div><button class="btn primary block">Saglabāt</button></form></div>
    <div class="card"><h3>Pēdējās kustības</h3>${led.length ? `<ul class="list">${led.slice(0, 60).map(l => `<li class="row"><div class="grow"><b>${esc(l.full_name)}</b> · ${kindLv[l.kind]} <span class="muted small">${fDate(l.created_at)}</span><br>
      <span class="small muted">${esc(l.description || '')}</span></div><div class="money" style="color:${l.amount > 0 ? 'var(--red)' : 'var(--green)'}">${l.amount > 0 ? '+' : '−'}${fEur(Math.abs(l.amount))}</div></li>`).join('')}</ul>` : '<p class="muted small">—</p>'}</div>`;
  const kind = el.querySelector('#kind'); const hw = el.querySelector('#hw');
  kind.onchange = () => { hw.style.visibility = kind.value === 'work' ? 'visible' : 'hidden'; };
  el.querySelector('#f').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await run(() => api.recordPayment(d.user, d.kind, +d.amount, d.description, d.hours ? +d.hours : null), 'Saglabāts'); adPay(el);
  };
}

async function adSettings(el) {
  const s = await api.getAdminSettings();
  const qrText = `BOX-CHECKIN:${s.checkin_code}`;
  el.innerHTML = `
    <div class="card"><h3>Iečekošanās QR kods</h3>
      <p class="muted small">Izdrukā un piestiprini BOX iekšpusē. Lietotāji to noskenē aplikācijā, lai iečekotos — tā var tikai uz vietas.</p>
      <div class="qrbox" id="qr">…</div><p class="center code">${s.checkin_code}</p>
      <div class="grid2"><button class="btn primary" id="print">🖨 Drukāt</button><button class="btn ghost" id="regen">Mainīt kodu</button></div>
      <p class="muted small">Ja kāds kodu nofotografē un lieto no mājām — nospied <b>Mainīt kodu</b> un izdrukā jaunu.</p></div>
    <div class="card"><h3>Noteikumi</h3><form id="f">
      <div class="grid2"><div><label>Likme €/h</label><input name="hourly_rate" type="number" step="0.01" min="0" value="${s.hourly_rate}"></div>
        <div><label>Minimālā maksa (min)</label><input name="min_minutes" type="number" min="0" step="15" value="${s.min_minutes}"></div></div>
      <div class="grid2"><div><label>Agrākā iečekošanās pirms rezervācijas (min)</label><input name="checkin_early_minutes" type="number" min="0" value="${s.checkin_early_minutes}"></div>
        <div><label>Bez rezervācijas: BOX jābūt brīvam (min)</label><input name="walkin_minutes" type="number" min="15" step="15" value="${s.walkin_minutes}"></div></div>
      <label class="row" style="gap:8px;color:var(--ink)"><input type="checkbox" disabled style="width:auto"> Neierašanās sods (2. posms — vēl neaktīvs)</label>
      <div class="sp"></div><button class="btn primary block">Saglabāt</button></form></div>`;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
    const qr = window.qrcode(0, 'M'); qr.addData(qrText); qr.make();
    el.querySelector('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch { el.querySelector('#qr').textContent = 'QR neizdevās ielādēt — pārbaudi internetu.'; }
  el.querySelector('#print').onclick = () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>BOX QR</title><style>body{font-family:Arial;text-align:center;padding:30px}svg{width:340px;height:340px}h1{font-size:42px;margin:0}p{font-size:20px}.c{font:700 36px monospace;letter-spacing:6px}</style></head>
      <body><h1>BOX</h1><p>Iečekošanās / izčekošanās</p>${el.querySelector('#qr').innerHTML}<p class="c">${s.checkin_code}</p>
      <p>Atver aplikāciju BOX → <b>Iečekoties</b> → skenē šo kodu.<br>Beidzot darbu — <b>Izčekoties</b>.<br>Likme ${fEur(s.hourly_rate)}/h, min. ${s.min_minutes} min.</p>
      <script>setTimeout(()=>print(),400)<\/script></body></html>`);
    w.document.close();
  };
  el.querySelector('#regen').onclick = async () => {
    if (!(await confirmBox('Mainīt iečekošanās kodu? Vecais QR vairs nedarbosies.', 'Mainīt', 'red'))) return;
    const c = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    await run(() => api.updateSettings({ checkin_code: c }), 'Kods nomainīts'); adSettings(el);
  };
  el.querySelector('#f').onsubmit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); for (const k in d) d[k] = +d[k];
    await run(() => api.updateSettings(d), 'Saglabāts'); state.settings = await api.getSettings();
  };
}

async function adDevices(el) {
  const list = await api.listDevices();
  const kindLv = { shelly_lift: '⚡ Shelly relejs — pacēlājs', shelly_door: '🔒 Shelly relejs — durvis', camera: '📹 AI kamera' };
  el.innerHTML = `<div class="card"><h3>Iekārtas</h3>
    <p class="muted small">Vietas iekārtām ir rezervētas aplikācijā un datubāzē. Tās pieslēgsim nākamajos posmos:</p>
    <ul class="list">${list.map(d => `<li class="row"><div class="grow"><b>${esc(d.name)}</b><br><span class="small muted">${kindLv[d.kind] || d.kind} · ${esc(d.location || '')}</span></div>
      <span class="badge">${d.enabled ? 'aktīvs' : 'neaktīvs'}</span></li>`).join('')}</ul></div>
    <div class="card flat small"><b>2. posms — Shelly relejs:</b> pacēlājam HOFMANN strāva tiek ieslēgta pēc iečekošanās un izslēgta pēc izčekošanās.<br><br>
    <b>3. posms — 2 AI kameras:</b> BOX aizņemtības noteikšana (auto / cilvēks), brīdinājums adminam, ja BOX lieto bez iečekošanās. Tiešraide — tikai adminam (datu aizsardzības prasības).</div>`;
}

// ===================================================================
// Maršrutētājs
// ===================================================================
async function route() {
  clearTimers();
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  const { parts, q } = parseHash();
  if (!state.session) return viewLogin(q);
  if (!state.session.profile.active) return viewPending();
  try {
    switch (parts[0]) {
      case undefined: return await viewHome(q);
      case 'checkin': return await viewHome(q);
      case 'kalendars': return await viewCalendar(q);
      case 'konts': return await viewAccount();
      case 'kase': return await viewCash();
      case 'admin': return await viewAdmin(parts[1], q);
      case 'login': location.hash = '#/'; return;
      default: return await viewHome(q);
    }
  } catch (e) {
    console.error(e);
    const main = document.getElementById('main') || $app;
    main.innerHTML = `<div class="card"><h3>Kļūda</h3><p class="err">${esc(e.message)}</p><button class="btn ghost" onclick="location.reload()">Pārlādēt</button></div>`;
  }
}

async function boot() {
  try {
    state.session = await api.getSession();
    if (state.session?.profile?.active) state.settings = await api.getSettings();
  } catch (e) { console.error(e); state.session = null; }
  route();
}

window.addEventListener('hashchange', route);
boot();
