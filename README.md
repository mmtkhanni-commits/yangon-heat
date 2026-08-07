# Yangon Heat

Live temperature, air quality and urban heat island readings for the 44 townships
of Yangon Region.

The project is now three separate pieces. They can run together or apart.

```
backend/    FastAPI JSON API — the only thing that talks to external services
frontend/   Installable web app for residents (no build step, plain HTML/CSS/JS)
app.py      The original Streamlit dashboard, for analysis and satellite layers
```

## Why three pieces

The Streamlit dashboard is good at analysis: satellite layers, clustering,
PDF export, scenario dates. It is not good at being a public web app — every
visitor gets their own Python session, there is no API, and a phone user waits
for a full server round trip on every tap.

So the analytical work stays in Streamlit, and residents get a small fast app
backed by a real API. Both read the same data sources, so the numbers agree.

## Data sources

| What | Source | Refresh | Licence |
|---|---|---|---|
| Temperature, humidity, wind | Open-Meteo forecast API | hourly | free, no key |
| US AQI, PM2.5 | Open-Meteo air quality API | hourly | free, no key |
| 15-year climate record | Open-Meteo ERA5 archive | daily | free, no key |
| Township polygons | geoBoundaries MMR ADM3 | static | CC-BY 4.0 |
| Land surface temperature, NDVI | Landsat 8/9, Sentinel-2 via Google Earth Engine | 8–16 days | needs a registered EE project |

Urban heat island level is each township's temperature anomaly against the
city-wide mean at the same moment, not an absolute threshold.

## Run the API

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Open http://127.0.0.1:8000/docs for the interactive API reference.

The first request downloads the township boundary file, which takes a few
seconds. It is cached in `backend/cache/` after that.

### Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/live` | Every township, hottest first |
| GET | `/api/township/{name}` | One township, with guidance and city ranking |
| GET | `/api/nearest?lat=&lon=` | Closest township to a coordinate |
| GET | `/api/forecast?township=` | 72 hourly points |
| GET | `/api/history?years=15` | Yearly means from ERA5 |
| GET | `/api/boundaries` | GeoJSON polygons |
| GET | `/api/readings` | City averages this deployment has logged |
| POST | `/api/reports` | Submit a citizen report |
| POST | `/api/alerts` | Subscribe to heat alerts |
| DELETE | `/api/alerts?email=` | Unsubscribe |

## Run the resident app

With the API running, serve the frontend from any static server:

```bash
cd frontend
python -m http.server 5500
```

Then open http://127.0.0.1:5500. If the API is on a different host, add this
line to `index.html` above the `app.js` tag:

```html
<script>window.API_BASE = 'https://your-api-host';</script>
```

Uvicorn also serves the frontend itself when `frontend/` sits next to
`backend/`, so a single deployment can host both at one origin.

## Run the Streamlit dashboard

```bash
pip install -r requirements.txt
streamlit run app.py
```

Secrets go in `.streamlit/secrets.toml`:

```toml
GROQ_API_KEY = "gsk_..."
GEE_PROJECT = "yangon-uhi"
```

with the Earth Engine service account key at `.streamlit/gee-key.json`.

## Heat alerts

`backend/send_alerts.py` emails everyone whose township has passed the limit
they chose. Run it on a schedule — hourly is plenty:

```bash
cd backend
SMTP_HOST=smtp.gmail.com SMTP_USER=you@gmail.com \
SMTP_PASSWORD=your-app-password ALERT_FROM=you@gmail.com \
python send_alerts.py
```

Gmail requires an app password rather than the account password. With no SMTP
variables set the script reports what it would send and sends nothing, which
makes it safe to try first.

Nobody is emailed twice within six hours, so a long hot afternoon produces one
message rather than a stream of them.

## Storage

SQLite by default, at `backend/data/uhi.db`. Set `DATABASE_URL` to a Postgres
connection string and the same code uses Postgres instead:

```bash
export DATABASE_URL="postgresql://user:pass@host/dbname"
```

Do this before deploying anywhere. Hosted platforms wipe local disk on every
restart, which would take the citizen reports and alert subscriptions with it.
Neon and Supabase both have free tiers that are enough for this.

## Deploying

1. **Database** — create a Postgres database on Neon or Supabase, copy the
   connection string.
2. **API** — deploy `backend/` to Render, Railway or Fly. Start command:
   `uvicorn main:app --host 0.0.0.0 --port $PORT`. Set `DATABASE_URL` and
   `ALLOWED_ORIGINS` (your frontend's URL).
3. **Frontend** — deploy `frontend/` to Netlify, Vercel or GitHub Pages as
   static files, with `window.API_BASE` pointing at the API.
4. **Alerts** — add a scheduled job running `python send_alerts.py` hourly.
5. **Streamlit** — deploy to Streamlit Community Cloud separately if you want
   the analytical dashboard online too.

`DEPLOY.md` has the step-by-step version including Git setup.

## What the app does not know

- No cooling centre locations, clinic capacity or population data. Those need a
  municipal dataset that this project does not have.
- Satellite layers are a cloud-filtered median of recent passes, not the current
  moment. Yangon's monsoon blocks many scenes between May and October.
- The greening simulator is a linear approximation across a published range, not
  a microclimate model.
- Township polygons come from geoBoundaries, which is open but not the official
  Myanmar government boundary set. MIMU publishes the authoritative version but
  requires written agreement before it is used on an online platform.
