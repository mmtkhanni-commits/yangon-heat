"""Satellite layers from Google Earth Engine.

Landsat 8/9 gives land surface temperature at 30 m; Sentinel-2 gives vegetation
cover. Both are cloud-masked, because an unmasked cloud top reads as roughly
-30 °C and would poison the whole composite.

Neither is live. Satellites revisit Yangon every 8-16 days and the monsoon
blocks many passes, so these are cloud-filtered median composites of recent
passes. Every response says how many scenes went in and when the last one was,
so the caller can decide whether that is fresh enough.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile

import sources

try:
    import ee
    EE_INSTALLED = True
except ImportError:
    EE_INSTALLED = False

_state = {"ready": False, "message": "not initialised"}

YANGON_RECT = [
    sources.YANGON_BBOX["lon_min"], sources.YANGON_BBOX["lat_min"],
    sources.YANGON_BBOX["lon_max"], sources.YANGON_BBOX["lat_max"],
]

LST_PALETTE = ["1e3a8a", "0891b2", "22c55e", "facc15", "f97316", "dc2626"]
NDVI_PALETTE = ["a52a2a", "d9c27b", "ffffcc", "9ccb6b", "3d8f3d", "134d13"]


def _key_path():
    """Service account key from a file, or written from an environment variable
    so the same code works on a host with no filesystem to put it on."""
    path = os.environ.get("GEE_KEY_PATH", "").strip()
    if path and os.path.exists(path):
        return path

    for candidate in ("gee-key.json", "../.streamlit/gee-key.json", "../gee-key.json"):
        if os.path.exists(candidate):
            return candidate

    raw = os.environ.get("GEE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        target = os.path.join(tempfile.gettempdir(), "gee-key.json")
        with open(target, "w", encoding="utf-8") as f:
            f.write(raw)
        return target

    return None


def init():
    """Returns (ready, message). Safe to call repeatedly."""
    if _state["ready"]:
        return True, _state["message"]

    if not EE_INSTALLED:
        _state["message"] = "earthengine-api is not installed on the server"
        return False, _state["message"]

    path = _key_path()
    if not path:
        _state["message"] = ("No Earth Engine credentials. Set GEE_KEY_PATH or "
                             "GEE_SERVICE_ACCOUNT_JSON.")
        return False, _state["message"]

    try:
        with open(path, "r", encoding="utf-8") as f:
            key = json.load(f)
        project = os.environ.get("GEE_PROJECT") or key.get("project_id")
        credentials = ee.ServiceAccountCredentials(key.get("client_email"), path)
        ee.Initialize(credentials, project=project)
        _state["ready"] = True
        _state["message"] = f"connected to {project}"
        return True, _state["message"]
    except Exception as exc:
        _state["message"] = str(exc)
        return False, _state["message"]


def status():
    ready, message = init()
    return {"ready": ready, "message": message, "installed": EE_INSTALLED}


def _region():
    return ee.Geometry.Rectangle(YANGON_RECT)


def _mask_landsat(img):
    """QA_PIXEL bits 1-4 are dilated cloud, cirrus, cloud and cloud shadow."""
    qa = img.select("QA_PIXEL")
    keep = (qa.bitwiseAnd(1 << 1).eq(0)
            .And(qa.bitwiseAnd(1 << 2).eq(0))
            .And(qa.bitwiseAnd(1 << 3).eq(0))
            .And(qa.bitwiseAnd(1 << 4).eq(0)))
    return img.updateMask(keep)


def _to_celsius(img):
    lst = img.select("ST_B10").multiply(0.00341802).add(149.0).subtract(273.15)
    return (lst.updateMask(lst.gt(5).And(lst.lt(65)))
            .rename("LST").copyProperties(img, ["system:time_start"]))


def _landsat_collection(days_back):
    end = ee.Date(dt.date.today().isoformat())
    start = end.advance(-days_back, "day")
    return (ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
            .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
            .filterBounds(_region()).filterDate(start, end)
            .filter(ee.Filter.lt("CLOUD_COVER", 80)))


def lst_layer(days_back=60):
    ready, message = init()
    if not ready:
        raise RuntimeError(message)

    collection = _landsat_collection(days_back)
    count = collection.size().getInfo()
    if count == 0:
        return None

    composite = (collection.map(_mask_landsat).map(_to_celsius)
                 .median().clip(_region()))
    stats = composite.reduceRegion(
        reducer=ee.Reducer.percentile([2, 98]), geometry=_region(),
        scale=200, maxPixels=1e9, bestEffort=True).getInfo()

    low, high = stats.get("LST_p2"), stats.get("LST_p98")
    if low is None or high is None:
        return None
    low, high = max(15.0, low), min(60.0, high)
    if high - low < 3:
        high = low + 3

    vis = {"min": low, "max": high, "palette": LST_PALETTE}
    stamps = collection.aggregate_array("system:time_start").getInfo()
    latest = (dt.datetime.utcfromtimestamp(max(stamps) / 1000).date().isoformat()
              if stamps else None)

    return {
        "tile_url": composite.getMapId(vis)["tile_fetcher"].url_format,
        "scenes": count,
        "latest_pass": latest,
        "min": round(low, 1),
        "max": round(high, 1),
        "palette": LST_PALETTE,
        "unit": "°C",
    }


def ndvi_layer(days_back=120):
    ready, message = init()
    if not ready:
        raise RuntimeError(message)

    end = ee.Date(dt.date.today().isoformat())
    start = end.advance(-days_back, "day")

    def mask_s2(img):
        # SCL 3 = cloud shadow, 8/9 = cloud, 10 = cirrus, 11 = snow
        scl = img.select("SCL")
        keep = (scl.neq(3).And(scl.neq(8)).And(scl.neq(9))
                .And(scl.neq(10)).And(scl.neq(11)))
        return img.updateMask(keep)

    collection = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                  .filterBounds(_region()).filterDate(start, end)
                  .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 70)))

    count = collection.size().getInfo()
    if count == 0:
        return None

    ndvi = (collection.map(mask_s2).median()
            .normalizedDifference(["B8", "B4"]).rename("NDVI").clip(_region()))
    vis = {"min": 0.0, "max": 0.8, "palette": NDVI_PALETTE}

    return {
        "tile_url": ndvi.getMapId(vis)["tile_fetcher"].url_format,
        "scenes": count,
        "min": 0.0,
        "max": 0.8,
        "palette": NDVI_PALETTE,
        "unit": "NDVI",
    }


def lst_by_township(days_back=60):
    """Whole-township average surface temperature, which is far more meaningful
    than sampling a single pixel at the centroid."""
    ready, message = init()
    if not ready:
        raise RuntimeError(message)

    collection = _landsat_collection(days_back)
    if collection.size().getInfo() == 0:
        return {}

    composite = collection.map(_mask_landsat).map(_to_celsius).median()
    townships, _ = sources.get_townships()

    features = []
    for t in townships:
        if t.get("geometry"):
            geom = ee.Geometry(t["geometry"])
        else:
            geom = ee.Geometry.Point([t["coords"][1], t["coords"][0]]).buffer(1500)
        features.append(ee.Feature(geom, {"name": t["name"]}))

    sampled = composite.reduceRegions(
        collection=ee.FeatureCollection(features),
        reducer=ee.Reducer.mean(), scale=100).getInfo()

    out = {}
    for feature in sampled.get("features", []):
        props = feature.get("properties", {})
        if props.get("mean") is not None:
            out[props["name"]] = round(props["mean"], 1)
    return out
