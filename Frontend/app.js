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

// Static labels are swapped by the data-my/data-en walk in applyLanguage(),
// but anything built from a template string with say() baked in at render
// time — the ribbon, the advice card, the forecast bar labels, the compare
// and history panels — has to be redrawn, not just re-labelled. This re-runs
// the same renderers the startup sequence uses, working from the already-
// cached state.live so it costs no extra network calls except the per-
// township detail and forecast, which do need fresh localized text.
function render() {
  const vEl = document.getElementById('verdict'); if (vEl) vEl.style.display = 'none';
  renderRibbon();
  renderGreening();
  fillCompare();
  fillTownshipPicker();
  if (state.view === 'air') renderAir();
  if (state.view === 'compare') renderHistory();
  if (state.view === 'map' && mapState.map) renderMap();
  loadDetail();
}

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


  if (state.live) render();
}

function say(my, en) {
  return state.lang === 'my' ? my : en;
}

/* ------------------------------------------------------------------ colour */

const RAMP = ['#3D7EA6', '#4E9E7E', '#E3A857', '#C9502F', '#A31E1E'];

// Small glyphs for the forecast bars — sun for clear day hours, a moon for
// night, a raincloud when the rain chance crosses 40%. Plain shapes, no
// external images, themed with the same palette as the rest of the page.
function weatherIcon(kind) {
  if (kind === 'rain') {
    return `<svg viewBox="0 0 24 24" width="18" height="18">
      <path d="M6 12a5 5 0 0 1 9.6-1.9A4 4 0 0 1 17 18H7a4 4 0 0 1-1-7.9z"
            fill="#8AA394"/>
      <g stroke="#5FB3C9" stroke-width="1.6" stroke-linecap="round">
        <line x1="8" y1="19" x2="7" y2="22"/>
        <line x1="12" y1="19" x2="11" y2="22"/>
        <line x1="16" y1="19" x2="15" y2="22"/>
      </g>
    </svg>`;
  }
  if (kind === 'moon') {
    return `<svg viewBox="0 0 24 24" width="18" height="18">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="#B7E4C7"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="18" height="18">
    <circle cx="12" cy="12" r="5.5" fill="#E3A857"/>
    <g stroke="#E3A857" stroke-width="1.8" stroke-linecap="round">
      <line x1="12" y1="1.5" x2="12" y2="4.5"/>
      <line x1="12" y1="19.5" x2="12" y2="22.5"/>
      <line x1="1.5" y1="12" x2="4.5" y2="12"/>
      <line x1="19.5" y1="12" x2="22.5" y2="12"/>
      <line x1="4.2" y1="4.2" x2="6.3" y2="6.3"/>
      <line x1="17.7" y1="17.7" x2="19.8" y2="19.8"/>
      <line x1="19.8" y1="4.2" x2="17.7" y2="6.3"/>
      <line x1="6.3" y1="17.7" x2="4.2" y2="19.8"/>
    </g>
  </svg>`;
}

function tempColour(temp, lo, hi) {
  const span = Math.max(hi - lo, 0.1);
  const idx = Math.min(Math.floor(((temp - lo) / span) * RAMP.length), RAMP.length - 1);
  return RAMP[Math.max(idx, 0)];
}

function label(row) {
  // Every township-name display in the app goes through this, so the
  // language toggle affects it everywhere at once.
  return row ? (state.lang === 'my' ? row.name_my : row.name) : '';
}

function selectTownship(name) {
  state.township = name;
  localStorage.setItem(`${STORE}:township`, name);
  const url = new URL(window.location);
  url.searchParams.set('township', name);
  history.replaceState({}, '', url);

  const picker = $('townshipPick');
  if (picker) picker.value = name;

  renderRibbon();
  renderGreening();
  if (state.view === 'air') renderAir();
  loadDetail();
}

/* ------------------------------------------------------------------- geo */

// Wired to #locateBtn ("Use my location"), which already existed in the
// markup with no function behind it — this was firing a ReferenceError on
// every page load, before the button was even clicked, because addEventListener
// evaluates its handler argument immediately.
async function useLocation() {
  const btn = $('locateBtn');
  const original = btn.innerHTML;

  if (!navigator.geolocation) {
    toast(say('ဤ browser တွင် တည်နေရာ အသုံးပြု၍ မရပါ။',
              'This browser cannot provide your location.'));
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span>${say('ရှာနေသည်…', 'Locating…')}</span>`;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        const nearest = await api(`/api/nearest?lat=${latitude}&lon=${longitude}`);
        selectTownship(nearest.name);
        toast(say(`${label(nearest)} ကို အနီးဆုံး မြို့နယ်အဖြစ် ရွေးပြီးပါပြီ။`,
                  `Set to your nearest township: ${label(nearest)}.`));
      } catch (error) {
        const outside = String(error.message || '').includes('404');
        toast(outside
          ? say('ဤတည်နေရာသည် ရန်ကုန်တိုင်းအတွင်း မရှိပါ။',
                'This location is outside Yangon Region.')
          : say('မြို့နယ် ရှာမတွေ့ပါ။ ထပ်စမ်းကြည့်ပါ။',
                'Could not find a nearby township. Try again.'));
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    },
    (error) => {
      btn.disabled = false;
      btn.innerHTML = original;
      const denied = error.code === error.PERMISSION_DENIED;
      toast(denied
        ? say('တည်နေရာ ခွင့်ပြုချက် မရပါ။ browser ဆက်တင်တွင် ခွင့်ပြုနိုင်ပါသည်။',
              'Location permission denied. You can allow it in your browser settings.')
        : say('တည်နေရာ ရှာ၍ မရပါ။', 'Could not determine your location.'));
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

/* ------------------------------------------------------------------- voice */

// Wired to #micBtn, which — like #locateBtn earlier — had a listener
// pointing at a function that had never actually been written.
let mediaRecorder = null;
let recordedChunks = [];

function isSecureForRecording() {
  return window.isSecureContext
    || ['localhost', '127.0.0.1'].includes(location.hostname);
}

async function toggleRecording() {
  const btn = $('micBtn');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  if (!isSecureForRecording()) {
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
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      btn.classList.remove('recording');

      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      if (blob.size < 500) return;   // stopped almost instantly — nothing to send

      const form = new FormData();
      form.append('audio', blob, 'question.webm');
      form.append('lang', state.lang);   // auto-detect misreads Burmese as Chinese

      try {
        const response = await fetch(`${API}/api/transcribe`, { method: 'POST', body: form });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const { text } = await response.json();
        if (text) {
          // put it in the box first — transcription is imperfect, so the
          // reader gets a chance to correct it before it is sent
          $('chatInput').value = text;
          $('chatInput').focus();
          toast(say('စစ်ဆေးပြီး ↑ ကို နှိပ်ပါ။', 'Check it, then tap ↑ to send.'));
        } else {
          toast(say('စကားသံ မကြားရပါ။', 'Nothing was picked up.'));
        }
      } catch (error) {
        toast(say('အသံမှ စာသို့ ပြောင်း၍ မရပါ။', 'Could not transcribe that.'));
      }
    };

    mediaRecorder.start();
    btn.classList.add('recording');
  } catch (error) {
    toast(say('မိုက်ခရိုဖုန်း ခွင့်ပြုချက် မရပါ။', 'Microphone permission was denied.'));
  }
}

/* -------------------------------------------------------------------- pdf */

function downloadPdf() {
  const note = $('pdfNote');
  note.textContent = say('PDF ပြင်ဆင်နေသည်…', 'Preparing the PDF…');
  window.open(`${API}/api/report.pdf?lang=${state.lang}`, '_blank');
  setTimeout(() => { note.textContent = ''; }, 3000);
}

/* ------------------------------------------------------------ illustration */

// A small chibi character who acts out the advice, built from plain SVG
// shapes rather than an image file — no asset to load, themes with the
// palette, and animates with the CSS keyframes defined for .advice-art.
const ART = {
  comfortable: `<svg viewBox="0 0 90 90" width="78" height="78">
    <circle cx="45" cy="45" r="42" fill="#1B3326"/>
    <g class="sway">
      <rect x="14" y="52" width="3" height="16" rx="1.5" fill="#6b4b32"/>
      <circle cx="15.5" cy="49" r="11" fill="#3d8f6d"/>
      <circle cx="11" cy="45" r="6" fill="#4E9E7E"/>
    </g>
    <circle cx="72" cy="20" r="8" fill="#E3A857" class="shimmer"/>
    <g class="bob">
      <path d="M35 78 h20 l-3 -20 h-14z" fill="#4E9E7E"/>
      <!-- legs give a little kick, arms wave — a static bob alone read as stiff -->
      <rect x="37" y="76" width="4" height="9" rx="2" fill="#F2D2B3" class="leg-l"/>
      <rect x="47" y="76" width="4" height="9" rx="2" fill="#F2D2B3" class="leg-r"/>
      <rect x="31" y="60" width="4" height="12" rx="2" fill="#F2D2B3" class="arm-l"/>
      <rect x="53" y="60" width="4" height="12" rx="2" fill="#F2D2B3" class="arm-r"/>
      <circle cx="45" cy="44" r="13" fill="#F2D2B3"/>
      <path d="M32 42 a13 13 0 0 1 26 0 q-4 -7 -13 -7 t-13 7z" fill="#2E241F"/>
      <circle cx="40" cy="45" r="1.8" fill="#2E241F"/>
      <circle cx="50" cy="45" r="1.8" fill="#2E241F"/>
      <path d="M41 51 q4 4 8 0" stroke="#2E241F" stroke-width="1.6"
            fill="none" stroke-linecap="round"/>
      <circle cx="35" cy="49" r="2.4" fill="#E89A9A" opacity="0.55"/>
      <circle cx="55" cy="49" r="2.4" fill="#E89A9A" opacity="0.55"/>
    </g>
  </svg>`,

  warm: `<svg viewBox="0 0 90 90" width="78" height="78">
    <circle cx="45" cy="45" r="42" fill="#1B3326"/>
    <circle cx="71" cy="20" r="9" fill="#E3A857" class="shimmer"/>
    <g class="sway">
      <rect x="14" y="54" width="3" height="14" rx="1.5" fill="#6b4b32"/>
      <circle cx="15.5" cy="50" r="10" fill="#3d8f6d"/>
    </g>
    <g class="bob">
      <path d="M35 78 h20 l-3 -20 h-14z" fill="#4E9E7E"/>
      <circle cx="45" cy="44" r="13" fill="#F2D2B3"/>
      <path d="M32 42 a13 13 0 0 1 26 0 q-4 -7 -13 -7 t-13 7z" fill="#2E241F"/>
      <circle cx="40" cy="45" r="1.8" fill="#2E241F"/>
      <circle cx="50" cy="45" r="1.8" fill="#2E241F"/>
      <path d="M41 51 q4 3 8 0" stroke="#2E241F" stroke-width="1.6"
            fill="none" stroke-linecap="round"/>
      <circle cx="35" cy="49" r="2.4" fill="#E89A9A" opacity="0.6"/>
      <circle cx="55" cy="49" r="2.4" fill="#E89A9A" opacity="0.6"/>
    </g>
    <g class="sip">
      <rect x="58" y="54" width="11" height="18" rx="4" fill="#3D8FA6"/>
      <rect x="60" y="58" width="7" height="12" rx="2" fill="#7CC49B"/>
      <rect x="61" y="50" width="5" height="5" rx="2" fill="#B7E4C7"/>
    </g>
  </svg>`,

  warning: `<svg viewBox="0 0 90 90" width="78" height="78">
    <circle cx="45" cy="45" r="42" fill="#2b2419"/>
    <circle cx="45" cy="17" r="9" fill="#E3A857" class="shimmer"/>
    <g stroke="#E3A857" stroke-width="2.2" stroke-linecap="round" class="shimmer">
      <line x1="45" y1="2" x2="45" y2="6"/>
      <line x1="30" y1="17" x2="26" y2="17"/>
      <line x1="60" y1="17" x2="64" y2="17"/>
    </g>
    <g class="bob">
      <path d="M35 78 h20 l-3 -20 h-14z" fill="#4E9E7E"/>
      <circle cx="45" cy="46" r="13" fill="#F2D2B3"/>
      <ellipse cx="45" cy="36" rx="19" ry="5" fill="#C9A227"/>
      <path d="M35 36 a10 8 0 0 1 20 0z" fill="#E3A857"/>
      <circle cx="40" cy="47" r="1.8" fill="#2E241F"/>
      <circle cx="50" cy="47" r="1.8" fill="#2E241F"/>
      <path d="M41 53 q4 2 8 0" stroke="#2E241F" stroke-width="1.6"
            fill="none" stroke-linecap="round"/>
      <circle cx="35" cy="51" r="2.4" fill="#E89A9A" opacity="0.7"/>
      <circle cx="55" cy="51" r="2.4" fill="#E89A9A" opacity="0.7"/>
    </g>
    <g class="sip">
      <rect x="60" y="56" width="11" height="18" rx="4" fill="#3D8FA6"/>
      <rect x="62" y="60" width="7" height="12" rx="2" fill="#7CC49B"/>
    </g>
  </svg>`,

  danger: `<svg viewBox="0 0 90 90" width="78" height="78">
    <circle cx="45" cy="45" r="42" fill="#31201c"/>
    <circle cx="45" cy="15" r="10" fill="#C9502F" class="shimmer"/>
    <g stroke="#A31E1E" stroke-width="2.6" stroke-linecap="round" class="shimmer">
      <line x1="45" y1="1" x2="45" y2="5"/>
      <line x1="28" y1="15" x2="23" y2="15"/>
      <line x1="62" y1="15" x2="67" y2="15"/>
    </g>
    <path d="M16 52 L45 34 L74 52 Z" fill="#235138"/>
    <rect x="22" y="52" width="46" height="26" rx="3" fill="#1A2E24"/>
    <g class="bob">
      <path d="M37 78 h16 l-2 -14 h-12z" fill="#4E9E7E"/>
      <circle cx="45" cy="60" r="10" fill="#F2D2B3"/>
      <path d="M35 58 a10 10 0 0 1 20 0 q-3 -5 -10 -5 t-10 5z" fill="#2E241F"/>
      <circle cx="41" cy="61" r="1.5" fill="#2E241F"/>
      <circle cx="49" cy="61" r="1.5" fill="#2E241F"/>
      <path d="M42 66 q3 2 6 0" stroke="#2E241F" stroke-width="1.4"
            fill="none" stroke-linecap="round"/>
    </g>
    <g class="sip">
      <rect x="58" y="62" width="9" height="14" rx="3" fill="#3D8FA6"/>
    </g>
  </svg>`,
};

function rainOverlay() {
  // a few falling drops layered over whichever heat-level character is
  // showing, so "raining right now" reads at a glance alongside the heat
  return `<g class="rain-overlay">
    <line x1="20" y1="8" x2="17" y2="16" stroke="#5FB3C9" stroke-width="2"
          stroke-linecap="round" class="rain-drop" style="animation-delay:0s"/>
    <line x1="32" y1="4" x2="29" y2="12" stroke="#5FB3C9" stroke-width="2"
          stroke-linecap="round" class="rain-drop" style="animation-delay:0.25s"/>
    <line x1="66" y1="10" x2="63" y2="18" stroke="#5FB3C9" stroke-width="2"
          stroke-linecap="round" class="rain-drop" style="animation-delay:0.5s"/>
    <line x1="78" y1="6" x2="75" y2="14" stroke="#5FB3C9" stroke-width="2"
          stroke-linecap="round" class="rain-drop" style="animation-delay:0.15s"/>
  </g>`;
}

function renderAdvice(guide, rainMm) {
  const key = guide.level === 'comfortable' ? 'comfortable'
    : guide.level === 'warm' ? 'warm'
    : guide.level === 'warning' ? 'warning' : 'danger';

  let art = ART[key];
  if (rainMm > 0) {
    art = art.replace('</svg>', `${rainOverlay()}</svg>`);
  }

  $('adviceArt').innerHTML = art;
  $('adviceTitle').textContent = state.lang === 'my' ? guide.headline_my : guide.headline_en;
  $('advice').textContent = state.lang === 'my' ? guide.advice_my : guide.advice_en;
  state.lastAdvice = `${$('adviceTitle').textContent}. ${$('advice').textContent}`;
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

// Referenced by satOverlays() and applyLanguage() but never declared —
// the map crashed as soon as either touched it.
let satLayers = { lst: null, ndvi: null };

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

  if (!state.live) {
    toast(say('အချက်အလက် တင်နေဆဲ — ခဏစောင့်ပါ။', 'Still loading — one moment.'));
    return;
  }

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

/* --------------------------------------------------------------- satellite */

// Wired to #lstToggle/#ndviToggle via setupSatellite() below — called from
// startup, but the function itself had never actually been written, so the
// checkboxes existed with no listener behind them.
async function toggleSatLayer(kind, checked) {
  const note = $('satNote');
  if (!mapState.map) return;   // the map view has not been opened yet

  if (!checked) {
    if (satLayers[kind]) {
      mapState.map.removeLayer(satLayers[kind]);
      satLayers[kind] = null;
    }
    if (note) note.textContent = '';
    return;
  }

  if (note) note.textContent = say('ဂြိုဟ်တုပုံ ဆွဲနေသည်…', 'Loading satellite imagery…');

  try {
    const layer = await api(`/api/satellite/${kind}`);
    const tile = L.tileLayer(layer.tile_url, { opacity: 0.65, maxZoom: 19 });
    satLayers[kind] = tile;
    tile.addTo(mapState.map);

    const shape = layer.clipped_to ? ` · ${layer.clipped_to}` : '';
    if (note) {
      note.textContent = kind === 'lst'
        ? say(`ပုံ ${layer.scenes} ပုံ · နောက်ဆုံး ${layer.latest_pass} · ${layer.min}–${layer.max}°C${shape}`,
              `${layer.scenes} scenes · latest ${layer.latest_pass} · ${layer.min}–${layer.max}°C${shape}`)
        : say(`ပုံ ${layer.scenes} ပုံမှ ပေါင်းစပ်ထား${shape}`,
              `Composite of ${layer.scenes} scenes${shape}`);
    }
  } catch (error) {
    const toggle = $(`${kind}Toggle`);
    if (toggle) toggle.checked = false;
    const msg = String(error.message || '');
    if (note) {
      note.textContent = msg.includes('404')
        ? say('ဤကာလအတွင်း တိမ်ကင်းသော ဂြိုဟ်တုပုံ မရှိပါ။', 'No cloud-free scenes in this window.')
        : say('ဂြိုဟ်တုပုံ ရယူ၍ မရပါ။ Earth Engine ဆက်တင် စစ်ပါ။',
              'Could not load satellite imagery. Check the Earth Engine setup.');
    }
  }
}

async function setupSatellite() {
  const controls = $('satControls');
  if (!controls) return;

  let status;
  try {
    status = await api('/api/satellite/status');
  } catch (_) {
    status = { ready: false };
  }

  controls.hidden = !status.ready;
  if (!status.ready) return;

  $('lstToggle').addEventListener('change', (e) => toggleSatLayer('lst', e.target.checked));
  $('ndviToggle').addEventListener('change', (e) => toggleSatLayer('ndvi', e.target.checked));
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

// The install path is now reached only from the sidebar "Install app" entry,
// on request rather than shown unasked on every visit.
let installBannerMode = 'android';

function showInstallBar(mode) {
  installBannerMode = mode;
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
  if (installBannerMode === 'ios') {
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
  toast(say('ဖုန်းမျက်နှာပြင်တွင် ထည့်ပြီးပါပြီ။', 'Added to your home screen.'));
});

/* ------------------------------------------------------------------- views */

function safely(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`${name} failed:`, error);
    toast(say(`${name} ပြသရာတွင် ပြဿနာရှိသည်။`, `Could not draw ${name}.`));
  }
}

async function showView(name) {
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

  // The initial /api/live call can still be in flight (or can have failed on
  // a cold Render start) when someone taps a tab — retry once here instead
  // of leaving every other tab stuck on "still loading" forever.
  const needsLive = ['map', 'air', 'compare'].includes(name);
  if (needsLive && !state.live) {
    try { await loadLive(); } catch (_) { /* the view's own guard message covers this */ }
  }

  // Leaflet measures its container on creation; a hidden one measures as zero
  if (name === 'map' && mapState.map) {
    setTimeout(() => mapState.map.invalidateSize(), 60);
  }
  if (name === 'map') safely('map', () => renderMap());
  if (name === 'air') safely('environment', () => renderAir());
  if (name === 'compare') safely('insights', () => { fillCompare(); renderHistory(); });
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
    if (data.stale) {
      toast(say('အနည်းငယ် ဟောင်းနေသော အချက်အလက် ပြသနေသည်။',
                'Showing slightly older readings while the feed recovers.'));
    } else if (data.source === 'openweathermap'
               && sessionStorage.getItem(`${STORE}:owm-noted`) !== '1') {
      // Open-Meteo needs no key, so a block on the shared host IP is
      // invisible to this app's own traffic — worth a one-time note rather
      // than silently presenting numbers from a different source as if
      // nothing had changed. UV has no reading on this fallback path.
      sessionStorage.setItem(`${STORE}:owm-noted`, '1');
      toast(say('အဓိက ရာသီဥတု ရင်းမြစ် မရနိုင်သဖြင့် အရန်ရင်းမြစ်ကို သုံးနေသည် — UV အချက်အလက် ယာယီ မရနိုင်ပါ။',
                'Primary weather source unavailable — using a backup, so UV data is temporarily missing.'));
    }
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

// Plain-language captions so a bare "+0.4°" or "32°" does not need
// interpreting - the chip says in words what the number means.
function feelsCaption(temp, feelsLike) {
  // Every phrase here is copied verbatim from text already verified
  // elsewhere in this file, to avoid hand-typing new Burmese that could
  // come out wrong the way an earlier attempt at this did.
  if (feelsLike == null) return { value: '—', note: '' };
  const diff = feelsLike - temp;
  const value = `${feelsLike.toFixed(1)}°`;
  if (diff >= 2) return { value, note: say('ပိုပူသလို ခံစားရမည်', 'feels hotter than the air temperature') };
  if (diff <= -2) return { value, note: say('', 'feels cooler than the air temperature') };
  return { value, note: '' };
}

function anomalyCaption(anomaly) {
  // Arrows carry the "hotter/cooler than the city" meaning without needing
  // any new Burmese words at all — the dt label above already says
  // "vs city average", so the arrow just makes the direction unmistakable.
  const value = anomaly > 0 ? `+${anomaly}°` : `${anomaly}°`;
  const arrow = anomaly >= 0.3 ? '▲' : anomaly <= -0.3 ? '▼' : '';
  return { value: arrow ? `${arrow} ${value}` : value, note: '' };
}

function renderHero(detail) {
  const t = detail.township;
  const g = detail.guidance;

  $('temp').textContent = t.temp.toFixed(1);
  $('verdict').textContent = state.lang === 'my' ? g.headline_my : g.headline_en;
  renderAdvice(g, t.rain);

  const colour = LEVEL_COLOUR[g.level] || 'var(--muted)';
  $('hero').style.borderLeftColor = colour;
  $('verdict').style.color = colour;

  const feelsC = feelsCaption(t.temp, t.feels_like);
  $('feels').textContent = feelsC.value;
  $('feelsNote').textContent = feelsC.note;
  $('aqi').textContent = t.aqi ? t.aqi : '—';
  const anomC = anomalyCaption(t.anomaly);
  $('anomaly').textContent = anomC.value;
  $('anomalyNote').textContent = anomC.note;

  const stamp = detail.observed_at
    ? detail.observed_at.replace('T', ' ')
    : say('အချိန်မသိ', 'time unknown');
  $('stamp').textContent = say(
    `${stamp} · ${detail.city.rank}/${detail.city.total} အပူဆုံး`,
    `${stamp} · ${detail.city.rank} of ${detail.city.total} hottest`
  );
}

function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((m) => magnitude * m >= raw) * magnitude;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(2)));
  return ticks;
}

/* ------------------------------------------------------- 48-hour forecast */

function renderSpark(hours) {
  // A line chart with axis numbers reads well to someone used to graphs, but
  // "what will it feel like around lunchtime" is the actual question, so this
  // shows a handful of named time slots instead: today's readers scan it in
  // one pass rather than decoding a plot. Small icons above each bar say
  // "rain" or "day/night" at a glance, before the numbers are even read.
  const box = $('forecastBars');
  if (!hours.length) { box.innerHTML = ''; return; }

  const SLOTS = [
    { label_my: 'ယခု', label_en: 'Now', hour: null },
    { label_my: 'နံနက်', label_en: 'Morning', hour: 9 },
    { label_my: 'နေ့လယ်', label_en: 'Midday', hour: 13 },
    { label_my: 'ညနေ', label_en: 'Evening', hour: 18 },
    { label_my: 'သန်းခေါင်', label_en: 'Night', hour: 0, dayOffset: 1 },
    { label_my: 'မနက်ဖြန်', label_en: 'Tomorrow', hour: 9, dayOffset: 1 },
  ];

  const byTime = hours.map((h) => ({ ...h, dt: new Date(h.time) }));
  const startDay = byTime[0].dt.getDate();

  const picked = SLOTS.map((slot, i) => {
    if (i === 0) return byTime[0];
    const target = byTime.find((h) => {
      const dayMatches = slot.dayOffset
        ? h.dt.getDate() !== startDay
        : h.dt.getDate() === startDay;
      return dayMatches && h.dt.getHours() === slot.hour;
    });
    return target || null;
  }).map((point, i) => point && { ...point, ...SLOTS[i] });

  const valid = picked.filter(Boolean);
  if (!valid.length) { box.innerHTML = ''; return; }

  const temps = valid.map((p) => p.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = Math.max(hi - lo, 1);
  const peakTemp = Math.max(...temps);

  box.innerHTML = valid.map((p) => {
    const heightPct = 30 + ((p.temp - lo) / span) * 70;
    const colour = tempColour(p.temp, lo - 1, hi + 1);
    const isPeak = p.temp === peakTemp;
    const rainNote = p.rain_chance >= 50
      ? `<span class="bar-rain">☔ ${p.rain_chance}%</span>` : '';
    const hour = p.dt.getHours();
    const icon = p.rain_chance >= 40 ? weatherIcon('rain')
      : (hour >= 6 && hour < 18) ? weatherIcon('sun') : weatherIcon('moon');
    return `
      <div class="bar-slot${isPeak ? ' is-peak' : ''}">
        <span class="bar-icon">${icon}</span>
        <span class="bar-temp">${p.temp}°</span>
        ${rainNote}
        <span class="bar-col" style="height:${heightPct}%;background:${colour}"></span>
        <span class="bar-label">${say(p.label_my, p.label_en)}</span>
      </div>`;
  }).join('');

  const peak = valid.find((p) => p.temp === peakTemp);
  $('peakNote').textContent = say(
    `${say(peak.label_my, peak.label_en)} အချိန်ဝန်းကျင် အပူဆုံး ${peak.temp}°C ရှိနိုင်သည်။`,
    `Likely hottest around ${say(peak.label_my, peak.label_en).toLowerCase()}, near ${peak.temp}°C.`);
}

/* ------------------------------------------------------ township + forecast */

async function loadDetail() {
  try {
    const detail = await api(`/api/township/${encodeURIComponent(state.township)}`);
    renderHero(detail);
  } catch (error) {
    // the live payload already has everything the hero card needs, so a
    // failed detail call still leaves the reader with a correct reading
    const row = state.live && state.live.townships.find((r) => r.name === state.township);
    if (row) {
      $('temp').textContent = row.temp.toFixed(1);
      const feelsC2 = feelsCaption(row.temp, row.feels_like);
      $('feels').textContent = feelsC2.value;
      $('feelsNote').textContent = feelsC2.note;
      $('aqi').textContent = row.aqi ? row.aqi : '—';
      const anomC2 = anomalyCaption(row.anomaly);
      $('anomaly').textContent = anomC2.value;
      $('anomalyNote').textContent = anomC2.note;
      const g = sourcesGuidanceFallback(row);
      $('verdict').textContent = state.lang === 'my' ? g.headline_my : g.headline_en;
      renderAdvice(g, row.rain);
    }
  }

  try {
    const forecast = await api(`/api/forecast?township=${encodeURIComponent(state.township)}`);
    const hours = (forecast.hours || []).slice(0, 48);
    if (!hours.length) throw new Error('no hourly points returned');
    renderSpark(hours);
  } catch (error) {
    console.error('forecast failed:', error);
    $('forecastBars').innerHTML = '';
    $('peakNote').textContent = say(
      `ခန့်မှန်းချက် မရနိုင်ပါ — ${error.message}`,
      `Forecast unavailable — ${error.message}`);
  }
}

function sourcesGuidanceFallback(row) {
  // Mirrors the server's guidance() thresholds so the hero card still says
  // something sensible on the rare request where /api/township itself fails
  // but the live payload came through fine.
  const peak = Math.max(row.temp, row.feels_like || row.temp);
  if (peak >= 40) return {
    level: 'danger',
    headline_my: 'အလွန်အန္တရာယ်များသည်', headline_en: 'Dangerous heat',
    advice_my: 'အပြင်ထွက်ခြင်း ရှောင်ပါ။ ရေများများသောက်ပါ။',
    advice_en: 'Stay inside if you can. Drink water often.',
  };
  if (peak >= 36) return {
    level: 'warning',
    headline_my: 'အပူပြင်းသည်', headline_en: 'Hot',
    advice_my: 'နေ့လယ်ပိုင်း အပြင်လုပ်ငန်း ရှောင်ပါ။ ရေမှန်မှန်သောက်ပါ။',
    advice_en: 'Avoid outdoor work in the middle of the day.',
  };
  if (peak >= 32) return {
    level: 'warm',
    headline_my: 'နွေးသည်', headline_en: 'Warm',
    advice_my: 'အရိပ်ရှာပါ။ ရေဘူးတစ်လုံး ယူသွားပါ။',
    advice_en: 'Find shade when you are out.',
  };
  return {
    level: 'comfortable',
    headline_my: 'သက်တောင့်သက်သာရှိသည်', headline_en: 'Comfortable',
    advice_my: 'အပူဒဏ် စိုးရိမ်စရာ မရှိပါ။', advice_en: 'No heat risk right now.',
  };
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
  if (!state.live) {
    $('envTiles').innerHTML = `<p class="note">${
      say('အချက်အလက် တင်နေဆဲ — ခဏစောင့်ပါ။', 'Still loading — one moment.')}</p>`;
    return;
  }
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

function treeSVG() {
  // A single flat circle reads as an abstract dot, not a tree — three
  // overlapping leaf clusters at different shades gives the fuller, uneven
  // silhouette that actually looks like foliage.
  return `<svg viewBox="0 0 40 50" width="100%" height="100%">
    <path d="M17 50 L15 30 h4 L17 50z" fill="#6b4b32"/>
    <path d="M15 32 q-3 -3 -1 -6" stroke="#553a26" stroke-width="1"
          fill="none" stroke-linecap="round"/>
    <circle cx="13" cy="20" r="10" fill="#3d8f6d"/>
    <circle cx="26" cy="19" r="9" fill="#4E9E7E"/>
    <circle cx="19" cy="10" r="11" fill="#6fc0a3"/>
    <circle cx="16" cy="7" r="4" fill="#8fd4b3" opacity="0.7"/>
  </svg>`;
}

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
  const blocks = [[8, 26, 34], [26, 20, 46], [64, 22, 30], [82, 22, 30], [82, 24, 40]];
  blocks.forEach(([left, width, height]) => {
    html += `<span class="building" style="left:${left}%;width:${width}px;height:${height}px"></span>`;
  });

  // trees start after the gardener's own planting spot, so the character
  // never sits on top of the forest it is growing
  for (let i = 0; i < trees; i += 1) {
    const size = 24 + (i % 3) * 6;
    const left = 26 + (i * 68) / Math.max(trees, 1) + (i % 2 ? 2 : -2);
    html += `<span class="tree" style="left:${left.toFixed(1)}%;width:${size}px;
             animation-delay:${(i * 0.06).toFixed(2)}s">${treeSVG()}</span>`;
  }

  // the chibi gardener, always at work planting the next one — sun hat,
  // collared shirt and a kneeling leg so the pose reads clearly as
  // "a person planting", not just an abstract figure
  html += `
    <span class="soil"></span>
    <span class="seedling">
      <span class="leaf-l"></span><span class="leaf-r"></span><span class="stem"></span>
    </span>
    <span class="gardener">
      <svg viewBox="0 0 60 70" width="100%" height="100%">
        <!-- back knee, kneeling pose -->
        <path d="M14 66 q0 -8 6 -9 l3 9z" fill="#3d8f6d"/>
        <!-- torso: short-sleeve shirt with a collar -->
        <path d="M18 60 q-2 -18 6 -22 q6 -3 12 0 q8 4 6 22z" fill="#4E9E7E"/>
        <path d="M27 39 l3 4 l3 -4" stroke="#3d8f6d" stroke-width="1.4" fill="none"/>
        <path d="M20 42 q10 6 20 0" stroke="#3d8f6d" stroke-width="1.4" fill="none"/>
        <!-- working arm + trowel, swings down to the soil -->
        <g class="g-arm">
          <path d="M36 34 q10 2 13 10" stroke="#F2D2B3" stroke-width="6"
                stroke-linecap="round" fill="none"/>
          <rect x="46" y="40" width="5" height="14" rx="2" fill="#8AA394"
                transform="rotate(35 48 47)"/>
        </g>
        <!-- steady hand -->
        <circle cx="20" cy="42" r="4" fill="#F2D2B3"/>
        <!-- big round head -->
        <circle cx="30" cy="20" r="16" fill="#F2D2B3"/>
        <path d="M14 19 a16 16 0 0 1 32 0 q-5 -9 -16 -9 t-16 9z" fill="#2E241F"/>
        <path d="M25 22 q2 2 4 0" stroke="#2E241F" stroke-width="1.8"
              fill="none" stroke-linecap="round"/>
        <path d="M33 22 q2 2 4 0" stroke="#2E241F" stroke-width="1.8"
              fill="none" stroke-linecap="round"/>
        <path d="M26 27 q4 3 8 0" stroke="#2E241F" stroke-width="1.6"
              fill="none" stroke-linecap="round"/>
        <circle cx="21" cy="25" r="3" fill="#E89A9A" opacity="0.65"/>
        <circle cx="39" cy="25" r="3" fill="#E89A9A" opacity="0.65"/>
        <!-- wide sun hat, so the figure reads as "gardener" at a glance -->
        <ellipse cx="30" cy="8" rx="20" ry="5" fill="#E3A857"/>
        <path d="M18 8 a12 9 0 0 1 24 0z" fill="#F2C879"/>
      </svg>
    </span>`;

  // birds arrive once there is a canopy worth living in
  if (trees >= 2) {
    html += `<span class="bird" style="left:46%;top:20%"></span>`;
  }
  if (trees >= 4) {
    html += `<span class="bird" style="left:68%;top:13%;animation-delay:1.1s"></span>`;
  }
  if (trees >= 7) {
    html += `<span class="bird" style="left:84%;top:26%;animation-delay:2.2s"></span>`;
  }

  html += `<span class="drop">${baseTemp}° → ${(baseTemp - drop).toFixed(1)}°</span>`;
  scene.innerHTML = html;
}

/* -------------------------------------------------------------- comparison */

function fillCompare() {
  if (!state.live) {
    $('cmpResult').innerHTML = `<p class="note">${
      say('အချက်အလက် တင်နေဆဲ — ခဏစောင့်ပါ။', 'Still loading — one moment.')}</p>`;
    return;
  }
  const rows = [...state.live.townships].sort((a, b) => a.name.localeCompare(b.name));
  const options = rows.map((r) => `<option value="${r.name}">${label(r)}</option>`).join('');

  const a = $('cmpA');
  const b = $('cmpB');
  const prevA = a.value;
  const prevB = b.value;
  const names = rows.map((r) => r.name);

  a.innerHTML = options;
  b.innerHTML = options;
  a.value = names.includes(prevA) ? prevA : state.township;
  b.value = names.includes(prevB) && prevB !== a.value
    ? prevB
    : (names.find((n) => n !== a.value) || names[0]);

  renderCompare();
}

function renderCompare() {
  const rowA = state.live.townships.find((r) => r.name === $('cmpA').value);
  const rowB = state.live.townships.find((r) => r.name === $('cmpB').value);
  if (!rowA || !rowB) return;

  const lo = Math.min(rowA.temp, rowB.temp) - 1;
  const hi = Math.max(rowA.temp, rowB.temp) + 1;

  const cell = (row) => `
    <div class="cell" style="border-left-color:${tempColour(row.temp, lo, hi)}">
      <h3>${label(row)}</h3>
      <div class="big" style="color:${tempColour(row.temp, lo, hi)}">${row.temp}°</div>
      <div class="sub">${say('ခံစားရသော', 'Feels')} ${row.feels_like ?? row.temp}° ·
        AQI ${row.aqi || '—'}</div>
    </div>`;

  const diff = Math.abs(rowA.temp - rowB.temp).toFixed(1);
  const hotter = rowA.temp >= rowB.temp ? rowA : rowB;
  const line = rowA.name === rowB.name
    ? say('မတူညီသော မြို့နယ် နှစ်ခု ရွေးပါ။', 'Pick two different townships.')
    : say(`${label(hotter)} က ${diff}°C ပိုပူသည်။ လေထုအရည်အသွေး ကွာခြားချက် ${Math.abs((rowA.aqi||0) - (rowB.aqi||0))} ။`,
          `${label(hotter)} is ${diff}°C hotter. Air quality differs by ${Math.abs((rowA.aqi||0) - (rowB.aqi||0))} points.`);

  $('cmpResult').innerHTML = cell(rowA) + cell(rowB) +
    `<p class="verdict-line">${line}</p>`;
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

  $('navInstall').addEventListener('click', () => {
    closeDrawer();
    if (isStandalone()) {
      toast(say('ဤစက်တွင် တင်ပြီးသားပါ။', 'Already installed on this device.'));
      return;
    }
    if (isIOS()) { iosInstructions(); return; }
    if (deferredInstall) { runInstall(); return; }
    toast(say('Browser menu ထဲမှ “Add to Home screen” ကို ရွေးပါ။',
              'Open the browser menu and choose "Add to Home screen".'));
  });

  if (isStandalone()) $('navInstall').hidden = true;

  if (isIOS() && !isStandalone()) installBannerMode = 'ios';

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

  safely('township list', () => fillTownshipPicker());
  safely('comparison', () => fillCompare());
  safely('city ribbon', () => renderRibbon());
  safely('tree scene', () => renderGreening());
  safely('satellite', () => setupSatellite());
  safely('alerts', () => checkThreshold());

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
