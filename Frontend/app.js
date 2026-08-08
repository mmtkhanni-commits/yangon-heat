/* Yangon Heat — front end.
   Talks to the FastAPI backend. Set window.API_BASE before this script loads if
   the API lives on another host; otherwise it uses the current origin. */

function apiBase() {
  if (window.API_BASE) return window.API_BASE.replace(/\/$/, '');

  // During local development the page is usually served by a plain static
  // server on another port, so point at the API's default port instead of
  // asking the static server for /api paths it does not have.
  const { hostname, port, protocol } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && port !== '8000') return `${protocol}//${hostname}:8000`;

  return '';   // same origin — uvicorn serving the frontend, or deployed together
}

const API = apiBase();
const STORE = 'yangon-heat';

const state = {
  lang: localStorage.getItem(`${STORE}:lang`) || 'my',
  township: localStorage.getItem(`${STORE}:township`) || null,
  view: 'today',
  lastAdvice: '',
  live: null,
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- language */

function applyLanguage() {
  document.documentElement.lang = state.lang === 'my' ? 'my' : 'en';

  // Leaflet bakes its labels in at build time, so the map is rebuilt from
  // scratch rather than patched
  if (mapState.map) {
    mapState.map.remove();
    mapState.map = null;
    mapState.control = null;
    mapState.polygons = mapState.pins = mapState.heat = null;
    satLayers.lst = satLayers.ndvi = null;
    const lst = $('lstToggle');
    const ndvi = $('ndviToggle');
    if (lst) lst.checked = false;
    if (ndvi) ndvi.checked = false;
  }
  document.querySelectorAll('[data-my]').forEach((node) => {
    const text = state.lang === 'my' ? node.dataset.my : node.dataset.en;
    if (text) node.textContent = text;
  });
  $('langToggle').textContent = state.lang === 'my' ? 'EN' : 'မြန်မာ';

  const bar = document.getElementById('installBar');
  if (bar && !bar.hidden) showInstallBar(bar.dataset.mode || 'android');
  if (state.live) render();
}

function say(my, en) {
  return state.lang === 'my' ? my : en;
}

/* ------------------------------------------------------------------ colour */

const RAMP = ['#3D7EA6', '#4E9E7E', '#E3A857', '#C9502F', '#A31E1E'];

function tempColour(temp, lo, hi) {
  const span = Math.max(hi - lo, 0.1);
  const idx = Math.min(Math.floor(((temp - lo) / span) * RAMP.length), RAMP.length - 1);
  return RAMP[Math.max(idx, 0)];
}

const LEVEL_COLOUR = {
  danger: '#A31E1E',
  warning: '#C9502F',
  warm: '#E3A857',
  comfortable: '#4E9E7E',
};

/* --------------------------------------------------------------------- map */

const mapState = {
  map: null, boundaries: null,
  polygons: null, pins: null, heat: null, control: null,
  bases: {},
};

async function ensureMap() {
  if (mapState.map || typeof L === 'undefined') return mapState.map;

  mapState.map = L.map('map', { scrollWheelZoom: false }).setView([16.82, 96.16], 11);

  // two base maps: the street view matches the original dashboard, the dark one
  // suits the rest of this page
  mapState.bases[say('လမ်းမြေပုံ', 'Street')] = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '&copy; OpenStreetMap', maxZoom: 19 });

  mapState.bases[say('မှောင်မိုက်', 'Dark')] = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 });

  Object.values(mapState.bases)[1].addTo(mapState.map);

  try {
    mapState.boundaries = await api('/api/boundaries');
  } catch (_) {
    mapState.boundaries = null;
  }
  return mapState.map;
}

function drawMapScale(lo, hi) {
  $('mapScale').innerHTML =
    `<span>${lo.toFixed(1)}°</span>` +
    `<span class="swatches">${RAMP.map((c) => `<span style="background:${c}"></span>`).join('')}</span>` +
    `<span>${hi.toFixed(1)}°</span>`;
}

function pinIcon(row) {
  // colour and glyph both carry the level, so the map still reads for anyone
  // who cannot tell red from green
  let colour = 'var(--delta)';
  let glyph = '🍃';
  if (row.uhi_level >= 4) { colour = 'var(--ember)'; glyph = '🔥'; }
  else if (row.uhi_level >= 2) { colour = 'var(--thanaka)'; glyph = '❗'; }

  const mine = row.name === state.township ? ' is-mine' : '';
  return L.divIcon({
    className: '',
    html: `<div class="uhi-pin${mine}" style="background:${colour}"><span>${glyph}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

function popupHtml(row) {
  const name = state.lang === 'my' ? row.name_my : row.name;
  return `
    <h4>${name}</h4>
    <dl>
      <dt>${say('အပူချိန်', 'Temperature')}</dt><dd>${row.temp} °C</dd>
      <dt>${say('ခံစားရသော', 'Feels like')}</dt><dd>${row.feels_like ?? row.temp} °C</dd>
      <dt>${say('လေထုအရည်အသွေး', 'Air quality')}</dt><dd>${row.aqi || '—'}</dd>
      <dt>${say('အပူအဆင့်', 'UHI level')}</dt><dd>${row.uhi_level}</dd>
      <dt>${say('မြို့ပျမ်းမျှနှင့်', 'vs city avg')}</dt><dd>${row.anomaly > 0 ? '+' : ''}${row.anomaly} °C</dd>
      <dt>${say('ထိခိုက်လွယ်မှု', 'Vulnerability')}</dt><dd>${row.vulnerability}</dd>
    </dl>
    <button class="go" data-goto="${row.name}">${say('ဤမြို့နယ်ကို ရွေးမည်', 'Select this township')}</button>`;
}

async function renderMap() {
  const map = await ensureMap();
  if (!map) return;

  const rows = state.live.townships;
  const temps = rows.map((r) => r.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const byName = Object.fromEntries(rows.map((r) => [r.name.toLowerCase(), r]));
  drawMapScale(lo, hi);

  ['polygons', 'pins', 'heat'].forEach((key) => {
    if (mapState[key]) { mapState[key].remove(); mapState[key] = null; }
  });
  if (mapState.control) { mapState.control.remove(); mapState.control = null; }

  // 1 — shaded township outlines
  if (mapState.boundaries) {
    mapState.polygons = L.geoJSON(mapState.boundaries, {
      style: (feature) => {
        const row = matchRow(feature, byName);
        const mine = row && row.name === state.township;
        return {
          fillColor: row ? tempColour(row.temp, lo, hi) : '#2A323D',
          fillOpacity: row ? 0.5 : 0.18,
          color: mine ? '#E8EDF3' : '#0D1117',
          weight: mine ? 2.5 : 0.8,
        };
      },
      onEachFeature: (feature, layer) => {
        const row = matchRow(feature, byName);
        if (!row) return;
        layer.bindTooltip(
          `${state.lang === 'my' ? row.name_my : row.name} · ${row.temp}°C`, { sticky: true });
        layer.on('click', () => selectTownship(row.name));
      },
    }).addTo(map);
  }

  // 2 — pins with popups
  mapState.pins = L.layerGroup(rows.map((row) => {
    const marker = L.marker([row.coords[0], row.coords[1]], { icon: pinIcon(row) });
    marker.bindPopup(popupHtml(row));
    return marker;
  })).addTo(map);

  // 3 — heat surface weighted by UHI level
  if (typeof L.heatLayer === 'function') {
    mapState.heat = L.heatLayer(
      rows.map((r) => [r.coords[0], r.coords[1], r.uhi_level / 5]),
      { radius: 30, blur: 22, maxZoom: 13,
        gradient: { 0.2: '#3D7EA6', 0.4: '#4E9E7E', 0.6: '#E3A857', 0.8: '#C9502F', 1: '#A31E1E' } });
  }

  const overlays = {};
  if (mapState.polygons) overlays[say('မြို့နယ်နယ်နိမိတ်', 'Township outlines')] = mapState.polygons;
  overlays[say('အပူချိန် အမှတ်အသားများ', 'Township pins')] = mapState.pins;
  if (mapState.heat) overlays[say('အပူပြင်းအား', 'Heat intensity')] = mapState.heat;
  Object.assign(overlays, satOverlays());

  mapState.control = L.control.layers(mapState.bases, overlays,
    { collapsed: true }).addTo(map);

  map.on('popupopen', (event) => {
    const button = event.popup.getElement().querySelector('[data-goto]');
    if (button) button.addEventListener('click', () => {
      map.closePopup();
      selectTownship(button.dataset.goto);
    });
  });

  focusSelected(map);
}

function satOverlays() {
  const out = {};
  if (satLayers.lst) out[say('ဂြိုဟ်တု အပူချိန်', 'Satellite temperature')] = satLayers.lst;
  if (satLayers.ndvi) out[say('သစ်ပင်ဖုံးလွှမ်းမှု', 'Vegetation cover')] = satLayers.ndvi;
  return out;
}

function focusSelected(map) {
  // downtown townships are tiny next to Taikkyi or Hlegu, so framing the whole
  // region hides most of them
  const mine = state.live.townships.find((r) => r.name === state.township);
  if (!mine) return;

  let target = null;
  if (mapState.polygons) {
    mapState.polygons.eachLayer((layer) => {
      const row = matchRow(layer.feature, { [mine.name.toLowerCase()]: mine });
      if (row && row.name === mine.name) target = layer;
    });
  }

  if (target && target.getBounds) {
    map.fitBounds(target.getBounds().pad(1.4), { maxZoom: 12 });
  } else {
    map.setView([mine.coords[0], mine.coords[1]], 12);
  }
}

function matchRow(feature, byName) {
  const raw = (feature.properties.shapeName || '').toLowerCase();
  if (byName[raw]) return byName[raw];
  const squash = (s) => s.replace(/[^a-z0-9]/g, '');
  const target = squash(raw);
  return Object.values(byName).find((r) => squash(r.name.toLowerCase()) === target) || null;
}

/* ----------------------------------------------------------------- install */

// Chrome fires beforeinstallprompt and lets us trigger the real dialog.
// Safari fires nothing at all, so iOS gets written instructions instead.
let deferredInstall = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallBar(mode) {
  if (isStandalone()) return;                                  // already installed
  if (localStorage.getItem(`${STORE}:install-dismissed`)) return;

  const bar = $('installBar');
  $('installTitle').textContent = say('ဖုန်းမှာ တင်ထားပါ',
                                      'Add it to your home screen');
  $('installBody').textContent = mode === 'ios'
    ? say('Safari ရဲ့ မျှဝေခလုတ်မှတစ်ဆင့် တင်နိုင်ပါသည်။',
          'Install it from the Safari share menu.')
    : say('App လိုပဲ ပွင့်ပြီး အင်တာနက်မရှိလည်း နောက်ဆုံးအချက်အလက် ကြည့်နိုင်သည်။',
          'Opens like an app, and the last reading stays available offline.');
  $('installGo').textContent = mode === 'ios'
    ? say('ဘယ်လိုလုပ်ရမလဲ', 'How')
    : say('တင်မည်', 'Install');

  bar.dataset.mode = mode;
  bar.hidden = false;
}

function iosInstructions() {
  const log = $('chatLog');
  $('chatSheet').hidden = false;
  log.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = `
    <b>${say('ဖုန်းမှာ တင်နည်း', 'Add to your home screen')}</b>
    <ul class="ios-steps">
      <li><span class="num">1</span>
        <span>${say('အောက်ခြေက', 'Tap the share button')}
          <span class="glyph">&#x2934;</span>
          ${say('မျှဝေခလုတ်ကို နှိပ်ပါ', 'at the bottom of Safari')}</span></li>
      <li><span class="num">2</span>
        <span>${say('“Add to Home Screen” ကို ရွေးပါ',
                    'Choose "Add to Home Screen"')}</span></li>
      <li><span class="num">3</span>
        <span>${say('“Add” နှိပ်ပါ — ဖုန်းမျက်နှာပြင်တွင် icon ပေါ်လာပါမည်',
                    'Tap "Add" — the icon appears on your home screen')}</span></li>
    </ul>
    <p style="margin:10px 0 0;font-size:12.5px;color:var(--muted)">
      ${say('Chrome တွင် မရပါ — Safari ဖြင့်သာ ဖွင့်ပါ။',
            'This only works in Safari, not Chrome on iPhone.')}
    </p>`;
  log.append(wrap);
}

async function runInstall() {
  const bar = $('installBar');

  if (bar.dataset.mode === 'ios') {
    iosInstructions();
    return;
  }

  if (!deferredInstall) {
    toast(say('ဤ browser တွင် တိုက်ရိုက် တင်၍ မရပါ — menu မှ “Add to Home screen” ကို သုံးပါ။',
              'Use the browser menu, then "Add to Home screen".'));
    return;
  }

  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  bar.hidden = true;

  if (outcome === 'accepted') {
    toast(say('တင်ပြီးပါပြီ 🎉', 'Installed 🎉'));
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  showInstallBar('android');
});

window.addEventListener('appinstalled', () => {
  $('installBar').hidden = true;
  toast(say('ဖုန်းမျက်နှာပြင်တွင် ထည့်ပြီးပါပြီ။', 'Added to your home screen.'));
});

/* ------------------------------------------------------------------- views */

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('is-active', view.id === `view-${name}`);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === name);
  });

  state.view = name;
  const url = new URL(window.location);
  url.searchParams.set('view', name);
  history.replaceState({}, '', url);

  closeDrawer();
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Leaflet measures its container on creation; a hidden one measures as zero
  if (name === 'map' && mapState.map) {
    setTimeout(() => mapState.map.invalidateSize(), 60);
  }
  if (name === 'map') renderMap();
  if (name === 'air') renderAir();
  if (name === 'compare') { fillCompare(); renderHistory(); }
}

function openDrawer() {
  $('sidenav').classList.add('is-open');
  $('scrim').hidden = false;
  $('burger').setAttribute('aria-expanded', 'true');
}

function closeDrawer() {
  $('sidenav').classList.remove('is-open');
  $('scrim').hidden = true;
  $('burger').setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------------------ toasts */

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* -------------------------------------------------------------- networking */

async function api(path, options = {}, attempt = 0) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkError) {
    // free hosting sleeps when idle and can take most of a minute to wake.
    // Only retry reads and the assistant — never a write, which would submit
    // a report or subscription twice.
    const safeToRetry = !options.method || options.method === 'GET'
      || path === '/api/chat';

    if (attempt < 2 && safeToRetry) {
      if (attempt === 0) {
        toast(say('ဆာဗာကို နှိုးနေသည် — ခဏစောင့်ပါ…',
                  'Waking the server — this can take up to a minute…'));
      }
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return api(path, options, attempt + 1);
    }
    throw networkError;
  }
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      detail = (await response.json()).detail || detail;
    } catch (_) { /* response had no JSON body */ }
    throw new Error(detail);
  }
  return response.json();
}

async function loadLive() {
  try {
    const data = await api('/api/live');
    state.live = data;
    localStorage.setItem(`${STORE}:live`, JSON.stringify({ data, cachedAt: Date.now() }));
    $('feedDot').className = 'pulse';
    return data;
  } catch (error) {
    const cached = localStorage.getItem(`${STORE}:live`);
    if (cached) {
      const { data, cachedAt } = JSON.parse(cached);
      state.live = data;
      $('feedDot').className = 'pulse offline';
      const age = Math.round((Date.now() - cachedAt) / 60000);
      toast(say(`ချိတ်ဆက်မှု မရပါ — ${age} မိနစ်ကြာ အချက်အလက်ဟောင်း ပြသနေသည်။`,
                `Offline — showing readings from ${age} min ago.`));
      return data;
    }
    $('feedDot').className = 'pulse offline';
    throw error;
  }
}

/* --------------------------------------------------------------- rendering */

function fillTownshipPicker() {
  const select = $('townshipPick');
  const names = [...state.live.townships].sort((a, b) =>
    a.name.localeCompare(b.name));
  select.innerHTML = names.map((t) =>
    `<option value="${t.name}">${state.lang === 'my' ? t.name_my : t.name}</option>`
  ).join('');
  select.value = state.township;
}

function renderRibbon() {
  const rows = state.live.townships;              // already hottest first
  const temps = rows.map((r) => r.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = Math.max(hi - lo, 0.1);

  $('ribbon').innerHTML = rows.map((r) => {
    const height = 34 + ((r.temp - lo) / span) * 66;   // never a zero-height bar
    const label = state.lang === 'my' ? r.name_my : r.name;
    const mine = r.name === state.township ? ' is-mine' : '';
    return `<button type="button" role="listitem" class="bar${mine}"
              data-name="${r.name}"
              style="height:${height}%;background:${tempColour(r.temp, lo, hi)}"
              title="${label} — ${r.temp} °C"
              aria-label="${label}, ${r.temp} degrees"></button>`;
  }).join('');

  const hot = rows[0];
  const cool = rows[rows.length - 1];
  $('ribbonHot').textContent =
    `${state.lang === 'my' ? hot.name_my : hot.name} ${hot.temp}°`;
  $('ribbonCool').textContent =
    `${state.lang === 'my' ? cool.name_my : cool.name} ${cool.temp}°`;

  $('ribbon').querySelectorAll('button').forEach((bar) => {
    bar.addEventListener('click', () => selectTownship(bar.dataset.name));
  });

  renderMap();
}

function renderHero(detail) {
  const t = detail.township;
  const g = detail.guidance;

  $('temp').textContent = t.temp.toFixed(1);
  $('verdict').textContent = state.lang === 'my' ? g.headline_my : g.headline_en;
  renderAdvice(g);

  const colour = LEVEL_COLOUR[g.level] || 'var(--muted)';
  $('hero').style.borderLeftColor = colour;
  $('verdict').style.color = colour;

  $('feels').textContent = t.feels_like != null ? `${t.feels_like.toFixed(1)}°` : '—';
  $('aqi').textContent = t.aqi ? t.aqi : '—';
  $('anomaly').textContent = t.anomaly > 0 ? `+${t.anomaly}°` : `${t.anomaly}°`;

  const stamp = detail.observed_at
    ? detail.observed_at.replace('T', ' ')
    : say('အချိန်မသိ', 'time unknown');
  $('stamp').textContent = say(
    `${stamp} · ${detail.city.rank}/${detail.city.total} အပူဆုံး`,
    `${stamp} · ${detail.city.rank} of ${detail.city.total} hottest`
  );
}

function niceTicks(lo, hi, count = 4) {
  // round the axis to values a reader recognises rather than raw data extremes
  const raw = (hi - lo) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((m) => magnitude * m >= raw) * magnitude;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(2)));
  return ticks;
}

function renderSpark(hours) {
  const svg = $('spark');
  if (!hours.length) { svg.innerHTML = ''; return; }

  const W = 320;
  const H = 110;
  const temps = hours.map((h) => h.temp);
  const feels = hours.map((h) => h.feels_like ?? h.temp);
  const ticks = niceTicks(Math.min(...temps, ...feels) - 0.5,
                          Math.max(...temps, ...feels) + 0.5);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const PAD = 14;   // room for the bottom axis line
  const x = (i) => (i / (hours.length - 1)) * W;
  const y = (v) => (H - PAD) - ((v - lo) / (hi - lo)) * (H - PAD - 6);

  const path = (values) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const peakIdx = temps.indexOf(Math.max(...temps));
  const grid = ticks.map((t) =>
    `<line class="grid" x1="0" y1="${y(t).toFixed(1)}" x2="${W}" y2="${y(t).toFixed(1)}"/>`).join('');

  svg.innerHTML = `
    ${grid}
    <path class="band" d="${path(temps)}L${W},${(H - PAD)}L0,${(H - PAD)}Z"/>
    <path class="feels" d="${path(feels)}"/>
    <path class="line" d="${path(temps)}"/>
    <circle class="peak" cx="${x(peakIdx).toFixed(1)}" cy="${y(temps[peakIdx]).toFixed(1)}" r="3.5"/>
    <line class="axis" x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}"/>
  `;

  $('sparkY').innerHTML = [...ticks].reverse()
    .map((t) => `<span>${t}°</span>`).join('');

  const fmt = (stamp) => stamp.slice(11, 16);
  $('sparkAxis').innerHTML =
    `<span>${fmt(hours[0].time)}</span>` +
    `<span>${fmt(hours[Math.floor(hours.length / 2)].time)}</span>` +
    `<span>${fmt(hours[hours.length - 1].time)}</span>`;

  const peak = hours[peakIdx];
  const when = peak.time.slice(5, 10).replace('-', '/') + ' ' + fmt(peak.time);
  $('peakNote').textContent = say(
    `အပူဆုံး ${peak.temp}°C — ${when}`,
    `Peaks at ${peak.temp}°C on ${when}`
  );
}

function render() {
  fillTownshipPicker();
  fillCompare();
  renderGreening();
  renderHistory();
  renderRibbon();
  if (!chatHistory.length) greetChat();
  const row = state.live.townships.find((t) => t.name === state.township);
  if (row) {
    // rebuild the hero from cached data so a language switch is instant
    loadDetail();
  }
}

/* ------------------------------------------------------------- interaction */

async function loadDetail() {
  try {
    const detail = await api(`/api/township/${encodeURIComponent(state.township)}`);
    renderHero(detail);
  } catch (error) {
    const row = state.live?.townships.find((t) => t.name === state.township);
    if (row) {
      $('temp').textContent = row.temp.toFixed(1);
      $('feels').textContent = row.feels_like != null ? `${row.feels_like}°` : '—';
      $('aqi').textContent = row.aqi || '—';
      $('anomaly').textContent = row.anomaly > 0 ? `+${row.anomaly}°` : `${row.anomaly}°`;
    }
  }

  try {
    const forecast = await api(`/api/forecast?township=${encodeURIComponent(state.township)}`);
    renderSpark(forecast.hours.slice(0, 48));
  } catch (_) {
    $('peakNote').textContent = say('ခန့်မှန်းချက် မရနိုင်ပါ။', 'Forecast unavailable.');
  }
}

function selectTownship(name) {
  state.township = name;
  localStorage.setItem(`${STORE}:township`, name);
  const url = new URL(window.location);
  url.searchParams.set('township', name);
  history.replaceState({}, '', url);
  $('townshipPick').value = name;
  renderRibbon();
  renderGreening();
  if (state.view === 'air') renderAir();
  loadDetail();
}

function useLocation() {
  if (!navigator.geolocation) {
    toast(say('ဤစက်တွင် တည်နေရာ မရနိုင်ပါ။', 'This device cannot share a location.'));
    return;
  }
  const button = $('locateBtn');
  button.disabled = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const near = await api(
        `/api/nearest?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      selectTownship(near.name);
      toast(say(`${near.name_my} — ${near.distance_km} ကီလိုမီတာ အကွာ`,
                `${near.name} — ${near.distance_km} km away`));
    } catch (error) {
      toast(say('ရန်ကုန်တိုင်းအတွင်း မဟုတ်ပါ။', String(error.message)));
    } finally {
      button.disabled = false;
    }
  }, () => {
    button.disabled = false;
    toast(say('တည်နေရာ ခွင့်ပြုချက် မရပါ။', 'Location permission was declined.'));
  }, { timeout: 10000 });
}

/* -------------------------------------------------------------- satellite */

const satLayers = { lst: null, ndvi: null };

async function setupSatellite() {
  try {
    const status = await api('/api/satellite/status');
    if (!status.ready) {
      $('satControls').hidden = false;
      $('lstToggle').disabled = true;
      $('ndviToggle').disabled = true;
      $('satNote').className = 'formnote';
      $('satNote').textContent = say(
        'ဂြိုဟ်တုပုံများ မရနိုင်သေးပါ။', `Satellite layers unavailable — ${status.message}`);
      return;
    }
    $('satControls').hidden = false;
  } catch (_) {
    return;   // no satellite support on this server; leave the panel hidden
  }

  $('lstToggle').addEventListener('change', (e) =>
    toggleSatellite('lst', '/api/satellite/lst', e.target));
  $('ndviToggle').addEventListener('change', (e) =>
    toggleSatellite('ndvi', '/api/satellite/ndvi', e.target));
}

async function toggleSatellite(key, path, checkbox) {
  const map = await ensureMap();
  if (!map) return;

  if (!checkbox.checked) {
    if (satLayers[key]) {
      if (mapState.control) mapState.control.removeLayer(satLayers[key]);
      satLayers[key].remove();
      satLayers[key] = null;
    }
    $('satNote').textContent = '';
    return;
  }

  checkbox.disabled = true;
  $('satNote').className = 'formnote';
  $('satNote').textContent = say('ဂြိုဟ်တုပုံ ဆွဲနေသည်…', 'Fetching the satellite composite…');

  try {
    const layer = await api(path);
    satLayers[key] = L.tileLayer(layer.tile_url, {
      opacity: key === 'lst' ? 0.65 : 0.6,
      attribution: key === 'lst'
        ? 'Google Earth Engine / USGS Landsat'
        : 'Google Earth Engine / Copernicus Sentinel-2',
    }).addTo(map);

    if (mapState.control) {
      mapState.control.addOverlay(satLayers[key], key === 'lst'
        ? say('ဂြိုဟ်တု အပူချိန်', 'Satellite temperature')
        : say('သစ်ပင်ဖုံးလွှမ်းမှု', 'Vegetation cover'));
    }

    $('satNote').className = 'formnote ok';
    $('satNote').textContent = key === 'lst'
      ? say(`ပုံ ${layer.scenes} ပုံမှ ပေါင်းစပ်ထားသည် · နောက်ဆုံး ${layer.latest_pass} · ${layer.min}–${layer.max}°C`,
            `Composite of ${layer.scenes} scenes · latest ${layer.latest_pass} · ${layer.min}–${layer.max}°C`)
      : say(`Sentinel-2 ပုံ ${layer.scenes} ပုံ · အညို = ဗလာ၊ အစိမ်း = သစ်ပင်ထူထပ်`,
            `${layer.scenes} Sentinel-2 scenes · brown = bare, green = dense vegetation`);
  } catch (error) {
    checkbox.checked = false;
    $('satNote').className = 'formnote bad';
    $('satNote').textContent = error.message;
  } finally {
    checkbox.disabled = false;
  }
}

/* ------------------------------------------------------------------- voice */

let recorder = null;
let chunks = [];

async function toggleRecording() {
  const button = $('micBtn');

  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }

  const secure = window.isSecureContext
    || ['localhost', '127.0.0.1'].includes(location.hostname);

  if (!secure) {
    toast(say('အသံဖြင့်မေးရန် HTTPS လိုအပ်သည် — ယခုအတိုင်း စာရိုက်ပြီး မေးနိုင်ပါသည်။',
              'Voice input needs HTTPS. Type your question instead for now.'));
    return;
  }

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast(say('ဤ browser တွင် အသံသွင်းခြင်း မရနိုင်ပါ။',
              'This browser does not support recording.'));
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    chunks = [];

    recorder.addEventListener('dataavailable', (e) => chunks.push(e.data));
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      button.classList.remove('recording');
      button.disabled = true;

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'question.webm');
      form.append('lang', state.lang);   // auto-detect misreads Burmese as Chinese

      try {
        const response = await fetch(`${API}/api/transcribe`, { method: 'POST', body: form });
        if (!response.ok) {
          const detail = (await response.json()).detail || response.status;
          throw new Error(detail);
        }
        const { text } = await response.json();
        if (text) {
          // put it in the box first — Burmese transcription is imperfect, so
          // the reader gets a chance to correct it before it is sent
          $('chatInput').value = text;
          $('chatInput').focus();
          toast(say('စစ်ဆေးပြီး ↑ ကို နှိပ်ပါ။', 'Check it, then tap ↑ to send.'));
        } else {
          toast(say('စကားသံ မကြားရပါ။', 'Nothing was picked up.'));
        }
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    });

    recorder.start();
    button.classList.add('recording');
    toast(say('အသံသွင်းနေသည် — ပြီးလျှင် ထပ်နှိပ်ပါ။', 'Recording — tap again when done.'));
  } catch (_) {
    toast(say('မိုက်ခရိုဖုန်း ခွင့်ပြုချက် မရပါ။', 'Microphone permission was declined.'));
  }
}

/* ------------------------------------------------------------------ report */

async function downloadPdf() {
  const button = $('pdfBtn');
  const note = $('pdfNote');
  button.disabled = true;
  note.className = 'formnote';
  note.textContent = say('ပြင်ဆင်နေသည်…', 'Preparing…');

  try {
    const response = await fetch(`${API}/api/report.pdf?lang=${state.lang}`);
    if (!response.ok) {
      const detail = (await response.json()).detail || response.status;
      throw new Error(detail);
    }
    const burmeseOk = response.headers.get('X-Burmese-Font') === 'yes';
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yangon-heat-${new Date().toISOString().slice(0, 10)}.pdf`;
    link.click();
    URL.revokeObjectURL(url);

    note.className = 'formnote ok';
    note.textContent = (state.lang === 'my' && !burmeseOk)
      ? say('PDF ရပါပြီ။ ဆာဗာတွင် မြန်မာစာလုံး မရှိသဖြင့် အင်္ဂလိပ်လို ထုတ်ထားသည် — မြန်မာလိုလိုလျှင် "ပုံနှိပ်မည်" ကို သုံးပါ။',
            'Downloaded, in English — the server has no Myanmar font. Use Print for Burmese.')
      : say('PDF ရပါပြီ။', 'Downloaded.');
  } catch (error) {
    note.className = 'formnote bad';
    note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

/* -------------------------------------------------------------- comparison */

function label(row) {
  return state.lang === 'my' ? row.name_my : row.name;
}

function fillCompare() {
  const rows = [...state.live.townships].sort((a, b) => a.name.localeCompare(b.name));
  const options = rows.map((r) =>
    `<option value="${r.name}">${label(r)}</option>`).join('');

  ['cmpA', 'cmpB'].forEach((id, i) => {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = options;
    select.value = previous || (i === 0 ? state.township : rows[rows.length - 1].name);
  });
  renderCompare();
}

function renderCompare() {
  const find = (name) => state.live.townships.find((r) => r.name === name);
  const a = find($('cmpA').value);
  const b = find($('cmpB').value);
  if (!a || !b) return;

  const cell = (row) => `
    <div class="cell" style="border-left-color:${tempColour(row.temp,
        Math.min(a.temp, b.temp) - 0.5, Math.max(a.temp, b.temp) + 0.5)}">
      <h3>${label(row)}</h3>
      <div class="big">${row.temp}°</div>
      <div class="sub">${say('ခံစားရသော', 'feels')} ${row.feels_like ?? row.temp}° ·
        AQI ${row.aqi || '—'}</div>
    </div>`;

  const gap = Math.abs(a.temp - b.temp).toFixed(1);
  const hotter = a.temp >= b.temp ? a : b;
  const line = a.name === b.name
    ? say('မြို့နယ် နှစ်ခု ရွေးပါ။', 'Pick two different townships.')
    : say(`${label(hotter)} က ${gap}°C ပိုပူသည်။ လေထုအရည်အသွေး ကွာခြားချက် ${Math.abs(a.aqi - b.aqi)} ။`,
          `${label(hotter)} is ${gap}°C hotter. Air quality differs by ${Math.abs(a.aqi - b.aqi)} points.`);

  $('cmpResult').innerHTML = cell(a) + cell(b) +
    `<p class="verdict-line">${line}</p>`;
}

/* ------------------------------------------------------------ illustration */

// Small scenes drawn inline rather than shipped as images, so they follow the
// palette, animate, and cost nothing to load.
const ART = {
  comfortable: `<svg viewBox="0 0 80 80" width="78" height="78">
    <circle cx="40" cy="40" r="30" fill="#1B3326"/>
    <g class="sway">
      <rect x="38" y="46" width="4" height="16" rx="1.5" fill="#6b4b32"/>
      <circle cx="40" cy="41" r="15" fill="#4E9E7E"/>
      <circle cx="33" cy="37" r="9" fill="#7CC49B"/>
      <circle cx="47" cy="39" r="7" fill="#3d8f6d"/>
    </g>
    <circle cx="62" cy="20" r="7" fill="#E3A857" class="shimmer"/>
  </svg>`,

  warm: `<svg viewBox="0 0 80 80" width="78" height="78">
    <circle cx="40" cy="40" r="30" fill="#1B3326"/>
    <circle cx="59" cy="21" r="9" fill="#E3A857" class="shimmer"/>
    <g class="sway">
      <rect x="24" y="44" width="3.5" height="18" rx="1.5" fill="#6b4b32"/>
      <circle cx="26" cy="40" r="13" fill="#4E9E7E"/>
      <circle cx="21" cy="36" r="7" fill="#7CC49B"/>
    </g>
    <g class="bob">
      <rect x="50" y="42" width="13" height="22" rx="5" fill="#3D8FA6"/>
      <rect x="52" y="46" width="9" height="15" rx="3" fill="#7CC49B" opacity="0.85"/>
      <rect x="53" y="38" width="7" height="5" rx="2" fill="#B7E4C7"/>
    </g>
  </svg>`,

  warning: `<svg viewBox="0 0 80 80" width="78" height="78">
    <circle cx="40" cy="40" r="30" fill="#2b2419"/>
    <circle cx="40" cy="26" r="12" fill="#E3A857" class="shimmer"/>
    <g stroke="#E3A857" stroke-width="2.5" stroke-linecap="round" class="shimmer">
      <line x1="40" y1="6" x2="40" y2="11"/>
      <line x1="22" y1="26" x2="17" y2="26"/>
      <line x1="63" y1="26" x2="58" y2="26"/>
      <line x1="26" y1="12" x2="23" y2="9"/>
      <line x1="54" y1="12" x2="57" y2="9"/>
    </g>
    <g class="sip">
      <rect x="30" y="48" width="16" height="20" rx="4" fill="#3D8FA6"/>
      <rect x="33" y="52" width="10" height="13" rx="2" fill="#7CC49B"/>
      <rect x="34" y="44" width="8" height="5" rx="2" fill="#B7E4C7"/>
    </g>
    <path d="M52 52 q6 -8 6 -13 q0 5 6 13 a6 6 0 1 1 -12 0z" fill="#7CC49B" class="bob"/>
  </svg>`,

  danger: `<svg viewBox="0 0 80 80" width="78" height="78">
    <circle cx="40" cy="40" r="30" fill="#31201c"/>
    <circle cx="40" cy="24" r="13" fill="#C9502F" class="shimmer"/>
    <g stroke="#A31E1E" stroke-width="3" stroke-linecap="round" class="shimmer">
      <line x1="40" y1="3" x2="40" y2="9"/>
      <line x1="19" y1="24" x2="13" y2="24"/>
      <line x1="61" y1="24" x2="67" y2="24"/>
    </g>
    <g class="bob">
      <path d="M20 62 q10 -22 20 -22 q10 0 20 22z" fill="#235138"/>
      <rect x="36" y="58" width="8" height="10" rx="2" fill="#4E9E7E"/>
    </g>
    <text x="40" y="52" text-anchor="middle" font-size="13" fill="#B7E4C7">🏠</text>
  </svg>`,
};

function renderAdvice(guide) {
  const key = guide.level === 'comfortable' ? 'comfortable'
    : guide.level === 'warm' ? 'warm'
    : guide.level === 'warning' ? 'warning' : 'danger';

  $('adviceArt').innerHTML = ART[key];
  $('adviceTitle').textContent = state.lang === 'my' ? guide.headline_my : guide.headline_en;
  $('advice').textContent = state.lang === 'my' ? guide.advice_my : guide.advice_en;
  state.lastAdvice = `${$('adviceTitle').textContent}. ${$('advice').textContent}`;
}

/* ------------------------------------------------------------------ speech */

function speak(text) {
  if (!window.speechSynthesis) {
    toast(say('ဤ browser တွင် အသံဖတ်ခြင်း မရနိုင်ပါ။',
              'This browser cannot read text aloud.'));
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  // Burmese voices are rare on most devices; the browser falls back on its own
  utterance.lang = state.lang === 'my' ? 'my-MM' : 'en-US';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

function chime() {
  // a short two-note tone, built with the audio API so there is no file to load
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.34);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.36);
    });
  } catch (_) { /* autoplay policy blocked it; the notification still shows */ }
}

/* --------------------------------------------------------------- air quality */

// WHO 2021 24-hour guideline is 15 ug/m3; the interim targets step up from there
const WHO_STEPS = [
  { limit: 15, colour: '#4E9E7E', label: 'WHO' },
  { limit: 25, colour: '#8FBF6A', label: 'IT-4' },
  { limit: 37.5, colour: '#E3A857', label: 'IT-3' },
  { limit: 50, colour: '#C9502F', label: 'IT-2' },
  { limit: 75, colour: '#A31E1E', label: 'IT-1' },
];

function pm25Colour(value) {
  if (value == null) return 'var(--muted)';
  return (WHO_STEPS.find((s) => value <= s.limit) || WHO_STEPS[WHO_STEPS.length - 1]).colour;
}

const UV_WORDS = {
  low: ['နိမ့်', 'Low'], moderate: ['အလယ်အလတ်', 'Moderate'],
  high: ['မြင့်', 'High'], very_high: ['အလွန်မြင့်', 'Very high'],
  extreme: ['အလွန်အမင်း', 'Extreme'], unknown: ['မသိရ', 'No reading'],
};

const UV_COLOUR = {
  low: '#4E9E7E', moderate: '#8FBF6A', high: '#E3A857',
  very_high: '#C9502F', extreme: '#A31E1E', unknown: 'var(--muted)',
};

const TILE_ART = {
  uv: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="9" fill="#E3A857"/>
       <g stroke="#E3A857" stroke-width="2.5" stroke-linecap="round">
       <line x1="20" y1="3" x2="20" y2="8"/><line x1="20" y1="32" x2="20" y2="37"/>
       <line x1="3" y1="20" x2="8" y2="20"/><line x1="32" y1="20" x2="37" y2="20"/>
       <line x1="8" y1="8" x2="11" y2="11"/><line x1="29" y1="29" x2="32" y2="32"/>
       <line x1="32" y1="8" x2="29" y2="11"/><line x1="11" y1="29" x2="8" y2="32"/></g></svg>`,
  humidity: `<svg viewBox="0 0 40 40">
       <path d="M20 6 q9 12 9 18 a9 9 0 1 1 -18 0 q0 -6 9 -18z" fill="#3D8FA6"/>
       <ellipse cx="16" cy="26" rx="3" ry="4" fill="#7CC49B" opacity="0.7"/></svg>`,
  wind: `<svg viewBox="0 0 40 40" stroke="#7CC49B" stroke-width="2.6"
       stroke-linecap="round" fill="none">
       <path d="M5 14 h16 a4 4 0 1 0 -4 -4"/>
       <path d="M5 22 h22 a4 4 0 1 1 -4 4"/>
       <path d="M5 30 h12"/></svg>`,
  pm: `<svg viewBox="0 0 40 40"><circle cx="12" cy="14" r="4" fill="#8AA394"/>
       <circle cx="24" cy="10" r="2.5" fill="#8AA394"/>
       <circle cx="28" cy="22" r="5" fill="#8AA394"/>
       <circle cx="15" cy="27" r="3" fill="#8AA394"/>
       <circle cx="25" cy="32" r="2" fill="#8AA394"/></svg>`,
};

function renderEnvTiles() {
  const mine = state.live.townships.find((r) => r.name === state.township);
  if (!mine) return;

  const tile = (art, title, big, sub, colour, fill) => `
    <div class="tile">
      <h3>${title}</h3>
      <div class="big" style="color:${colour}">${big}</div>
      <div class="sub" style="color:${colour}">${sub}</div>
      ${fill != null ? `<div class="gauge"><i style="width:${fill}%;background:${colour}"></i></div>` : ''}
      <span class="art">${art}</span>
    </div>`;

  const uvBand = mine.uv_band || 'unknown';
  const uvWords = UV_WORDS[uvBand] || UV_WORDS.unknown;
  const uvAdvice = ['high', 'very_high', 'extreme'].includes(uvBand)
    ? say('အရိပ်ရှာပါ', 'seek shade')
    : say('အန္တရာယ်နည်း', 'low risk');

  const humid = mine.humidity;
  const humidNote = humid == null ? ''
    : humid >= 80 ? say('ချွေးမခြောက်၍ ပိုပူသလို ခံစားရမည်', 'sweat evaporates slowly, so it feels hotter')
    : humid >= 60 ? say('သာမန်', 'typical')
    : say('ခြောက်သွေ့', 'dry');

  $('envTiles').innerHTML =
    tile(TILE_ART.uv, say('ခရမ်းလွန်ရောင်ခြည် (UV)', 'Ultraviolet (UV)'),
         mine.uv != null ? mine.uv : '—',
         `${say(uvWords[0], uvWords[1])} · ${uvAdvice}`,
         UV_COLOUR[uvBand], mine.uv != null ? Math.min(mine.uv / 12, 1) * 100 : null) +
    tile(TILE_ART.humidity, say('စိုထိုင်းဆ', 'Humidity'),
         humid != null ? `${humid}%` : '—', humidNote, '#5FB3C9',
         humid != null ? humid : null) +
    tile(TILE_ART.wind, say('လေတိုက်နှုန်း', 'Wind'),
         mine.wind != null ? mine.wind : '—', 'km/h', 'var(--shoot)',
         mine.wind != null ? Math.min(mine.wind / 40, 1) * 100 : null) +
    tile(TILE_ART.pm, 'PM2.5',
         mine.pm25 != null ? mine.pm25 : '—',
         mine.pm25 != null
           ? say(`WHO ၏ ${(mine.pm25 / 15).toFixed(1)} ဆ`, `${(mine.pm25 / 15).toFixed(1)}× WHO`)
           : say('တိုင်းတာချက် မရှိ', 'no reading'),
         pm25Colour(mine.pm25),
         mine.pm25 != null ? Math.min(mine.pm25 / 75, 1) * 100 : null);
}

function renderAir() {
  renderEnvTiles();
  renderGreening();

  const rows = state.live.townships;
  const mine = rows.find((r) => r.name === state.township);
  const withPm = rows.filter((r) => r.pm25 != null);

  if (!withPm.length) {
    $('whoBar').innerHTML = '';
    $('whoNote').textContent = say('PM2.5 အချက်အလက် မရနိုင်သေးပါ။',
                                   'No PM2.5 readings available right now.');
    $('airRank').innerHTML = '';
    return;
  }

  const cityPm = withPm.reduce((sum, r) => sum + r.pm25, 0) / withPm.length;
  const worst = withPm.reduce((a, b) => (a.pm25 >= b.pm25 ? a : b));
  const minePm = mine && mine.pm25 != null ? mine.pm25 : null;

  // the WHO scale, with a marker showing where the reader's township sits
  const shown = minePm != null ? minePm : cityPm;
  const position = Math.min(shown / 75, 1) * 100;
  $('whoBar').innerHTML =
    WHO_STEPS.map((s) => `<span class="seg" style="background:${s.colour}">${s.label}</span>`).join('') +
    `<span class="marker" style="left:${position.toFixed(1)}%"></span>`;

  $('whoNote').textContent = say(
    `ကမ္ဘာ့ကျန်းမာရေးအဖွဲ့၏ ၂၄ နာရီ လမ်းညွှန်ချက်မှာ ၁၅ µg/m³ ဖြစ်သည်။ အမှတ်အသားက ${label(mine)} ရှိရာနေရာကို ပြသည်။`,
    `The WHO 24-hour guideline is 15 µg/m³. The marker shows where ${label(mine)} sits.`);

  const top = [...withPm].sort((a, b) => b.pm25 - a.pm25);
  const max = top[0].pm25;
  $('airRank').innerHTML = top.map((r) => `
    <div class="row${r.name === state.township ? ' is-mine' : ''}">
      <button type="button" data-goto="${r.name}">
        <span class="name">${label(r)}</span>
        <span class="bar" style="width:${Math.max((r.pm25 / max) * 100, 3)}%;
              background:${pm25Colour(r.pm25)}"></span>
      </button>
      <span class="val">${r.pm25}</span>
    </div>`).join('');

  $('airRank').querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => {
      selectTownship(button.dataset.goto);
      renderAir();
    });
  });
}

function aqiWords(band) {
  const words = {
    good: [', ကောင်း', 'Good'], moderate: ['အလယ်အလတ်', 'Moderate'],
    sensitive: ['ထိခိုက်လွယ်သူများ သတိပြုရန်', 'Unhealthy for sensitive groups'],
    unhealthy: ['ကျန်းမာရေးထိခိုက်နိုင်', 'Unhealthy'],
    unknown: ['တိုင်းတာချက် မရှိ', 'No reading'],
  }[band] || ['', ''];
  return say(words[0], words[1]);
}

/* ---------------------------------------------------------------- greening */

function drawTreeScene(pct, drop, baseTemp) {
  const scene = $('treeScene');
  if (!scene) return;

  // one tree per 5% of canopy, so the slider has something to move
  const trees = Math.round(pct / 5);
  const cooling = Math.min(drop / 3, 1);        // 0..1 for the visual mood

  let html = '<span class="sun" style="background:' +
    (cooling > 0.5 ? '#E3A857' : '#F0B45E') + '"></span>';
  html += `<span class="heat" style="opacity:${(1 - cooling * 0.75).toFixed(2)}"></span>`;
  html += '<span class="ground"></span>';

  // a low skyline so the trees read as being in a city
  const blocks = [[8, 26, 34], [26, 20, 46], [64, 22, 30], [82, 24, 40]];
  blocks.forEach(([left, width, height]) => {
    html += `<span class="building" style="left:${left}%;width:${width}px;height:${height}px"></span>`;
  });

  for (let i = 0; i < trees; i += 1) {
    const size = 20 + (i % 3) * 5;
    const left = 6 + (i * 88) / Math.max(trees, 1) + (i % 2 ? 2 : -2);
    html += `<span class="tree" style="left:${left.toFixed(1)}%;width:${size}px;
             animation-delay:${(i * 0.06).toFixed(2)}s">
               <span class="canopy"></span><span class="trunk"></span>
             </span>`;
  }

  // a couple of birds arrive once the canopy is worth living in
  if (trees >= 5) {
    html += `<span class="bird" style="left:22%;top:22%"></span>`;
    html += `<span class="bird" style="left:64%;top:15%;animation-delay:1.1s"></span>`;
  }

  html += `<span class="drop">${baseTemp}° → ${(baseTemp - drop).toFixed(1)}°</span>`;
  scene.innerHTML = html;
}

function renderGreening() {
  const row = state.live.townships.find((r) => r.name === state.township);
  if (!row) return;
  const pct = Number($('canopy').value);
  $('canopyOut').textContent = `${pct}%`;
  drawTreeScene(pct, pct * 0.06, row.temp);

  // published cooling per percentage point of canopy spans a wide range, so
  // show the band rather than pretending to one number
  const band = [
    [say('အနည်းဆုံး', 'Conservative'), 0.02],
    [say('အလယ်အလတ်', 'Central'), 0.06],
    [say('အများဆုံး', 'Optimistic'), 0.15],
  ];

  $('greenResult').innerHTML = band.map(([name, factor]) => {
    const drop = (pct * factor).toFixed(2);
    return `<div class="cell">
      <h3>${name}</h3>
      <div class="big">−${drop}°</div>
      <div class="sub">${(row.temp - drop).toFixed(1)}° ${say('ဖြစ်လာမည်', 'after')}</div>
    </div>`;
  }).join('') +
  `<p class="verdict-line">${say(
    `${label(row)} ၏ လက်ရှိအပူချိန် ${row.temp}°C မှ စတင်တွက်ချက်ထားသည်။`,
    `Calculated from ${label(row)}'s current ${row.temp}°C.`)}</p>`;
}

/* ----------------------------------------------------------------- history */

async function renderHistory() {
  try {
    const data = await api('/api/history?years=15');
    const done = data.yearly.filter((y) => y.complete);
    if (done.length < 2) return;

    const first = done[0];
    const last = done[done.length - 1];
    const change = (last.mean_temp - first.mean_temp).toFixed(2);
    const sign = change > 0 ? '+' : '';

    $('historyNote').textContent = say(
      `${first.year} မှ ${last.year} အထိ နှစ်စဉ်ပျမ်းမျှ ${sign}${change}°C ပြောင်းလဲခဲ့သည်။ ${last.year} တွင် ၃၈°C ကျော်သည့်ရက် ${last.days_above_38} ရက် ရှိခဲ့သည်။`,
      `Annual mean moved ${sign}${change}°C between ${first.year} and ${last.year}. ${last.year} had ${last.days_above_38} days above 38°C.`);

    const values = done.map((y) => y.mean_temp);
    const W = 320, H = 140, PAD = 16;
    const ticks = niceTicks(Math.min(...values) - 0.2, Math.max(...values) + 0.2, 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const x = (i) => (i / (values.length - 1)) * W;
    const y = (v) => (H - PAD) - ((v - lo) / (hi - lo)) * (H - PAD - 8);
    const path = values.map((v, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

    const grid = ticks.map((t) =>
      `<line class="grid" x1="0" y1="${y(t).toFixed(1)}" x2="${W}" y2="${y(t).toFixed(1)}"/>`).join('');

    const dots = values.map((v, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2" fill="var(--thanaka)"/>`).join('');

    $('historySpark').innerHTML = `
      ${grid}
      <path class="band" d="${path}L${W},${H - PAD}L0,${H - PAD}Z"/>
      <path class="line" d="${path}"/>
      ${dots}
      <circle class="peak" cx="${x(values.length - 1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="4"/>
      <line class="axis" x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}"/>`;

    $('historyY').innerHTML = [...ticks].reverse()
      .map((t) => `<span>${t}°</span>`).join('');

    const every = Math.max(1, Math.round(done.length / 4));
    $('historyAxis').innerHTML = done
      .filter((_, i) => i % every === 0 || i === done.length - 1)
      .map((yr) => `<span>${yr.year}</span>`).join('');
  } catch (_) {
    $('historyNote').textContent = say('မှတ်တမ်း မရနိုင်ပါ။', 'Climate record unavailable.');
  }
}

/* -------------------------------------------------------------------- chat */

const chatHistory = [];

const STARTERS = {
  my: [
    'ဒီနေ့ အပြင်ထွက်လို့ အဆင်ပြေလား။',
    'ငါ့မြို့နယ်က ဘာလို့ ပိုပူတာလဲ။',
    'အပူဒဏ်ကနေ ဘယ်လိုကာကွယ်မလဲ။',
  ],
  en: [
    'Is it safe to go outside today?',
    'Why is my township hotter than others?',
    'How do I protect myself from the heat?',
  ],
};

function greetChat() {
  const log = $('chatLog');
  log.innerHTML = '';

  const row = state.live && state.live.townships.find((r) => r.name === state.township);
  const hello = row
    ? say(`မင်္ဂလာပါ။ ${label(row)} က အခု ${row.temp}°C ရှိပါတယ်။ ဘာသိချင်ပါသလဲ။`,
          `Hello. ${label(row)} is ${row.temp}°C right now. What would you like to know?`)
    : say('မင်္ဂလာပါ။ ဘာသိချင်ပါသလဲ။', 'Hello. What would you like to know?');

  addMessage('bot', hello);

  const chips = document.createElement('div');
  chips.className = 'starters';
  STARTERS[state.lang].forEach((text) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      chips.remove();
      sendChat(text);
    });
    chips.append(chip);
  });
  log.append(chips);
}

function addMessage(role, text, extraClass = '') {
  const node = document.createElement('div');
  node.className = `msg ${role === 'user' ? 'user' : 'bot'} ${extraClass}`.trim();
  node.textContent = text;
  $('chatLog').append(node);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return node;
}

async function sendChat(question) {
  addMessage('user', question);
  chatHistory.push({ role: 'user', content: question });

  const pending = addMessage('bot', say('စဉ်းစားနေသည်…', 'Thinking…'), 'pending');
  const button = $('chatForm').querySelector('button');
  button.disabled = true;

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: chatHistory.slice(-10),
        township: state.township,
        lang: state.lang,
      }),
    });
    pending.className = 'msg bot';
    pending.textContent = data.reply;
    chatHistory.push({ role: 'assistant', content: data.reply });
  } catch (error) {
    pending.className = 'msg bot error';
    pending.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

/* ---------------------------------------------------------- notifications */

const notes = [];

function pushNotice(text) {
  notes.unshift({ text, at: new Date() });
  $('bellDot').hidden = false;

  if (localStorage.getItem(`${STORE}:sound`) === '1') {
    chime();
    setTimeout(() => speak(text), 700);
  }

  // a real background push needs a push service and a paid worker to run it;
  // this fires only while the page is open, which is what it says on the button
  if (window.Notification && Notification.permission === 'granted') {
    try {
      new Notification(say('ရန်ကုန် အပူအခြေအနေ', 'Yangon Heat'), {
        body: text, icon: 'icon-192.png', tag: 'yangon-heat',
      });
    } catch (_) { /* some browsers block this outside a service worker */ }
  }
}

function showNotices() {
  $('bellDot').hidden = true;
  if (!notes.length) {
    toast(say('အသိပေးချက် မရှိသေးပါ။', 'No notifications yet.'));
    return;
  }
  const list = notes.slice(0, 5)
    .map((n) => `${n.at.toTimeString().slice(0, 5)} — ${n.text}`).join('\n');
  alert(list);
}

async function enableNotifications() {
  const note = $('notifyNote');
  if (!window.Notification) {
    note.className = 'formnote bad';
    note.textContent = say('ဤ browser တွင် အသိပေးချက် မရနိုင်ပါ။',
                           'This browser cannot show notifications.');
    return;
  }

  const permission = await Notification.requestPermission();
  note.className = permission === 'granted' ? 'formnote ok' : 'formnote bad';
  note.textContent = permission === 'granted'
    ? say('ဖွင့်ပြီးပါပြီ — app ဖွင့်ထားစဉ်သာ အလုပ်လုပ်ပါမည်။',
          'Enabled — this works while the app is open.')
    : say('ခွင့်ပြုချက် မရပါ။', 'Permission was declined.');
}

// watch the reader's township and speak up when it crosses their threshold
let lastNotifiedLevel = null;

function checkThreshold() {
  const row = state.live && state.live.townships.find((r) => r.name === state.township);
  if (!row) return;

  const limit = Number(localStorage.getItem(`${STORE}:threshold`) || 36);
  const over = row.temp >= limit;

  if (over && lastNotifiedLevel !== 'over') {
    pushNotice(say(`${label(row)} က ${row.temp}°C — ကန့်သတ်ချက် ${limit}°C ကျော်သွားပါပြီ။`,
                   `${label(row)} is ${row.temp}°C, above your ${limit}°C limit.`));
    lastNotifiedLevel = 'over';
  } else if (!over && lastNotifiedLevel === 'over') {
    pushNotice(say(`${label(row)} က ${row.temp}°C — ကန့်သတ်ချက်အောက် ပြန်ရောက်ပါပြီ။`,
                   `${label(row)} is back below your limit at ${row.temp}°C.`));
    lastNotifiedLevel = 'under';
  }
}

/* ------------------------------------------------------------------- forms */

function wireForms() {
  const threshold = $('threshold');
  threshold.value = localStorage.getItem(`${STORE}:threshold`) || 36;
  $('thresholdOut').textContent = `${threshold.value} °C`;
  threshold.addEventListener('input', () => {
    $('thresholdOut').textContent = `${threshold.value} °C`;
    localStorage.setItem(`${STORE}:threshold`, threshold.value);
  });

  const intensity = $('intensity');
  intensity.addEventListener('input', () => {
    $('intensityOut').textContent = `${intensity.value} / 10`;
  });

  $('alertForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = $('alertNote');
    const button = event.target.querySelector('button');
    button.disabled = true;
    note.className = 'formnote';
    note.textContent = say('ပို့နေသည်…', 'Saving…');
    try {
      await api('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({
          email: $('alertEmail').value.trim(),
          township: state.township,
          threshold: Number(threshold.value),
        }),
      });
      note.className = 'formnote ok';
      note.textContent = say(
        `မှတ်တမ်းတင်ပြီးပါပြီ — ${state.township} ${threshold.value}°C ကျော်လျှင် ပို့ပါမည်။`,
        `Saved — you are on the list for ${state.township} above ${threshold.value}°C.`);
      event.target.reset();
      $('thresholdOut').textContent = '36 °C';
    } catch (error) {
      note.className = 'formnote bad';
      note.textContent = say(`မအောင်မြင်ပါ — ${error.message}`, `Could not save — ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });

  $('reportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = $('reportNote');
    const button = event.target.querySelector('button');
    button.disabled = true;
    note.className = 'formnote';
    note.textContent = say('ပို့နေသည်…', 'Sending…');
    try {
      await api('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          name: $('reportName').value.trim(),
          township: state.township,
          intensity: Number(intensity.value),
          notes: $('reportNotes').value.trim(),
        }),
      });
      note.className = 'formnote ok';
      note.textContent = say('ကျေးဇူးတင်ပါသည်။ မှတ်တမ်းတင်ပြီးပါပြီ။',
                             'Thank you — your report is saved.');
      event.target.reset();
      $('intensityOut').textContent = '7 / 10';
    } catch (error) {
      note.className = 'formnote bad';
      note.textContent = say(`မအောင်မြင်ပါ — ${error.message}`, `Could not send — ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------- start */

async function start() {
  applyLanguage();
  wireForms();

  $('langToggle').addEventListener('click', () => {
    state.lang = state.lang === 'my' ? 'en' : 'my';
    localStorage.setItem(`${STORE}:lang`, state.lang);
    applyLanguage();
  });

  $('locateBtn').addEventListener('click', useLocation);

  $('zoomOut').addEventListener('click', () => {
    const layer = mapState.polygons || mapState.pins;
    if (mapState.map && layer && layer.getBounds) {
      mapState.map.fitBounds(layer.getBounds(), { padding: [12, 12] });
    }
  });
  $('townshipPick').addEventListener('change', (e) => selectTownship(e.target.value));
  $('cmpA').addEventListener('change', renderCompare);
  $('cmpB').addEventListener('change', renderCompare);
  $('canopy').addEventListener('input', renderGreening);

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });
  $('burger').addEventListener('click', () =>
    $('sidenav').classList.contains('is-open') ? closeDrawer() : openDrawer());
  $('scrim').addEventListener('click', closeDrawer);

  const openChat = () => {
    $('chatSheet').hidden = false;
    if (!chatHistory.length) greetChat();
    setTimeout(() => $('chatInput').focus(), 120);
  };
  const closeChat = () => { $('chatSheet').hidden = true; };

  $('fab').addEventListener('click', openChat);
  $('chatClose').addEventListener('click', closeChat);
  $('chatScrim').addEventListener('click', closeChat);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeChat(); closeDrawer(); }
  });

  $('speakBtn').addEventListener('click', () => {
    if (state.lastAdvice) speak(state.lastAdvice);
  });

  const sound = $('soundToggle');
  sound.checked = localStorage.getItem(`${STORE}:sound`) === '1';
  sound.addEventListener('change', () => {
    localStorage.setItem(`${STORE}:sound`, sound.checked ? '1' : '0');
    if (sound.checked) {
      chime();
      setTimeout(() => speak(say('သတိပေးချက် အသံ ဖွင့်ပြီးပါပြီ။',
                                 'Alert sound is on.')), 500);
    }
  });

  $('installGo').addEventListener('click', runInstall);
  $('installDismiss').addEventListener('click', () => {
    $('installBar').hidden = true;
    localStorage.setItem(`${STORE}:install-dismissed`, '1');
  });

  // Safari never announces itself, so offer the walkthrough after a short wait
  if (isIOS() && !isStandalone()) {
    setTimeout(() => showInstallBar('ios'), 2500);
  }

  $('bellBtn').addEventListener('click', showNotices);
  $('notifyBtn').addEventListener('click', enableNotifications);

  $('micBtn').addEventListener('click', toggleRecording);
  $('pdfBtn').addEventListener('click', downloadPdf);
  $('printBtn').addEventListener('click', () => window.print());

  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const question = $('chatInput').value.trim();
    if (!question) return;
    $('chatInput').value = '';
    sendChat(question);
  });

  try {
    await loadLive();
  } catch (error) {
    $('verdict').textContent = say('အချက်အလက် မရနိုင်ပါ။', 'Readings unavailable.');
    $('advice').textContent = say(
      'ဆာဗာက အိပ်နေခြင်း ဖြစ်နိုင်ပါသည်။ တစ်မိနစ်ခန့် စောင့်ပြီး ပြန်ကြိုးစားပါ။',
      'The server may still be waking up. Wait a moment and try again.');

    const retry = document.createElement('button');
    retry.className = 'ghost';
    retry.textContent = say('ထပ်ကြိုးစားမည်', 'Try again');
    retry.addEventListener('click', () => location.reload());
    $('hero').append(retry);
    return;
  }

  const fromUrl = new URLSearchParams(location.search).get('township');
  const valid = (name) => state.live.townships.some((t) => t.name === name);
  state.township = (valid(fromUrl) && fromUrl)
    || (valid(state.township) && state.township)
    || state.live.townships[0].name;

  fillTownshipPicker();
  fillCompare();
  renderRibbon();
  renderGreening();
  setupSatellite();
  checkThreshold();

  $('alertStatus').textContent = say(
    'အီးမေးလ် သတိပေးချက်များကို နာရီတိုင်း စစ်ဆေးပြီး ပို့ပါသည်။ ဆာဗာတွင် အီးမေးလ် အချက်အလက် မထည့်ရသေးပါက မှတ်ပုံတင်ထားသော်လည်း စာမပို့နိုင်သေးပါ။',
    'Email alerts are checked hourly. If the server has no mail credentials yet, your subscription is stored but nothing is sent.');

  const wanted = new URLSearchParams(location.search).get('view');
  showView(['today','map','air','compare','alerts','report']
    .includes(wanted) ? wanted : 'today');

  await loadDetail();

  // keep the reading fresh while the page stays open
  setInterval(async () => {
    try {
      await loadLive();
      renderRibbon();
      checkThreshold();
      if (state.view === 'air') renderAir();
      loadDetail();
    } catch (_) { /* offline handling already reported it */ }
  }, 10 * 60 * 1000);
}

// give the reading the full screen while scrolling down; bring the header back
// the moment the reader scrolls up
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const bar = document.querySelector('.topbar-wrap');
  if (!bar) return;
  const y = window.scrollY;
  bar.classList.toggle('hidden', y > 140 && y > lastScroll);
  lastScroll = y;
}, { passive: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

start();
