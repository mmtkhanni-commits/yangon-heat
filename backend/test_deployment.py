"""Check that a deployed Yangon Heat API is actually working.

    python test_deployment.py                       # tests the live deployment
    python test_deployment.py http://127.0.0.1:8000 # tests a local one

Reads only. Nothing here writes a report or a subscription, so it is safe to
run against production as often as you like.
"""

from __future__ import annotations

import sys
import time

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1
        else "https://yangon-heat-api.onrender.com").rstrip("/")

passed = failed = warned = 0


def report(ok, name, detail=""):
    global passed, failed
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1
    return ok


def warn(name, detail=""):
    global warned
    warned += 1
    print(f"  WARN  {name}" + (f" — {detail}" if detail else ""))


def get(path, timeout=90):
    started = time.time()
    response = httpx.get(f"{BASE}{path}", timeout=timeout)
    return response, round(time.time() - started, 1)


print(f"\nTesting {BASE}\n" + "=" * 60)

# ---------------------------------------------------------------- reachable
print("\n1. Server reachable")
try:
    response, seconds = get("/api/health")
    report(response.status_code == 200, "GET /api/health", f"{seconds}s")
    health = response.json()
    report(health.get("status") == "ok", "status is ok", str(health.get("status")))

    if health.get("database") == "postgres":
        report(True, "database is postgres")
    else:
        warn("database is sqlite",
             "fine locally; in production reports vanish on every restart")

    if seconds > 20:
        warn("slow first response", f"{seconds}s — free hosting was asleep")
except Exception as exc:
    report(False, "GET /api/health", str(exc)[:90])
    print("\nThe server is unreachable, so the rest cannot run.")
    sys.exit(1)

# --------------------------------------------------------------- live data
print("\n2. Live readings")
try:
    response, seconds = get("/api/live")
    report(response.status_code == 200, "GET /api/live", f"{seconds}s")
    live = response.json()
    rows = live.get("townships", [])

    report(len(rows) == 44, "44 townships returned", str(len(rows)))
    report(bool(live.get("observed_at")), "has an observation time",
           str(live.get("observed_at")))

    temps = [r["temp"] for r in rows]
    plausible = all(15 <= t <= 50 for t in temps)
    report(plausible, "every temperature is plausible",
           f"{min(temps)}–{max(temps)} C")

    ordered = all(temps[i] >= temps[i + 1] for i in range(len(temps) - 1))
    report(ordered, "sorted hottest first")

    spread = round(max(temps) - min(temps), 1)
    report(spread > 0, "there is a spread across the city", f"{spread} C")
    if spread > 8:
        warn("unusually large spread", f"{spread} C — worth a look")

    mean = live.get("city_mean")
    computed = round(sum(temps) / len(temps), 1)
    report(abs(mean - computed) < 0.3, "city mean matches the readings",
           f"reported {mean}, computed {computed}")

    anomalies = [r["anomaly"] for r in rows]
    report(abs(sum(anomalies)) < 2, "anomalies sum to about zero",
           f"{round(sum(anomalies), 2)}")

    hottest, coolest = rows[0], rows[-1]
    report(hottest["anomaly"] > 0 > coolest["anomaly"],
           "hottest is above the mean and coolest below",
           f"{hottest['name']} {hottest['anomaly']:+} / "
           f"{coolest['name']} {coolest['anomaly']:+}")

    burmese = sum(1 for r in rows if r.get("name_my"))
    report(burmese == 44, "all have Burmese names", str(burmese))

    matched = live.get("boundary_meta", {}).get("matched", 0)
    if matched >= 40:
        report(True, "township polygons matched", f"{matched}/44")
    else:
        warn("few polygons matched", f"{matched}/44 — the map will fall back to pins")
except Exception as exc:
    report(False, "GET /api/live", str(exc)[:90])
    live = {"townships": []}

# ------------------------------------------------------------------ detail
print("\n3. Township detail")
try:
    name = live["townships"][0]["name"]
    response, _ = get(f"/api/township/{name}")
    report(response.status_code == 200, f"GET /api/township/{name}")
    detail = response.json()
    report("guidance" in detail, "includes guidance",
           detail.get("guidance", {}).get("level", ""))
    report(detail["city"]["rank"] == 1, "hottest township ranks first")
    report(bool(detail["guidance"].get("advice_my")), "advice is available in Burmese")

    response, _ = get("/api/township/NotARealPlace")
    report(response.status_code == 404, "unknown township returns 404",
           str(response.status_code))
except Exception as exc:
    report(False, "township detail", str(exc)[:90])

# ----------------------------------------------------------------- nearest
print("\n4. Nearest township")
try:
    response, _ = get("/api/nearest?lat=16.7758&lon=96.1500")
    report(response.status_code == 200, "downtown coordinates resolve",
           response.json().get("name", ""))

    response, _ = get("/api/nearest?lat=48.85&lon=2.35")
    report(response.status_code == 404, "Paris is rejected as outside Yangon",
           str(response.status_code))
except Exception as exc:
    report(False, "nearest", str(exc)[:90])

# ---------------------------------------------------------------- forecast
print("\n5. Forecast")
try:
    name = live["townships"][0]["name"]
    response, _ = get(f"/api/forecast?township={name}")
    report(response.status_code == 200, f"GET /api/forecast for {name}")
    hours = response.json().get("hours", [])
    report(len(hours) >= 48, "at least 48 hourly points", str(len(hours)))
    report(all(15 <= h["temp"] <= 50 for h in hours),
           "forecast temperatures are plausible")
except Exception as exc:
    report(False, "forecast", str(exc)[:90])

# ----------------------------------------------------------------- history
print("\n6. Climate record")
try:
    response, seconds = get("/api/history?years=15")
    report(response.status_code == 200, "GET /api/history", f"{seconds}s")
    yearly = response.json().get("yearly", [])
    report(len(yearly) >= 10, "at least 10 years", str(len(yearly)))

    complete = [y for y in yearly if y["complete"]]
    if len(complete) >= 2:
        change = round(complete[-1]["mean_temp"] - complete[0]["mean_temp"], 2)
        report(True, "warming trend measured",
               f"{change:+} C from {complete[0]['year']} to {complete[-1]['year']}")
    report(all(20 <= y["mean_temp"] <= 35 for y in yearly),
           "annual means are plausible")
except Exception as exc:
    report(False, "history", str(exc)[:90])

# --------------------------------------------------------------- boundaries
print("\n7. Boundaries")
try:
    response, seconds = get("/api/boundaries")
    report(response.status_code == 200, "GET /api/boundaries", f"{seconds}s")
    features = response.json().get("features", [])
    report(len(features) >= 40, "polygons returned", str(len(features)))
except Exception as exc:
    report(False, "boundaries", str(exc)[:90])

# ---------------------------------------------------------------- satellite
print("\n8. Satellite (optional)")
try:
    response, _ = get("/api/satellite/status")
    status = response.json()
    if status.get("ready"):
        report(True, "Earth Engine connected", status.get("message", "")[:50])
        response, seconds = get("/api/satellite/lst", timeout=180)
        if response.status_code == 200:
            layer = response.json()
            report(True, "Landsat composite built",
                   f"{layer['scenes']} scenes, latest {layer['latest_pass']}, "
                   f"{layer['min']}–{layer['max']} C")
            sane = 15 <= layer["min"] and layer["max"] <= 60
            report(sane, "surface temperatures are physically plausible")
        elif response.status_code == 404:
            warn("no cloud-free scenes", "expected during the monsoon")
        else:
            report(False, "satellite LST", str(response.status_code))
    else:
        warn("Earth Engine not configured", str(status.get("message"))[:60])
except Exception as exc:
    warn("satellite check skipped", str(exc)[:60])

# --------------------------------------------------------------- assistant
print("\n9. Assistant (optional)")
try:
    response = httpx.post(f"{BASE}/api/chat", timeout=90, json={
        "messages": [{"role": "user", "content": "Reply with the word OK only."}],
        "lang": "en"})
    if response.status_code == 200:
        reply = response.json().get("reply", "")
        report(bool(reply), "assistant replied", reply[:50])
    elif response.status_code == 503:
        warn("assistant not configured", "GROQ_API_KEY is missing on the server")
    else:
        report(False, "assistant", str(response.status_code))
except Exception as exc:
    warn("assistant check skipped", str(exc)[:60])

# --------------------------------------------------------------------- CORS
print("\n10. Browser access (CORS)")
try:
    origin = BASE.replace("-api", "-app")
    response = httpx.options(f"{BASE}/api/chat", timeout=30, headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    allowed = response.headers.get("access-control-allow-origin", "")
    ok = allowed in ("*", origin)
    report(ok, "preflight allows the app origin",
           allowed or "no header — the browser will report 'Failed to fetch'")
except Exception as exc:
    report(False, "CORS preflight", str(exc)[:90])

print("\n" + "=" * 60)
print(f"  {passed} passed, {failed} failed, {warned} warnings")
print("=" * 60)
if warned:
    print("  Warnings are not failures — they flag optional pieces that are\n"
          "  switched off, or conditions worth knowing about.")
sys.exit(1 if failed else 0)
