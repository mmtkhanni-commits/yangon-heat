"""Yangon heat API.

Run locally:      uvicorn main:app --reload
Interactive docs: http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import os
import tempfile
from datetime import date

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

import db
import report
import satellite
import sources

app = FastAPI(
    title="Yangon Heat API",
    version="1.0.0",
    description=(
        "Live temperature, air quality and urban heat island readings for the 44 "
        "townships of Yangon Region. Weather and air quality from Open-Meteo, "
        "township boundaries from geoBoundaries (CC-BY 4.0)."
    ),
)

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
                   if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    # OPTIONS matters: a POST carrying JSON is preflighted, and the preflight
    # fails silently in the browser as "Failed to fetch" if it is not allowed
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)


@app.on_event("startup")
def startup():
    db.init()


# ------------------------------------------------------------------- models

class ReportIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    township: str
    intensity: int = Field(ge=1, le=10)
    notes: str = Field(default="", max_length=1000)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    township: str | None = None
    lang: str = Field(default="my", pattern="^(my|en)$")


class SubscriptionIn(BaseModel):
    email: EmailStr
    township: str
    threshold: float = Field(default=36.0, ge=25.0, le=50.0)


# ------------------------------------------------------------------ reading

@app.get("/api/health")
def health():
    return {"status": "ok", "database": "postgres" if db.IS_POSTGRES else "sqlite"}


@app.get("/api/townships")
def townships():
    """Names, centroids and polygons. The polygon payload is large — request it
    only when you are drawing the map."""
    rows, meta = sources.get_townships()
    return {"meta": meta, "townships": [
        {k: v for k, v in t.items() if k != "geometry"} for t in rows
    ]}


@app.get("/api/boundaries")
def boundaries():
    data = sources.load_boundaries()
    if not data:
        raise HTTPException(503, "Boundary file could not be fetched. Try again shortly.")
    return data


@app.get("/api/live")
def live():
    """Current readings for every township, hottest first."""
    try:
        payload = sources.fetch_live()
    except Exception as exc:
        raise HTTPException(503, f"Live feed unavailable: {exc}") from exc

    try:
        db.log_readings(payload["townships"], payload.get("observed_at"))
    except Exception:
        pass  # logging is a convenience, never a reason to fail the request

    return payload


@app.get("/api/township/{name}")
def township_detail(name: str):
    payload = sources.fetch_live()
    match = next((t for t in payload["townships"] if t["name"].lower() == name.lower()), None)
    if not match:
        raise HTTPException(404, f"No township called {name!r}. Try /api/townships for the list.")

    hottest = payload["townships"][0]
    coolest = payload["townships"][-1]
    return {
        "township": match,
        "guidance": sources.guidance(match["temp"], match.get("feels_like")),
        "city": {
            "mean": payload["city_mean"],
            "hottest": {"name": hottest["name"], "temp": hottest["temp"]},
            "coolest": {"name": coolest["name"], "temp": coolest["temp"]},
            "rank": payload["townships"].index(match) + 1,
            "total": len(payload["townships"]),
        },
        "observed_at": payload["observed_at"],
    }


@app.get("/api/nearest")
def nearest(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180)):
    """Which township a set of coordinates falls closest to."""
    town = sources.nearest_township(lat, lon)
    distance = sources.haversine_km(lat, lon, town["coords"][0], town["coords"][1])
    if distance > 80:
        raise HTTPException(404, "That location is outside Yangon Region.")
    return {"name": town["name"], "name_my": town.get("name_my"),
            "distance_km": round(distance, 1)}


@app.get("/api/forecast")
def forecast(township: str | None = None, lat: float | None = None, lon: float | None = None):
    if township:
        rows, _ = sources.get_townships()
        match = next((t for t in rows if t["name"].lower() == township.lower()), None)
        if not match:
            raise HTTPException(404, f"No township called {township!r}.")
        lat, lon = match["coords"]
    if lat is None or lon is None:
        raise HTTPException(400, "Pass either township, or both lat and lon.")

    try:
        return sources.fetch_forecast(lat, lon)
    except Exception as exc:
        raise HTTPException(503, f"Forecast unavailable: {exc}") from exc


@app.get("/api/history")
def history(years: int = Query(default=15, ge=1, le=40)):
    try:
        return sources.fetch_climate_history(years)
    except Exception as exc:
        raise HTTPException(503, f"Climate archive unavailable: {exc}") from exc


@app.get("/api/readings")
def readings(hours: int = Query(default=168, ge=1, le=2000)):
    """City-wide averages this deployment has recorded so far."""
    return {"readings": db.reading_history(hours)}


# --------------------------------------------------------------- satellite

@app.get("/api/satellite/status")
def satellite_status():
    return satellite.status()


@app.get("/api/satellite/lst")
def satellite_lst(days_back: int = Query(default=60, ge=7, le=365)):
    """Landsat land surface temperature composite as map tiles."""
    try:
        layer = satellite.lst_layer(days_back)
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc
    if not layer:
        raise HTTPException(
            404, f"No cloud-free Landsat scenes over Yangon in the last "
                 f"{days_back} days. Widen days_back, or wait for the monsoon to ease.")
    return layer


@app.get("/api/satellite/ndvi")
def satellite_ndvi(days_back: int = Query(default=120, ge=14, le=365)):
    """Sentinel-2 vegetation cover composite as map tiles."""
    try:
        layer = satellite.ndvi_layer(days_back)
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc
    if not layer:
        raise HTTPException(404, "No suitable Sentinel-2 scenes for this window.")
    return layer


@app.get("/api/satellite/townships")
def satellite_townships(days_back: int = Query(default=60, ge=7, le=365)):
    """Whole-township average surface temperature from Landsat."""
    try:
        return {"lst": satellite.lst_by_township(days_back)}
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


# ------------------------------------------------------------------ report

@app.get("/api/report.pdf")
def download_report(lang: str = Query(default="my", pattern="^(my|en)$"),
                    include_satellite: bool = False):
    try:
        live = sources.fetch_live()
    except Exception as exc:
        raise HTTPException(503, f"Live feed unavailable: {exc}") from exc

    sat = None
    if include_satellite:
        try:
            sat = satellite.lst_layer()
        except Exception:
            sat = None

    path, burmese_ok = report.build_report(live, lang, sat)
    stamp = date.today().isoformat()
    return FileResponse(
        path, media_type="application/pdf",
        filename=f"yangon-heat-{stamp}.pdf",
        headers={"X-Burmese-Font": "yes" if burmese_ok else "no"})


# ------------------------------------------------------------------- voice

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Speech to text, so people can ask by voice instead of typing Burmese."""
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Voice input needs GROQ_API_KEY on the server.")

    data = await audio.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "That recording is too long. Keep it under a minute.")

    try:
        with httpx.Client(timeout=120) as client:
            response = client.post(
                GROQ_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {key}"},
                files={"file": (audio.filename or "clip.webm", data,
                                audio.content_type or "audio/webm")},
                data={"model": "whisper-large-v3"})
        response.raise_for_status()
        return {"text": response.json().get("text", "").strip()}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"Transcription failed "
                                 f"({exc.response.status_code}).") from exc
    except Exception as exc:
        raise HTTPException(503, f"Transcription unavailable: {exc}") from exc


@app.post("/api/speak")
def speak(text: str = Form(..., max_length=2000),
          lang: str = Form(default="my")):
    """Text to speech, for readers who would rather listen than read."""
    try:
        from gtts import gTTS
    except ImportError as exc:
        raise HTTPException(503, "gTTS is not installed on the server.") from exc

    voice = "my" if lang == "my" else "en"
    try:
        clip = gTTS(text=text, lang=voice, slow=False)
        target = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        clip.save(target.name)
        with open(target.name, "rb") as f:
            payload = f.read()
        os.unlink(target.name)
    except Exception as exc:
        raise HTTPException(503, f"Speech unavailable: {exc}") from exc

    return Response(content=payload, media_type="audio/mpeg")


# --------------------------------------------------------------------- chat

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


@app.post("/api/chat")
def chat(payload: ChatIn):
    """Proxy to Groq so the API key never reaches the browser.

    The current readings are injected as context, so the assistant answers about
    what the dashboard is actually showing rather than from general knowledge.
    """
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            503, "The assistant is not configured. Set GROQ_API_KEY on the server.")

    context = ""
    try:
        live = sources.fetch_live()
        hottest = live["townships"][0]
        coolest = live["townships"][-1]
        context = (
            f"Current readings, observed {live['observed_at']} Asia/Yangon. "
            f"City average {live['city_mean']} °C. "
            f"Hottest: {hottest['name']} at {hottest['temp']} °C. "
            f"Coolest: {coolest['name']} at {coolest['temp']} °C. "
        )
        if payload.township:
            mine = next((t for t in live["townships"]
                         if t["name"].lower() == payload.township.lower()), None)
            if mine:
                context += (
                    f"The reader is looking at {mine['name']}: {mine['temp']} °C, "
                    f"feels like {mine['feels_like']} °C, US AQI {mine['aqi']}, "
                    f"{mine['anomaly']:+} °C against the city average.")
    except Exception:
        context = "Live readings are unavailable right now."

    language = ("Reply in Burmese." if payload.lang == "my"
                else "Reply in English.")

    system = (
        "You help residents of Yangon understand heat and air quality. "
        "Answer in plain language a non-specialist can act on, in two or three "
        "short paragraphs at most. Use the readings given below when they are "
        "relevant, and say so plainly when you do not know something. "
        "You are not a doctor: for symptoms, say to seek medical care. "
        f"{language}\n\n{context}"
    )

    messages = [{"role": "system", "content": system}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    try:
        with httpx.Client(timeout=60) as client:
            response = client.post(GROQ_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": GROQ_MODEL, "messages": messages, "temperature": 0.6,
                      "max_tokens": 700})
        response.raise_for_status()
        reply = response.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"The assistant refused the request "
                                 f"({exc.response.status_code}).") from exc
    except Exception as exc:
        raise HTTPException(503, f"The assistant is unreachable: {exc}") from exc

    return {"reply": reply}


# ------------------------------------------------------------------ writing

@app.post("/api/reports", status_code=201)
def create_report(payload: ReportIn):
    names = {t["name"] for t in sources.get_townships()[0]}
    if payload.township not in names:
        raise HTTPException(400, f"{payload.township!r} is not a Yangon township.")
    db.add_report(payload.name, payload.township, payload.intensity, payload.notes)
    return {"status": "saved"}


@app.get("/api/reports")
def get_reports(limit: int = Query(default=100, ge=1, le=500)):
    return {"reports": db.list_reports(limit), "summary": db.report_summary()}


@app.post("/api/alerts", status_code=201)
def subscribe(payload: SubscriptionIn):
    names = {t["name"] for t in sources.get_townships()[0]}
    if payload.township not in names:
        raise HTTPException(400, f"{payload.township!r} is not a Yangon township.")
    db.add_subscription(str(payload.email), payload.township, payload.threshold)
    return {"status": "subscribed", "township": payload.township,
            "threshold": payload.threshold}


@app.delete("/api/alerts")
def unsubscribe(email: EmailStr, township: str | None = None):
    removed = db.remove_subscription(str(email), township)
    if not removed:
        raise HTTPException(404, "No subscription found for that address.")
    return {"status": "removed", "count": removed}


# Serve the built frontend from the same origin when it is present, so a single
# deployment can host both. Keep this last: it claims every remaining path.
# Windows keeps the folder as "Frontend" and will not let git rename it, so
# accept either spelling rather than fighting the filesystem.
_candidates = [os.environ.get("FRONTEND_DIR"), "../frontend", "../Frontend",
               "frontend", "Frontend"]
FRONTEND_DIR = next((p for p in _candidates if p and os.path.isdir(p)), None)
if FRONTEND_DIR:
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
