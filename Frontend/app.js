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
  $('advice').textContent = state.lang === 'my' ? g.advice_my : g.advice_en;

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

function renderSpark(hours) {
  const svg = $('spark');
  if (!hours.length) { svg.innerHTML = ''; return; }

  const W = 320;
  const H = 96;
  const temps = hours.map((h) => h.temp);
  const feels = hours.map((h) => h.feels_like ?? h.temp);
  const lo = Math.min(...temps, ...feels) - 0.6;
  const hi = Math.max(...temps, ...feels) + 0.6;
  const x = (i) => (i / (hours.length - 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 10) - 5;

  const path = (values) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const peakIdx = temps.indexOf(Math.max(...temps));

  svg.innerHTML = `
    <path class="band" d="${path(temps)}L${W},${H}L0,${H}Z"/>
    <path class="feels" d="${path(feels)}"/>
    <path class="line" d="${path(temps)}"/>
    <circle class="peak" cx="${x(peakIdx).toFixed(1)}" cy="${y(temps[peakIdx]).toFixed(1)}" r="3.5"/>
  `;

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

/* ---------------------------------------------------------------- greening */

function renderGreening() {
  const row = state.live.townships.find((r) => r.name === state.township);
  if (!row) return;
  const pct = Number($('canopy').value);
  $('canopyOut').textContent = `${pct}%`;

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
    const W = 320, H = 96;
    const lo = Math.min(...values) - 0.3;
    const hi = Math.max(...values) + 0.3;
    const x = (i) => (i / (values.length - 1)) * W;
    const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 12) - 6;
    const path = values.map((v, i) =>
      `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

    $('historySpark').innerHTML = `
      <path class="band" d="${path}L${W},${H}L0,${H}Z"/>
      <path class="line" d="${path}"/>
      <circle class="peak" cx="${x(values.length - 1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="3.5"/>`;

    $('historyAxis').innerHTML =
      `<span>${first.year}</span><span>${done[Math.floor(done.length / 2)].year}</span><span>${last.year}</span>`;
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

/* ------------------------------------------------------------------- forms */

function wireForms() {
  const threshold = $('threshold');
  threshold.addEventListener('input', () => {
    $('thresholdOut').textContent = `${threshold.value} °C`;
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
        `${state.township} ${threshold.value}°C ကျော်လျှင် အီးမေးလ်ပို့ပါမည်။`,
        `We will email you when ${state.township} passes ${threshold.value}°C.`);
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
  renderHistory();
  setupSatellite();
  greetChat();
  await loadDetail();

  // keep the reading fresh while the page stays open
  setInterval(async () => {
    try {
      await loadLive();
      renderRibbon();
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
