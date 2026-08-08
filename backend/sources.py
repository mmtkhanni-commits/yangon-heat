"""External data sources for the Yangon heat API.

Every function here talks to a public service and returns plain Python data.
Nothing in this module knows about HTTP routes or the database, so it can be
imported by the API, by the alert job, or from a notebook.
"""

from __future__ import annotations

import difflib
import json
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

import db

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/MMR/ADM3/"
GEOBOUNDARIES_FALLBACK = (
    "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/"
    "releaseData/gbOpen/MMR/ADM3/geoBoundaries-MMR-ADM3_simplified.geojson"
)

YANGON_CENTRE = (16.8409, 96.1735)
YANGON_BBOX = {"lat_min": 16.10, "lat_max": 17.60, "lon_min": 95.55, "lon_max": 96.85}

# Approximate township centres, used until the boundary file is downloaded and
# again for any township the boundary file does not contain.
BASE_TOWNSHIPS = [
    {"name": "Insein", "name_my": "အင်းစိန်", "coords": [16.8900, 96.1000]},
    {"name": "Mingaladon", "name_my": "မင်္ဂလာဒုံ", "coords": [16.9200, 96.1350]},
    {"name": "Hlegu", "name_my": "လှည်းကူး", "coords": [17.1167, 96.2000]},
    {"name": "Hmawbi", "name_my": "မှော်ဘီ", "coords": [17.1167, 96.0667]},
    {"name": "Taikkyi", "name_my": "တိုက်ကြီး", "coords": [17.3333, 95.9833]},
    {"name": "Htantabin", "name_my": "ထန်းတပင်", "coords": [16.9833, 95.9833]},
    {"name": "Shwepyitha", "name_my": "ရွှေပြည်သာ", "coords": [16.9333, 96.0833]},
    {"name": "Hlaingtharyar", "name_my": "လှိုင်သာယာ", "coords": [16.8667, 96.0500]},
    {"name": "Kamayut", "name_my": "ကမာရွတ်", "coords": [16.8283, 96.1350]},
    {"name": "Hlaing", "name_my": "လှိုင်", "coords": [16.8450, 96.1300]},
    {"name": "Mayangon", "name_my": "မရမ်းကုန်း", "coords": [16.8600, 96.1400]},
    {"name": "Bahan", "name_my": "ဗဟန်း", "coords": [16.8000, 96.1550]},
    {"name": "Dagon", "name_my": "ဒဂုံ", "coords": [16.7950, 96.1500]},
    {"name": "Pabedan", "name_my": "ပန်းဘဲတန်း", "coords": [16.7758, 96.1500]},
    {"name": "Latha", "name_my": "လသာ", "coords": [16.7750, 96.1450]},
    {"name": "Lanmadaw", "name_my": "လမ်းမတော်", "coords": [16.7767, 96.1383]},
    {"name": "Ahlone", "name_my": "အလုံ", "coords": [16.7867, 96.1283]},
    {"name": "Kyeemyindaing", "name_my": "ကြည့်မြင်တိုင်", "coords": [16.7950, 96.1200]},
    {"name": "Sanchaung", "name_my": "စမ်းချောင်း", "coords": [16.8100, 96.1350]},
    {"name": "South Dagon", "name_my": "ဒဂုံမြို့သစ် (တောင်)", "coords": [16.8300, 96.2200]},
    {"name": "North Dagon", "name_my": "ဒဂုံမြို့သစ် (မြောက်)", "coords": [16.8700, 96.2100]},
    {"name": "East Dagon", "name_my": "ဒဂုံမြို့သစ် (အရှေ့)", "coords": [16.8800, 96.2500]},
    {"name": "Dagon Seikkan", "name_my": "ဒဂုံဆိပ်ကမ်း", "coords": [16.8050, 96.2450]},
    {"name": "Thingangyun", "name_my": "သင်္ဃန်းကျွန်း", "coords": [16.8200, 96.1900]},
    {"name": "South Okkalapa", "name_my": "တောင်ဥက္ကလာပ", "coords": [16.8450, 96.1900]},
    {"name": "North Okkalapa", "name_my": "မြောက်ဥက္ကလာပ", "coords": [16.8800, 96.1750]},
    {"name": "Tamwe", "name_my": "တာမွေ", "coords": [16.8000, 96.1750]},
    {"name": "Mingala Taungnyunt", "name_my": "မင်္ဂလာတောင်ညွန့်", "coords": [16.7900, 96.1650]},
    {"name": "Pazundaung", "name_my": "ပုဇွန်တောင်", "coords": [16.7817, 96.1717]},
    {"name": "Botahtaung", "name_my": "ဗိုလ်တထောင်", "coords": [16.7767, 96.1717]},
    {"name": "Thanlyin", "name_my": "သန်လျင်", "coords": [16.7500, 96.2500]},
    {"name": "Kyauktan", "name_my": "ကျောက်တန်း", "coords": [16.6333, 96.2833]},
    {"name": "Twante", "name_my": "တွံတေး", "coords": [16.7000, 95.9333]},
    {"name": "Kyauktada", "name_my": "ကျောက်တံတား", "coords": [16.7767, 96.1567]},
    {"name": "Seikkan", "name_my": "ဆိပ်ကမ်း", "coords": [16.7700, 96.1700]},
    {"name": "Dawbon", "name_my": "ဒေါပုံ", "coords": [16.7867, 96.1917]},
    {"name": "Thaketa", "name_my": "သာကေတ", "coords": [16.7950, 96.2100]},
    {"name": "Yankin", "name_my": "ရန်ကင်း", "coords": [16.8250, 96.1650]},
    {"name": "Dala", "name_my": "ဒလ", "coords": [16.7600, 96.1600]},
    {"name": "Seikkyi Kanaungto", "name_my": "ဆိပ်ကြီးခနောင်တို", "coords": [16.7500, 96.1200]},
    {"name": "Kayan", "name_my": "ခရမ်း", "coords": [16.8917, 96.5583]},
    {"name": "Thongwa", "name_my": "သုံးခွ", "coords": [16.7500, 96.5167]},
    {"name": "Kawhmu", "name_my": "ကော့မှူး", "coords": [16.5667, 95.9500]},
    {"name": "Kungyangon", "name_my": "ကွမ်းခြံကုန်း", "coords": [16.4333, 96.0167]},
]

NAME_ALIASES = {
    "hlaingtharyar": ["hlaingtharya", "hlaingthaya"],
    "southdagon": ["dagonmyothitsouth", "southdagonmyothit"],
    "northdagon": ["dagonmyothitnorth", "northdagonmyothit"],
    "eastdagon": ["dagonmyothiteast", "eastdagonmyothit"],
    "dagonseikkan": ["dagonmyothitseikkan"],
    "mingalataungnyunt": ["mingalartaungnyunt"],
    "kyeemyindaing": ["kyimyindaing"],
    "seikkyikanaungto": ["seikkyikhanaungto", "seikgyikanaungto"],
    "shwepyitha": ["shwepyithar"],
    "htantabin": ["hteintabin"],
    "thanlyin": ["syriam"],
}


# ---------------------------------------------------------------- utilities

def _cache_path(name):
    return CACHE_DIR / name


def _read_cache(name, max_age_seconds):
    path = _cache_path(name)
    if not path.exists():
        return None
    if max_age_seconds and (time.time() - path.stat().st_mtime) > max_age_seconds:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_cache(name, payload):
    try:
        _cache_path(name).write_text(json.dumps(payload), encoding="utf-8")
    except Exception:
        pass


def _normalise(name):
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


def _ring_centroid(ring):
    area = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    area *= 0.5
    return cx / (6 * area), cy / (6 * area)


def _geometry_centroid(geom):
    polys = []
    if geom.get("type") == "Polygon":
        polys = [geom["coordinates"]]
    elif geom.get("type") == "MultiPolygon":
        polys = geom["coordinates"]
    best_ring, best_span = None, -1.0
    for poly in polys:
        if not poly:
            continue
        ring = poly[0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        span = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if span > best_span:
            best_span, best_ring = span, ring
    if not best_ring:
        return None
    lon, lat = _ring_centroid(best_ring)
    return [round(lat, 5), round(lon, 5)]


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- boundaries

def load_boundaries():
    """Yangon Region township polygons from geoBoundaries, cached on disk."""
    cached = _read_cache("boundaries.json", max_age_seconds=None)
    if cached:
        return cached

    geojson_url = None
    try:
        with httpx.Client(timeout=30) as client:
            meta = client.get(GEOBOUNDARIES_API).json()
        if isinstance(meta, list):
            meta = meta[0]
        geojson_url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
    except Exception:
        pass

    data = None
    for url in [u for u in (geojson_url, GEOBOUNDARIES_FALLBACK) if u]:
        try:
            with httpx.Client(timeout=120, follow_redirects=True) as client:
                data = client.get(url).json()
            break
        except Exception:
            continue

    if not data or "features" not in data:
        return None

    kept = []
    for feat in data["features"]:
        centre = _geometry_centroid(feat.get("geometry") or {})
        if not centre:
            continue
        lat, lon = centre
        if (YANGON_BBOX["lat_min"] <= lat <= YANGON_BBOX["lat_max"]
                and YANGON_BBOX["lon_min"] <= lon <= YANGON_BBOX["lon_max"]):
            feat["properties"]["centroid"] = centre
            kept.append(feat)

    subset = {"type": "FeatureCollection", "features": kept}
    _write_cache("boundaries.json", subset)
    return subset


def get_townships():
    """BASE_TOWNSHIPS enriched with real centroids and polygons where matched."""
    cached = _read_cache("townships.json", max_age_seconds=604800)
    if cached:
        return cached["townships"], cached["meta"]

    fallback = [dict(t, geometry=None, source="approximate") for t in BASE_TOWNSHIPS]
    boundaries = load_boundaries()
    if not boundaries or not boundaries.get("features"):
        return fallback, {"matched": 0, "total": len(BASE_TOWNSHIPS), "source": None}

    index = {}
    for feat in boundaries["features"]:
        raw = feat["properties"].get("shapeName") or ""
        index[_normalise(raw)] = feat

    out, matched = [], 0
    for base in BASE_TOWNSHIPS:
        key = _normalise(base["name"])
        feat = index.get(key)
        if feat is None:
            for alias in NAME_ALIASES.get(key, []):
                feat = index.get(_normalise(alias))
                if feat is not None:
                    break
        if feat is None:
            close = difflib.get_close_matches(key, list(index.keys()), n=1, cutoff=0.78)
            if close:
                feat = index[close[0]]

        if feat is not None:
            matched += 1
            out.append({
                "name": base["name"],
                "name_my": base["name_my"],
                "coords": feat["properties"].get("centroid") or base["coords"],
                "geometry": feat.get("geometry"),
                "official_name": feat["properties"].get("shapeName"),
                "source": "geoBoundaries",
            })
        else:
            out.append(dict(base, geometry=None, source="approximate"))

    meta = {"matched": matched, "total": len(BASE_TOWNSHIPS),
            "source": "geoBoundaries MMR ADM3 (CC-BY 4.0)"}
    _write_cache("townships.json", {"townships": out, "meta": meta})
    return out, meta


# ---------------------------------------------------------------- live data

def _as_list(payload):
    return payload if isinstance(payload, list) else [payload]


def classify(anomaly):
    if anomaly >= 1.5:
        return "very_high", 5
    if anomaly >= 0.8:
        return "high", 4
    if anomaly >= 0.3:
        return "moderate", 3
    if anomaly >= -0.3:
        return "moderate", 2
    return "low", 1


def uv_band(value):
    """WHO UV index categories. Above 8, unprotected skin burns quickly."""
    if value is None:
        return "unknown"
    if value < 3:
        return "low"
    if value < 6:
        return "moderate"
    if value < 8:
        return "high"
    if value < 11:
        return "very_high"
    return "extreme"


def pm25_band(value):
    """WHO 2021 24-hour guideline is 15 ug/m3; the interim targets step up
    from there, so those are the boundaries worth showing."""
    if value is None:
        return "unknown"
    if value <= 15:
        return "within_who_guideline"
    if value <= 25:
        return "interim_target_4"
    if value <= 37.5:
        return "interim_target_3"
    if value <= 50:
        return "interim_target_2"
    return "above_all_targets"


def aqi_band(value):
    if not value or value <= 0:
        return "unknown"
    if value < 51:
        return "good"
    if value < 101:
        return "moderate"
    if value < 151:
        return "sensitive"
    return "unhealthy"


_live_lock = threading.Lock()
FETCH_INTERVAL = timedelta(hours=1)


def _get_with_retry(client, url, params, attempts=3):
    """Open-Meteo occasionally answers 429 when several requests land close
    together - a cold Render instance plus several visitors arriving at once
    is enough to trigger it. Back off and retry rather than failing the whole
    /api/live call over a transient rate limit."""
    last_error = None
    for attempt in range(attempts):
        response = client.get(url, params=params)
        if response.status_code == 429:
            last_error = RuntimeError("rate limited (429)")
            time.sleep(1.5 * (2 ** attempt))
            continue
        response.raise_for_status()
        return response
    raise last_error


def _parse_ts(value):
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def fetch_live():
    """Current temperature and air quality for every township, refetched from
    Open-Meteo at most once per hour.

    The previous version cached to a local file, which Render's free tier
    wipes every time the instance spins down from inactivity and restarts -
    a very ordinary thing to happen overnight. Every restart meant a fresh
    full fetch, and enough visitors arriving close together during one of
    those windows was what triggered the 429s. The cache now lives in
    Postgres, which survives restarts and deploys, so the hourly gate holds
    even when the server itself does not.
    """
    row = db.get_live_cache()
    if row and datetime.now(timezone.utc) < _parse_ts(row["next_fetch_at"]):
        payload = json.loads(row["payload"])
        payload["stale"] = False
        payload["next_fetch_at"] = row["next_fetch_at"]
        return payload

    with _live_lock:
        # someone else may have refreshed it while this call waited for the lock
        row = db.get_live_cache()
        if row and datetime.now(timezone.utc) < _parse_ts(row["next_fetch_at"]):
            payload = json.loads(row["payload"])
            payload["stale"] = False
            payload["next_fetch_at"] = row["next_fetch_at"]
            return payload

        try:
            payload = _fetch_live_uncached()
            fetched_at = datetime.now(timezone.utc)
            next_fetch_at = fetched_at + FETCH_INTERVAL
            db.save_live_cache(json.dumps(payload), fetched_at.isoformat(),
                               next_fetch_at.isoformat())
            payload = dict(payload)
            payload["stale"] = False
            payload["next_fetch_at"] = next_fetch_at.isoformat()
            return payload
        except Exception:
            # Open-Meteo itself is unreachable or still rate limiting - serve
            # whatever was last stored rather than a 503 for every visitor
            if row:
                payload = json.loads(row["payload"])
                payload["stale"] = True
                return payload
            raise


def _fetch_live_uncached():
    townships, meta = get_townships()
    lats = ",".join(f"{t['coords'][0]:.4f}" for t in townships)
    lons = ",".join(f"{t['coords'][1]:.4f}" for t in townships)

    with httpx.Client(timeout=30) as client:
        weather = _get_with_retry(client, WEATHER_URL, {
            "latitude": lats, "longitude": lons,
            "current": ("temperature_2m,relative_humidity_2m,apparent_temperature,"
                        "wind_speed_10m,uv_index,is_day,precipitation"),
            "timezone": "Asia/Yangon",
        })
        weather_rows = _as_list(weather.json())

        try:
            air = _get_with_retry(client, AIR_URL, {
                "latitude": lats, "longitude": lons,
                "current": "us_aqi,pm2_5", "timezone": "Asia/Yangon",
            })
            air_rows = _as_list(air.json())
        except Exception:
            air_rows = []

    temps = []
    raw = []
    for i, t in enumerate(townships):
        cur = weather_rows[i].get("current", {}) if i < len(weather_rows) else {}
        air_cur = air_rows[i].get("current", {}) if i < len(air_rows) else {}
        temp = cur.get("temperature_2m")
        if temp is not None:
            temps.append(temp)
        raw.append((t, cur, air_cur, temp))

    if not temps:
        raise RuntimeError("Open-Meteo returned no temperature readings")
    city_mean = sum(temps) / len(temps)

    out = []
    for t, cur, air_cur, temp in raw:
        if temp is None:
            temp = city_mean
        anomaly = temp - city_mean
        band, level = classify(anomaly)
        aqi = air_cur.get("us_aqi")
        aqi_value = int(round(aqi)) if aqi is not None else 0
        pm25 = air_cur.get("pm2_5")
        vuln = 50 + anomaly * 18 + (aqi_value - 50) * 0.30
        out.append({
            "name": t["name"],
            "name_my": t.get("name_my", t["name"]),
            "coords": t["coords"],
            "temp": round(temp, 1),
            "feels_like": cur.get("apparent_temperature"),
            "humidity": cur.get("relative_humidity_2m"),
            "wind": cur.get("wind_speed_10m"),
            "uv": cur.get("uv_index"),
            "uv_band": uv_band(cur.get("uv_index")),
            "is_day": bool(cur.get("is_day")),
            "rain": cur.get("precipitation"),
            "aqi": aqi_value,
            "aqi_band": aqi_band(aqi_value),
            "pm25": round(pm25, 1) if pm25 is not None else None,
            "pm25_band": pm25_band(pm25),
            "anomaly": round(anomaly, 2),
            "uhi_band": band,
            "uhi_level": level,
            "vulnerability": round(max(0.0, min(100.0, vuln)), 1),
        })

    payload = {
        "observed_at": next((w.get("current", {}).get("time")
                             for w in weather_rows if w.get("current")), None),
        "city_mean": round(city_mean, 2),
        "boundary_meta": meta,
        "townships": sorted(out, key=lambda r: r["temp"], reverse=True),
    }
    _write_cache("live.json", payload)
    return payload


def fetch_forecast(lat, lon):
    """48-hour outlook for one point."""
    key = f"forecast_{lat:.3f}_{lon:.3f}.json"
    cached = _read_cache(key, max_age_seconds=3600)
    if cached:
        return cached

    with httpx.Client(timeout=30) as client:
        resp = client.get(WEATHER_URL, params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m,apparent_temperature,precipitation_probability",
            "forecast_days": 3, "timezone": "Asia/Yangon",
        })
    resp.raise_for_status()
    hourly = resp.json().get("hourly", {})
    points = []
    for i, stamp in enumerate(hourly.get("time", [])):
        points.append({
            "time": stamp,
            "temp": hourly["temperature_2m"][i],
            "feels_like": hourly["apparent_temperature"][i],
            "rain_chance": hourly["precipitation_probability"][i],
        })
    payload = {"hours": points[:72]}
    _write_cache(key, payload)
    return payload


def fetch_climate_history(years=15):
    """Yearly means from the ERA5 reanalysis archive."""
    cached = _read_cache("history.json", max_age_seconds=86400)
    if cached:
        return cached

    import datetime as dt
    end = dt.date.today() - dt.timedelta(days=6)
    start = dt.date(end.year - years, 1, 1)

    with httpx.Client(timeout=60) as client:
        resp = client.get(ARCHIVE_URL, params={
            "latitude": YANGON_CENTRE[0], "longitude": YANGON_CENTRE[1],
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "daily": "temperature_2m_mean,temperature_2m_max",
            "timezone": "Asia/Yangon",
        })
    resp.raise_for_status()
    daily = resp.json().get("daily", {})

    buckets = {}
    for i, stamp in enumerate(daily.get("time", [])):
        mean = daily["temperature_2m_mean"][i]
        high = daily["temperature_2m_max"][i]
        if mean is None or high is None:
            continue
        year = int(stamp[:4])
        b = buckets.setdefault(year, {"mean": [], "max": [], "hot": 0})
        b["mean"].append(mean)
        b["max"].append(high)
        if high >= 38:
            b["hot"] += 1

    yearly = [{
        "year": year,
        "mean_temp": round(sum(b["mean"]) / len(b["mean"]), 2),
        "avg_daily_max": round(sum(b["max"]) / len(b["max"]), 2),
        "days_above_38": b["hot"],
        "complete": len(b["mean"]) > 350,
    } for year, b in sorted(buckets.items())]

    payload = {"yearly": yearly, "range": [daily["time"][0], daily["time"][-1]]}
    _write_cache("history.json", payload)
    return payload


def guidance(temp, feels_like=None):
    """Plain advice keyed to how hot it actually is."""
    peak = max(temp, feels_like or temp)
    if peak >= 40:
        return {
            "level": "danger",
            "headline_my": "အလွန်အန္တရာယ်များသည်",
            "headline_en": "Dangerous heat",
            "advice_my": "အပြင်ထွက်ခြင်း ရှောင်ပါ။ ရေများများသောက်ပါ။ သက်ကြီးရွယ်အိုနှင့် ကလေးများကို ဂရုစိုက်ပါ။",
            "advice_en": "Stay inside if you can. Drink water often, and check on elderly neighbours and children.",
        }
    if peak >= 36:
        return {
            "level": "warning",
            "headline_my": "အပူပြင်းသည်",
            "headline_en": "Hot",
            "advice_my": "နေ့လယ် ၁၁ နာရီမှ ညနေ ၄ နာရီအတွင်း အပြင်လုပ်ငန်း ရှောင်ပါ။ ရေမှန်မှန်သောက်ပါ။",
            "advice_en": "Avoid outdoor work between 11:00 and 16:00, and keep drinking water.",
        }
    if peak >= 32:
        return {
            "level": "warm",
            "headline_my": "နွေးသည်",
            "headline_en": "Warm",
            "advice_my": "အပြင်ထွက်လျှင် အရိပ်ရှာပါ။ ရေဘူးတစ်လုံး ယူသွားပါ။",
            "advice_en": "Find shade when you are out, and take water with you.",
        }
    return {
        "level": "comfortable",
        "headline_my": "သက်တောင့်သက်သာရှိသည်",
        "headline_en": "Comfortable",
        "advice_my": "အပူဒဏ် စိုးရိမ်စရာ မရှိပါ။",
        "advice_en": "No heat risk right now.",
    }


def nearest_township(lat, lon):
    townships, _ = get_townships()
    return min(townships, key=lambda t: haversine_km(lat, lon, t["coords"][0], t["coords"][1]))
