import streamlit as st
import pandas as pd
import random
import time
import folium
from streamlit_folium import st_folium
from folium.plugins import HeatMap
from sklearn.cluster import KMeans
from fpdf import FPDF
import tempfile
import os
import json
import sqlite3
import difflib
from pathlib import Path
from openai import OpenAI
from gtts import gTTS
import requests
from streamlit_lottie import st_lottie

try:
    import ee
    EE_AVAILABLE = True
except ImportError:
    EE_AVAILABLE = False

# Page Config
st.set_page_config(
    page_title="Yangon Urban Heat Island & Environmental Intelligence",
    page_icon="🏙️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Helper function to load Lottie animations safely
def load_lottie_url(url):
    try:
        r = requests.get(url)
        if r.status_code != 200:
            return None
        return r.json()
    except:
        return None

# Load Animations
lottie_loading = load_lottie_url("https://assets5.lottiefiles.com/packages/lf20_49rdyisj.json")
lottie_eco = load_lottie_url("https://assets10.lottiefiles.com/packages/lf20_qp1qhd3h.json")

# Custom CSS for Advanced App-like UI/UX, Motion Effects, Compact Header & Glassmorphism
st.markdown("""
<style>
    /* --- FULL WEB PAGE BACKGROUND (DARK NAVY & EMERALD GRADIENT) --- */
    .stApp {
        background: linear-gradient(135deg, #0b132b 0%, #1c2541 50%, #064e3b 100%) !important;
        color: #f8fafc !important;
        font-family: 'Segoe UI', sans-serif;
    }

    /* --- REMOVE STREAMLIT TOP HEADER, DEPLOY BUTTON & THREE DOTS --- */
    header.stAppHeader {
        background-color: transparent !important;
        display: none !important;
    }

    .block-container {
        padding-top: 0.5rem !important;
        padding-bottom: 2rem !important;
        padding-left: 2rem !important;
        padding-right: 2rem !important;
    }

    /* --- SIDEBAR TOP SPACING FIX (PERFECT VERTICAL ALIGNMENT WITH MAIN HEADER) --- */
    section[data-testid="stSidebar"],
    div[data-testid="stSidebar"] {
        padding-top: 0rem !important;
    }

    section[data-testid="stSidebar"] > div:first-child {
        padding-top: 0rem !important;
    }

    /* collapse arrow header နေရာ ဖျက်ရန် (version အလိုက် နာမည်မတူလို့ အားလုံးထည့်ထား) */
    div[data-testid="stSidebarHeader"],
    div[data-testid="stSidebarNav"],
    div[data-testid="stSidebarNavItems"] {
        padding: 0 !important;
        margin: 0 !important;
        height: 0 !important;
        min-height: 0 !important;
    }

    div[data-testid="stSidebarUserContent"],
    section[data-testid="stSidebar"] .block-container {
        padding-top: 0rem !important;
        margin-top: 0rem !important;
    }

    /* --- COMPACT SLEEK HEADER CONTAINER --- */
    .custom-app-header {
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(52, 211, 153, 0.25);
        padding: 12px 20px;
        border-radius: 14px;
        backdrop-filter: blur(12px);
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .main-title {
        font-size: 21px;
        font-weight: 700;
        color: #34d399 !important;
        margin: 0 0 3px 0;
    }
    .sub-title {
        font-size: 13px;
        color: #94a3b8 !important;
        margin: 0;
    }
    .live-badge {
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(52, 211, 153, 0.55);
        color: #34d399;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        padding: 5px 10px;
        border-radius: 8px;
        white-space: nowrap;
    }
    .demo-badge {
        background: rgba(250, 204, 21, 0.12);
        border: 1px solid rgba(250, 204, 21, 0.45);
        color: #facc15;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        padding: 5px 10px;
        border-radius: 8px;
        white-space: nowrap;
    }

    /* --- TEXT VISIBILITY (SCOPED - dropdown / popup / map ကို မထိစေရန်) --- */
    .stApp .stMarkdown, .stApp .stText,
    .stApp h1, .stApp h2, .stApp h3, .stApp h4, .stApp h5, .stApp h6,
    .stApp .stMarkdown p, .stApp .stMarkdown li,
    .stApp label, .stApp .stSlider label, .stApp .stDateInput label {
        color: #f8fafc !important;
    }

    /* folium popup / dropdown menu တွေက မူရင်းအရောင်အတိုင်း ဖတ်လို့ရအောင် */
    .leaflet-popup-content, .leaflet-popup-content * {
        color: #0f172a !important;
    }

    /* --- CUSTOM SECTION HEADERS --- */
    .custom-section-header {
        font-size: 18px;
        font-weight: 700;
        color: #34d399;
        border-left: 4px solid #10b981;
        border-radius: 0;
        padding-left: 10px;
        margin-top: 15px;
        margin-bottom: 10px;
    }

    /* --- ADVANCED FROSTED GLASS CARDS & METRICS --- */
    div[data-testid="stMetric"], div.stInfo, div.stSuccess, div.stError {
        background: rgba(30, 41, 59, 0.75) !important;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(52, 211, 153, 0.25) !important;
        padding: 12px;
        border-radius: 14px;
        box-shadow: 0 10px 30px 0 rgba(0, 0, 0, 0.4);
        transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    }

    div[data-testid="stMetric"]:hover {
        transform: translateY(-3px);
        border-color: rgba(52, 211, 153, 0.6) !important;
        box-shadow: 0 12px 40px 0 rgba(16, 185, 129, 0.3);
    }

    div[data-testid="stMetric"] label, div[data-testid="stMetric"] div {
        color: #f8fafc !important;
    }

    /* --- MODERN FLUID BUTTONS WITH MOTION --- */
    .stButton>button, div.stButton > button, .stDownloadButton>button {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.5)) !important;
        color: #34d399 !important;
        border: 1px solid rgba(16, 185, 129, 0.6) !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        padding: 0.5rem 1rem !important;
        cursor: pointer !important;
        width: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        text-align: center !important;
        transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
    }

    .stButton>button:hover, div.stButton > button:hover, .stDownloadButton>button:hover {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.5), rgba(5, 150, 105, 0.85)) !important;
        color: #ffffff !important;
        border-color: #34d399 !important;
        transform: translateY(-2px) scale(1.01) !important;
        box-shadow: 0 6px 20px rgba(16, 185, 129, 0.45) !important;
    }

    /* form submit buttons use a different testid, so style them too */
    div[data-testid="stFormSubmitButton"] > button {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.5)) !important;
        color: #34d399 !important;
        border: 1px solid rgba(16, 185, 129, 0.6) !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        padding: 0.5rem 1rem !important;
        width: 100% !important;
        transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }

    div[data-testid="stFormSubmitButton"] > button:hover {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.5), rgba(5, 150, 105, 0.85)) !important;
        color: #ffffff !important;
        border-color: #34d399 !important;
        transform: translateY(-2px) !important;
    }

    /* --- APP-LIKE PILL RADIO NAVIGATION MENU (WITH ACTIVE GLOW) --- */
    div[data-testid="stRadio"] {
        background: rgba(30, 41, 59, 0.85) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(52, 211, 153, 0.3);
        border-radius: 16px;
        padding: 8px 12px;
        box-shadow: 0 8px 30px 0 rgba(0, 0, 0, 0.4);
    }

    div[data-testid="stRadio"] > div {
        flex-direction: row !important;
        gap: 6px !important;
        flex-wrap: wrap !important;
    }

    div[data-testid="stRadio"] label {
        background: rgba(15, 23, 42, 0.8) !important;
        border: 1px solid rgba(52, 211, 153, 0.35) !important;
        border-radius: 20px !important;
        padding: 6px 16px !important;
        color: #f8fafc !important;
        font-weight: 600 !important;
        font-size: 12.5px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.25s ease !important;
        cursor: pointer !important;
    }

    div[data-testid="stRadio"] label:hover {
        background: rgba(16, 185, 129, 0.55) !important;
        color: #ffffff !important;
        border-color: #10b981 !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4) !important;
    }

    /* ✅ ACTIVE / SELECTED TAB STATE (ဘယ် tab မှာရှိမှန်း မြင်ရအောင်) */
    div[data-testid="stRadio"] label:has(input:checked) {
        background: #10b981 !important;
        color: #ffffff !important;
        border-color: #6ee7b7 !important;
        box-shadow: 0 0 14px rgba(16, 185, 129, 0.65) !important;
        transform: translateY(-1px);
    }

    div[data-testid="stRadio"] label:has(input:checked) * {
        color: #ffffff !important;
    }

    div[data-testid="stRadio"] input[type="radio"] {
        display: none !important;
    }

    /* --- SIDEBAR & CHAT APP STYLING --- */
    section[data-testid="stSidebar"] {
        background: rgba(11, 19, 43, 0.92) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border-right: 1px solid rgba(52, 211, 153, 0.25) !important;
    }

    section[data-testid="stSidebar"] div[data-testid="stChatMessage"] {
        background: rgba(30, 41, 59, 0.85) !important;
        backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(52, 211, 153, 0.35) !important;
        border-radius: 14px !important;
        padding: 10px !important;
        margin-bottom: 8px !important;
    }

    div[data-testid="stChatInput"] > div {
        background-color: rgba(30, 41, 59, 0.95) !important;
        border: 1px solid rgba(52, 211, 153, 0.5) !important;
        border-radius: 22px !important;
    }

    /* --- ANIMATED ROBOT CSS --- */
    .robot-box {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 22px;
        margin-bottom: 6px;
        min-height: 64px;
    }

    .robot-container {
        position: relative;
        width: 36px;
        height: 40px;
        animation: robotBounce 1.5s infinite ease-in-out;
    }

    .robot-head {
        position: absolute;
        top: 0;
        left: 6px;
        width: 22px;
        height: 16px;
        background: #10b981;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
        animation: robotTilt 2s infinite ease-in-out;
    }

    .robot-head::after {
        content: '';
        position: absolute;
        top: 4px;
        left: 3px;
        width: 16px;
        height: 3px;
        background: #ffffff;
        border-radius: 2px;
    }

    .robot-body {
        position: absolute;
        top: 17px;
        left: 8px;
        width: 18px;
        height: 14px;
        background: #059669;
        border-radius: 4px;
    }

    .robot-arm-left {
        position: absolute;
        top: 18px;
        left: 1px;
        width: 4px;
        height: 10px;
        background: #34d399;
        border-radius: 2px;
        animation: armWaveLeft 1s infinite alternate ease-in-out;
        transform-origin: top center;
    }

    .robot-arm-right {
        position: absolute;
        top: 18px;
        right: 1px;
        width: 4px;
        height: 10px;
        background: #34d399;
        border-radius: 2px;
        animation: armWaveRight 1s infinite alternate ease-in-out;
        transform-origin: top center;
    }

    .robot-leg-left {
        position: absolute;
        bottom: 0;
        left: 10px;
        width: 3px;
        height: 9px;
        background: #10b981;
        border-radius: 2px;
    }

    .robot-leg-right {
        position: absolute;
        bottom: 0;
        right: 10px;
        width: 3px;
        height: 9px;
        background: #10b981;
        border-radius: 2px;
    }

    @keyframes robotBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
    }

    @keyframes robotTilt {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(5deg); }
    }

    @keyframes armWaveLeft {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(-20deg); }
    }

    @keyframes armWaveRight {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(20deg); }
    }

    /* --- FLUID COLUMNS: wrap when the content area is narrow, not just the window --- */
    div[data-testid="stHorizontalBlock"] {
        flex-wrap: wrap !important;
        gap: 10px !important;
    }

    div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
        min-width: 190px !important;
    }

    /* metric text wraps instead of truncating to "44 D..." */
    div[data-testid="stMetricLabel"],
    div[data-testid="stMetricLabel"] p,
    div[data-testid="stMetricValue"],
    div[data-testid="stMetricDelta"] {
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: clip !important;
        overflow-wrap: break-word;
    }

    div[data-testid="stMetricValue"] {
        font-size: clamp(19px, 2.1vw, 30px) !important;
        line-height: 1.2 !important;
    }

    div[data-testid="stMetricLabel"] p {
        font-size: 12.5px !important;
        line-height: 1.35 !important;
    }

    div[data-testid="stMetricDelta"] {
        font-size: 11.5px !important;
    }

    /* --- MOBILE / NARROW SCREEN ADJUSTMENTS --- */
    @media (max-width: 900px) {
        .block-container {
            padding-left: 0.9rem !important;
            padding-right: 0.9rem !important;
        }

        /* header stacks instead of squeezing */
        .custom-app-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px;
        }
        .main-title { font-size: 17px; line-height: 1.35; }
        .sub-title { font-size: 12px; }

        /* full-width columns on real phones */
        div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"] {
            flex: 1 1 100% !important;
            min-width: 100% !important;
        }
        div[data-testid="stMetric"] { padding: 10px; }

        div[data-testid="stRadio"] { padding: 6px 8px; }
        div[data-testid="stRadio"] label {
            padding: 5px 11px !important;
            font-size: 11.5px !important;
        }

        .custom-section-header { font-size: 16px; }
        .stButton>button { padding: 0.55rem 0.8rem !important; }
    }

    @media (max-width: 480px) {
        .main-title { font-size: 15px; }
    }

    /* --- REDUCED MOTION SUPPORT --- */
    @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
        }
    }

    /* --- STATIC FOOTER STYLING --- */
    .static-footer {
        width: 100%;
        text-align: center;
        color: #94a3b8;
        font-size: 12px;
        padding: 15px 0 10px 0;
        margin-top: 30px;
        border-top: 1px solid rgba(52, 211, 153, 0.2);
    }
</style>
""", unsafe_allow_html=True)

# =========================================================
# SHARED DATA LAYER — LIVE (Open-Meteo) + DEMO FALLBACK
# =========================================================
BASE_TOWNSHIPS = [
    # Approximate township centres (decimal degrees). Township boundaries are irregular,
    # so these are representative points rather than official centroids.
    {"name": "Insein", "coords": [16.8900, 96.1000]},
    {"name": "Mingaladon", "coords": [16.9200, 96.1350]},
    {"name": "Hlegu", "coords": [17.1167, 96.2000]},
    {"name": "Hmawbi", "coords": [17.1167, 96.0667]},
    {"name": "Taikkyi", "coords": [17.3333, 95.9833]},
    {"name": "Htantabin", "coords": [16.9833, 95.9833]},
    {"name": "Shwepyitha", "coords": [16.9333, 96.0833]},
    {"name": "Hlaingtharyar", "coords": [16.8667, 96.0500]},
    {"name": "Kamayut", "coords": [16.8283, 96.1350]},
    {"name": "Hlaing", "coords": [16.8450, 96.1300]},
    {"name": "Mayangon", "coords": [16.8600, 96.1400]},
    {"name": "Bahan", "coords": [16.8000, 96.1550]},
    {"name": "Dagon", "coords": [16.7950, 96.1500]},
    {"name": "Pabedan", "coords": [16.7758, 96.1500]},
    {"name": "Latha", "coords": [16.7750, 96.1450]},
    {"name": "Lanmadaw", "coords": [16.7767, 96.1383]},
    {"name": "Ahlone", "coords": [16.7867, 96.1283]},
    {"name": "Kyeemyindaing", "coords": [16.7950, 96.1200]},
    {"name": "Sanchaung", "coords": [16.8100, 96.1350]},
    {"name": "South Dagon", "coords": [16.8300, 96.2200]},
    {"name": "North Dagon", "coords": [16.8700, 96.2100]},
    {"name": "East Dagon", "coords": [16.8800, 96.2500]},
    {"name": "Dagon Seikkan", "coords": [16.8050, 96.2450]},
    {"name": "Thingangyun", "coords": [16.8200, 96.1900]},
    {"name": "South Okkalapa", "coords": [16.8450, 96.1900]},
    {"name": "North Okkalapa", "coords": [16.8800, 96.1750]},
    {"name": "Tamwe", "coords": [16.8000, 96.1750]},
    {"name": "Mingala Taungnyunt", "coords": [16.7900, 96.1650]},
    {"name": "Pazundaung", "coords": [16.7817, 96.1717]},
    {"name": "Botahtaung", "coords": [16.7767, 96.1717]},
    {"name": "Thanlyin", "coords": [16.7500, 96.2500]},
    {"name": "Kyauktan", "coords": [16.6333, 96.2833]},
    {"name": "Twante", "coords": [16.7000, 95.9333]},
    {"name": "Kyauktada", "coords": [16.7767, 96.1567]},
    {"name": "Seikkan", "coords": [16.7700, 96.1700]},
    {"name": "Dawbon", "coords": [16.7867, 96.1917]},
    {"name": "Thaketa", "coords": [16.7950, 96.2100]},
    {"name": "Yankin", "coords": [16.8250, 96.1650]},
    {"name": "Dala", "coords": [16.7600, 96.1600]},
    {"name": "Seikkyi Kanaungto", "coords": [16.7500, 96.1200]},
    {"name": "Kayan", "coords": [16.8917, 96.5583]},
    {"name": "Thongwa", "coords": [16.7500, 96.5167]},
    {"name": "Kawhmu", "coords": [16.5667, 95.9500]},
    {"name": "Kungyangon", "coords": [16.4333, 96.0167]}
]

# =========================================================
# TOWNSHIP BOUNDARIES — geoBoundaries MMR ADM3 (CC-BY 4.0)
# =========================================================
# Hand-typed coordinates are guesses; real polygons give true centroids and
# let the map shade whole townships instead of dropping pins near them.
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/MMR/ADM3/"
GEOBOUNDARIES_FALLBACK = (
    "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/"
    "releaseData/gbOpen/MMR/ADM3/geoBoundaries-MMR-ADM3_simplified.geojson"
)
BOUNDARY_CACHE = Path("data/yangon_townships.geojson")

# Yangon Region bounding box, used to keep only local townships from the national file
YANGON_BBOX = {"lat_min": 16.10, "lat_max": 17.60, "lon_min": 95.55, "lon_max": 96.85}

# geoBoundaries uses GAD transliterations that differ from the labels in this app
NAME_ALIASES = {
    "hlaingtharyar": ["hlaingtharya", "hlaing tharyar", "hlaingthaya"],
    "southdagon": ["dagonmyothitsouth", "dagonmyothit south", "southdagonmyothit"],
    "northdagon": ["dagonmyothitnorth", "northdagonmyothit"],
    "eastdagon": ["dagonmyothiteast", "eastdagonmyothit"],
    "dagonseikkan": ["dagonmyothitseikkan", "dagonseikkanmyothit"],
    "mingalataungnyunt": ["mingalartaungnyunt", "mingalataungnyunt"],
    "kyeemyindaing": ["kyimyindaing", "kyeemyindine"],
    "seikkyikanaungto": ["seikkyikhanaungto", "seikgyikanaungto"],
    "shwepyitha": ["shwepyithar", "shwepyithit"],
    "hlegu": ["hlegu"],
    "htantabin": ["hteintabin", "htantabin"],
    "kungyangon": ["kungyangon", "kunchangon"],
    "kawhmu": ["kawhmu"],
    "thanlyin": ["thanlyin", "syriam"],
    "mingaladon": ["mingaladon"],
    "seikkan": ["seikkan", "seikkanrail"],
}


def _normalise(name):
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


def _ring_centroid(ring):
    """Area-weighted centroid of one linear ring (lon, lat pairs)."""
    area = cx = cy = 0.0
    n = len(ring)
    for i in range(n - 1):
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
    """Centroid of the largest ring in a Polygon or MultiPolygon."""
    polys = []
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    best_ring, best_span = None, -1
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


@st.cache_data(ttl=604800, show_spinner=False)
def fetch_yangon_boundaries():
    """Download geoBoundaries ADM3 once, keep the Yangon Region subset on disk."""
    if BOUNDARY_CACHE.exists():
        try:
            with open(BOUNDARY_CACHE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    geojson_url = None
    try:
        meta = requests.get(GEOBOUNDARIES_API, timeout=30)
        meta.raise_for_status()
        payload = meta.json()
        if isinstance(payload, list):
            payload = payload[0]
        geojson_url = payload.get("simplifiedGeometryGeoJSON") or payload.get("gjDownloadURL")
    except Exception:
        geojson_url = None

    data = None
    for url in [u for u in (geojson_url, GEOBOUNDARIES_FALLBACK) if u]:
        try:
            resp = requests.get(url, timeout=90)
            resp.raise_for_status()
            data = resp.json()
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
    try:
        BOUNDARY_CACHE.parent.mkdir(exist_ok=True)
        with open(BOUNDARY_CACHE, "w", encoding="utf-8") as f:
            json.dump(subset, f)
    except Exception:
        pass
    return subset


@st.cache_data(ttl=604800, show_spinner=False)
def get_townships():
    """BASE_TOWNSHIPS with real centroids and polygons wherever a match is found.

    Returns: (townships, meta) — meta carries match counts for the UI to report.
    """
    fallback = [dict(t, geometry=None, centroid_source="approximate") for t in BASE_TOWNSHIPS]

    try:
        boundaries = fetch_yangon_boundaries()
    except Exception:
        boundaries = None

    if not boundaries or not boundaries.get("features"):
        return fallback, {"matched": 0, "total": len(BASE_TOWNSHIPS), "source": None}

    index = {}
    for feat in boundaries["features"]:
        raw = feat["properties"].get("shapeName") or feat["properties"].get("shapeISO") or ""
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
                "coords": feat["properties"].get("centroid") or base["coords"],
                "geometry": feat.get("geometry"),
                "official_name": feat["properties"].get("shapeName"),
                "centroid_source": "geoBoundaries",
            })
        else:
            out.append(dict(base, geometry=None, centroid_source="approximate"))

    return out, {"matched": matched, "total": len(BASE_TOWNSHIPS),
                 "source": "geoBoundaries MMR ADM3 (CC-BY 4.0)"}


STATUSES = [
    ("Moderate", 2, "Moderate Trees"),
    ("High", 4, "Planting Needed"),
    ("Very High", 5, "Urgent Planting Needed"),
    ("Low", 1, "Good Condition")
]

ALERT_THRESHOLD_DEFAULT = 34.5
DEFAULT_DATE = pd.to_datetime("2026-07-30").date()

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
LIVE_TTL_SECONDS = 600  # 10 မိနစ်တစ်ခါ ပြန်ဆွဲမည်


def _as_list(payload):
    """Open-Meteo က location တစ်ခုဆို dict, အများဆို list ပြန်ပေးသည်။"""
    return payload if isinstance(payload, list) else [payload]


@st.cache_data(ttl=LIVE_TTL_SECONDS, show_spinner=False)
def fetch_live_conditions():
    """မြို့နယ် ၄၄ ခုလုံးအတွက် လက်ရှိအပူချိန် + AQI ကို HTTP call ၂ ခုနှင့် ဆွဲယူသည်။"""
    townships, _ = get_townships()
    lats = ",".join(f"{t['coords'][0]:.4f}" for t in townships)
    lons = ",".join(f"{t['coords'][1]:.4f}" for t in townships)

    weather = requests.get(WEATHER_URL, params={
        "latitude": lats,
        "longitude": lons,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m",
        "timezone": "Asia/Yangon",
    }, timeout=20)
    weather.raise_for_status()
    weather_rows = _as_list(weather.json())

    air_rows = []
    try:
        air = requests.get(AIR_URL, params={
            "latitude": lats,
            "longitude": lons,
            "current": "us_aqi,pm2_5",
            "timezone": "Asia/Yangon",
        }, timeout=20)
        air.raise_for_status()
        air_rows = _as_list(air.json())
    except Exception:
        air_rows = []

    readings = {}
    for i, t in enumerate(townships):
        cur = weather_rows[i].get("current", {}) if i < len(weather_rows) else {}
        air_cur = air_rows[i].get("current", {}) if i < len(air_rows) else {}
        readings[t["name"]] = {
            "temp": cur.get("temperature_2m"),
            "feels_like": cur.get("apparent_temperature"),
            "humidity": cur.get("relative_humidity_2m"),
            "wind": cur.get("wind_speed_10m"),
            "aqi": air_cur.get("us_aqi"),
            "pm25": air_cur.get("pm2_5"),
            "observed_at": cur.get("time"),
        }
    return readings


def _classify(anomaly):
    """မြို့လယ်ပျမ်းမျှနှင့် ကွာခြားချက်ကို UHI level အဖြစ် ပြောင်းသည်။"""
    if anomaly >= 1.5:
        return "Very High", 5, "Urgent Planting Needed"
    if anomaly >= 0.8:
        return "High", 4, "Planting Needed"
    if anomaly >= 0.3:
        return "Moderate", 3, "Moderate Trees"
    if anomaly >= -0.3:
        return "Moderate", 2, "Moderate Trees"
    return "Low", 1, "Good Condition"


def _attach_clusters(rows):
    coords_list = [r["coords"] for r in rows]
    labels = KMeans(n_clusters=3, random_state=42, n_init=10).fit(coords_list).labels_
    for i, r in enumerate(rows):
        r["cluster_zone"] = f"Cluster Zone {labels[i] + 1}"
    return rows


def build_live_dataset():
    """တကယ့် observation များမှ UHI indicator များ တွက်ချက်သည်။"""
    townships, _ = get_townships()
    readings = fetch_live_conditions()
    temps = [v["temp"] for v in readings.values() if v["temp"] is not None]
    if not temps:
        raise ValueError("No temperature readings returned")
    city_mean = sum(temps) / len(temps)

    rows = []
    for t in townships:
        r = readings.get(t["name"], {})
        temp = r.get("temp")
        if temp is None:
            temp = city_mean
        anomaly = temp - city_mean
        status, uhi_lvl, tree = _classify(anomaly)
        aqi = r.get("aqi")
        aqi_value = int(round(aqi)) if aqi is not None else 0
        vuln = 50 + (anomaly * 18) + ((aqi_value - 50) * 0.30)
        rows.append({
            "name": t["name"],
            "coords": t["coords"],
            "status": status,
            "uhi": f"Level {uhi_lvl}",
            "uhi_val": uhi_lvl,
            "tree_need": tree,
            "vuln_score": round(max(0.0, min(100.0, vuln)), 1),
            "live_temp": round(temp, 1),
            "live_aqi": aqi_value,
            "anomaly": round(anomaly, 2),
            "feels_like": r.get("feels_like"),
            "humidity": r.get("humidity"),
            "observed_at": r.get("observed_at"),
            "geometry": t.get("geometry"),
        })
    return _attach_clusters(rows)


@st.cache_data(show_spinner=False)
def build_demo_dataset(date_key: str):
    """Offline / API မရသည့်အခါသုံးရန် simulated dataset."""
    townships, _ = get_townships()
    rng = random.Random(abs(hash(date_key)) % (10 ** 8))
    rows = []
    for t in townships:
        stat, uhi_lvl, tree = rng.choice(STATUSES)
        rows.append({
            "name": t["name"],
            "coords": t["coords"],
            "status": stat,
            "uhi": f"Level {uhi_lvl}",
            "uhi_val": uhi_lvl,
            "tree_need": tree,
            "vuln_score": round(rng.uniform(30.0, 95.0), 1),
            "live_temp": round(31.0 + (uhi_lvl * 0.8) + rng.uniform(-0.5, 0.5), 1),
            "live_aqi": int(45 + (uhi_lvl * 15) + rng.uniform(-5, 5)),
            "anomaly": None,
            "feels_like": None,
            "humidity": None,
            "observed_at": None,
            "geometry": t.get("geometry"),
        })
    return _attach_clusters(rows)


def get_active_dataset():
    """လက်ရှိရွေးထားသော mode အလိုက် dataset ကို ပြန်ပေးသည်။

    Returns: (rows, meta) — meta ထဲတွင် mode, label, observed_at, error ပါဝင်သည်။
    """
    if st.session_state.get("data_mode", "live") == "live":
        try:
            rows = build_live_dataset()
            stamp = next((r["observed_at"] for r in rows if r.get("observed_at")), None)
            return rows, {"mode": "live", "label": "LIVE · Open-Meteo",
                          "observed_at": stamp, "error": None}
        except Exception as exc:
            rows = build_demo_dataset(str(st.session_state.get("analysis_date", DEFAULT_DATE)))
            return rows, {"mode": "demo", "label": "SIMULATED (live feed unavailable)",
                          "observed_at": None, "error": str(exc)}

    rows = build_demo_dataset(str(st.session_state.get("analysis_date", DEFAULT_DATE)))
    return rows, {"mode": "demo", "label": "SIMULATED DEMO DATA",
                  "observed_at": None, "error": None}


def aqi_label(value):
    if value is None or value <= 0:
        return "No reading"
    if value < 51:
        return "Good"
    if value < 101:
        return "Moderate"
    if value < 151:
        return "Unhealthy (sensitive)"
    return "Unhealthy"


# =========================================================
# LOCAL DATABASE — feedback နှင့် observation history
# =========================================================
DB_PATH = Path("data/uhi.db")


def get_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submitted_at TEXT NOT NULL,
                name TEXT NOT NULL,
                township TEXT,
                intensity INTEGER,
                notes TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recorded_at TEXT NOT NULL,
                township TEXT NOT NULL,
                temp_c REAL,
                aqi INTEGER,
                UNIQUE(recorded_at, township)
            )
        """)


def save_feedback(name, township, intensity, notes):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO feedback (submitted_at, name, township, intensity, notes) VALUES (?,?,?,?,?)",
            (pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"), name, township, intensity, notes)
        )


def load_feedback():
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT submitted_at, name, township, intensity, notes FROM feedback ORDER BY id DESC"
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def log_observations(rows, stamp):
    """နာရီတစ်ခါ live reading များကို မှတ်တမ်းတင်၍ ကိုယ်ပိုင်သမိုင်း တည်ဆောက်သည်။"""
    if not stamp:
        return
    hour_key = str(stamp)[:13]
    try:
        with get_db() as conn:
            conn.executemany(
                "INSERT OR IGNORE INTO observations (recorded_at, township, temp_c, aqi) VALUES (?,?,?,?)",
                [(hour_key, r["name"], r["live_temp"], r["live_aqi"]) for r in rows]
            )
    except Exception:
        pass


def observation_history(limit_hours=168):
    try:
        with get_db() as conn:
            rows = conn.execute("""
                SELECT recorded_at, ROUND(AVG(temp_c), 2) AS avg_temp,
                       ROUND(AVG(aqi), 0) AS avg_aqi, COUNT(*) AS n
                FROM observations GROUP BY recorded_at
                ORDER BY recorded_at DESC LIMIT ?
            """, (limit_hours,)).fetchall()
        return pd.DataFrame([dict(r) for r in rows]).iloc[::-1] if rows else pd.DataFrame()
    except Exception:
        return pd.DataFrame()


# =========================================================
# HISTORICAL CLIMATE — Open-Meteo ERA5 archive (real data)
# =========================================================
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


@st.cache_data(ttl=86400, show_spinner=False)
def fetch_yangon_climate_history(years: int = 15):
    """ရန်ကုန်ဗဟိုအမှတ်၏ ERA5 reanalysis နေ့စဉ်အပူချိန်ကို နှစ်အလိုက် ပျမ်းမျှတွက်သည်။"""
    end = pd.Timestamp.utcnow().normalize() - pd.Timedelta(days=6)  # archive lag
    start = pd.Timestamp(year=end.year - years, month=1, day=1)

    resp = requests.get(ARCHIVE_URL, params={
        "latitude": 16.8409, "longitude": 96.1735,
        "start_date": start.strftime("%Y-%m-%d"),
        "end_date": end.strftime("%Y-%m-%d"),
        "daily": "temperature_2m_mean,temperature_2m_max",
        "timezone": "Asia/Yangon",
    }, timeout=30)
    resp.raise_for_status()
    daily = resp.json().get("daily", {})

    df = pd.DataFrame({
        "date": pd.to_datetime(daily.get("time", [])),
        "mean_temp": daily.get("temperature_2m_mean", []),
        "max_temp": daily.get("temperature_2m_max", []),
    }).dropna()
    if df.empty:
        return None

    df["year"] = df["date"].dt.year
    yearly = df.groupby("year").agg(
        avg_temp=("mean_temp", "mean"),
        avg_daily_max=("max_temp", "mean"),
        hot_days=("max_temp", lambda s: int((s >= 38).sum())),
    ).round(2).reset_index()

    monthly = (df[df["year"] >= df["year"].max() - 1]
               .assign(month=lambda d: d["date"].dt.to_period("M").astype(str))
               .groupby("month")["mean_temp"].mean().round(2).reset_index())

    return {"yearly": yearly, "monthly": monthly,
            "range": f"{df['date'].min():%Y-%m-%d} → {df['date'].max():%Y-%m-%d}"}


# =========================================================
# GOOGLE EARTH ENGINE — SATELLITE LAYERS (LST + NDVI)
# =========================================================
GEE_KEY_PATH = ".streamlit/gee-key.json"
YANGON_BOUNDS = [[16.30, 95.70], [17.40, 96.60]]  # [[south, west], [north, east]]


@st.cache_resource(show_spinner=False)
def init_earth_engine():
    """Service account နှင့် Earth Engine ကို initialise လုပ်သည်။

    Returns: (ok: bool, message: str)
    """
    if not EE_AVAILABLE:
        return False, "earthengine-api package မတွေ့ပါ (pip install earthengine-api)"

    project_id = None
    try:
        project_id = st.secrets.get("GEE_PROJECT")
    except Exception:
        pass
    project_id = project_id or os.environ.get("GEE_PROJECT")

    key_path = None
    try:
        key_path = st.secrets.get("GEE_KEY_PATH")
    except Exception:
        pass
    key_path = key_path or os.environ.get("GEE_KEY_PATH") or GEE_KEY_PATH

    if not os.path.exists(key_path):
        return False, f"Service account key မတွေ့ပါ ({key_path})"

    try:
        with open(key_path, "r", encoding="utf-8") as f:
            key_info = json.load(f)
        service_email = key_info.get("client_email")
        project_id = project_id or key_info.get("project_id")

        credentials = ee.ServiceAccountCredentials(service_email, key_path)
        ee.Initialize(credentials, project=project_id)
        return True, f"Connected as {service_email}"
    except Exception as exc:
        return False, str(exc)


def _mask_landsat_clouds(img):
    """QA_PIXEL bits: 1=dilated cloud, 2=cirrus, 3=cloud, 4=cloud shadow.

    တိမ်ကို ဖယ်မထုတ်ရင် တိမ်ထိပ်အအေး (−30 °C မျိုး) က LST အဖြစ် ဝင်လာသည်။
    """
    qa = img.select("QA_PIXEL")
    mask = (qa.bitwiseAnd(1 << 1).eq(0)
            .And(qa.bitwiseAnd(1 << 2).eq(0))
            .And(qa.bitwiseAnd(1 << 3).eq(0))
            .And(qa.bitwiseAnd(1 << 4).eq(0)))
    return img.updateMask(mask)


def _landsat_to_celsius(img):
    """ST_B10 → °C, ပြီးလျှင် ဖြစ်နိုင်ခြေရှိသော အကွာအဝေးသို့ ကန့်သတ်သည်။"""
    lst = img.select("ST_B10").multiply(0.00341802).add(149.0).subtract(273.15)
    return (lst.updateMask(lst.gt(5).And(lst.lt(65)))
            .rename("LST").copyProperties(img, ["system:time_start"]))


@st.cache_data(ttl=3600, show_spinner=False)
def get_landsat_lst_layer(days_back: int = 60):
    """Landsat 8/9 Collection 2 မှ Land Surface Temperature (°C) tile URL ကို ပြန်ပေးသည်။"""
    region = ee.Geometry.Rectangle([
        YANGON_BOUNDS[0][1], YANGON_BOUNDS[0][0],
        YANGON_BOUNDS[1][1], YANGON_BOUNDS[1][0]
    ])
    end = ee.Date(pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
    start = end.advance(-days_back, "day")

    collection = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterBounds(region)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUD_COVER", 80))
    )

    count = collection.size().getInfo()
    if count == 0:
        return None

    composite = (collection.map(_mask_landsat_clouds)
                 .map(_landsat_to_celsius).median().clip(region))
    stats = composite.reduceRegion(
        reducer=ee.Reducer.percentile([2, 98]),
        geometry=region, scale=200, maxPixels=1e9, bestEffort=True
    ).getInfo()

    low = stats.get("LST_p2")
    high = stats.get("LST_p98")
    if low is None or high is None:
        return None
    low = max(15.0, low)
    high = min(60.0, high)
    if high - low < 3:
        high = low + 3
    vis = {"min": low, "max": high,
           "palette": ["040274", "3ff38f", "fff705", "ff8b13", "cf1750", "911003"]}

    scenes = collection.aggregate_array("system:time_start").getInfo()
    latest = pd.to_datetime(max(scenes), unit="ms").strftime("%Y-%m-%d") if scenes else None

    return {
        "tile_url": composite.getMapId(vis)["tile_fetcher"].url_format,
        "scenes": count,
        "latest": latest,
        "min": round(low, 1),
        "max": round(high, 1),
    }


@st.cache_data(ttl=3600, show_spinner=False)
def get_ndvi_layer(days_back: int = 120):
    """Sentinel-2 မှ NDVI (သစ်ပင်ဖုံးလွှမ်းမှု) tile URL ကို ပြန်ပေးသည်။"""
    region = ee.Geometry.Rectangle([
        YANGON_BOUNDS[0][1], YANGON_BOUNDS[0][0],
        YANGON_BOUNDS[1][1], YANGON_BOUNDS[1][0]
    ])
    end = ee.Date(pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
    start = end.advance(-days_back, "day")

    def mask_s2(img):
        # SCL: 3=cloud shadow, 8/9=cloud medium/high, 10=cirrus, 11=snow
        scl = img.select("SCL")
        keep = (scl.neq(3).And(scl.neq(8)).And(scl.neq(9))
                .And(scl.neq(10)).And(scl.neq(11)))
        return img.updateMask(keep)

    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(region)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 70))
    )

    count = collection.size().getInfo()
    if count == 0:
        return None

    ndvi = (collection.map(mask_s2).median()
            .normalizedDifference(["B8", "B4"]).rename("NDVI").clip(region))
    vis = {"min": 0.0, "max": 0.8,
           "palette": ["a52a2a", "d9c27b", "ffffcc", "9ccb6b", "3d8f3d", "134d13"]}

    return {
        "tile_url": ndvi.getMapId(vis)["tile_fetcher"].url_format,
        "scenes": count,
    }


@st.cache_data(ttl=3600, show_spinner=False)
def sample_lst_by_township(days_back: int = 60):
    """မြို့နယ်တစ်ခုချင်းစီရဲ့ satellite LST တန်ဖိုးကို ထုတ်ယူသည်။"""
    region = ee.Geometry.Rectangle([
        YANGON_BOUNDS[0][1], YANGON_BOUNDS[0][0],
        YANGON_BOUNDS[1][1], YANGON_BOUNDS[1][0]
    ])
    end = ee.Date(pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
    start = end.advance(-days_back, "day")

    collection = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterBounds(region).filterDate(start, end)
        .filter(ee.Filter.lt("CLOUD_COVER", 80))
    )
    if collection.size().getInfo() == 0:
        return {}

    composite = collection.map(_mask_landsat_clouds).map(_landsat_to_celsius).median()
    townships, _ = get_townships()
    features = []
    for t in townships:
        if t.get("geometry"):
            # whole-township average is far better than a single point
            geom = ee.Geometry(t["geometry"])
        else:
            geom = ee.Geometry.Point([t["coords"][1], t["coords"][0]]).buffer(1500)
        features.append(ee.Feature(geom, {"name": t["name"]}))

    sampled = composite.reduceRegions(
        collection=ee.FeatureCollection(features), reducer=ee.Reducer.mean(), scale=100
    ).getInfo()

    out = {}
    for feat in sampled.get("features", []):
        props = feat.get("properties", {})
        if props.get("mean") is not None:
            out[props["name"]] = round(props["mean"], 1)
    return out


def get_groq_api_key():
    """.streamlit/secrets.toml ကို ဦးစားပေးဖတ်၊ မရှိရင် environment variable သုံးမည်။"""
    try:
        if "GROQ_API_KEY" in st.secrets:
            return st.secrets["GROQ_API_KEY"]
    except Exception:
        pass
    return os.environ.get("GROQ_API_KEY", "")


GROQ_API_KEY = get_groq_api_key()

client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=GROQ_API_KEY or "missing-key"
)

if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "analysis_date" not in st.session_state:
    st.session_state.analysis_date = DEFAULT_DATE
if "data_mode" not in st.session_state:
    st.session_state.data_mode = "live"
init_db()
if "feedback_records" not in st.session_state:
    st.session_state.feedback_records = load_feedback()
if "intro_done" not in st.session_state:
    st.session_state.intro_done = False
if "show_lst" not in st.session_state:
    st.session_state.show_lst = False
if "show_ndvi" not in st.session_state:
    st.session_state.show_ndvi = False

# Sidebar AI Assistant with ANIMATED Robot & Lottie Graphic
st.sidebar.markdown("""
<div class="robot-box">
    <div class="robot-container">
        <div class="robot-head"></div>
        <div class="robot-body"></div>
        <div class="robot-arm-left"></div>
        <div class="robot-arm-right"></div>
        <div class="robot-leg-left"></div>
        <div class="robot-leg-right"></div>
    </div>
    <h3 style="margin: 0; color: #34d399; font-size: 16px;">AI Eco Assistant</h3>
</div>
""", unsafe_allow_html=True)

if lottie_eco:
    st_lottie(lottie_eco, height=80, key="eco_anim")

st.sidebar.markdown("Ask any climate or app questions freely!")
speak_replies = st.sidebar.toggle("Read replies aloud", value=False,
                                  help="Generating speech adds a few seconds to each reply.")

if not GROQ_API_KEY:
    st.sidebar.warning("API key မတွေ့ပါ။ `.streamlit/secrets.toml` ထဲမှာ `GROQ_API_KEY = \"...\"` ထည့်ပါ။")

for message in st.session_state.chat_history:
    with st.sidebar.chat_message(message["role"]):
        st.markdown(message["content"])
        if "audio" in message and message["role"] == "assistant" and message["audio"]:
            try:
                st.sidebar.audio(message["audio"], format="audio/mp3")
            except:
                pass

st.sidebar.markdown("---")
chat_submission = st.sidebar.chat_input("Ask anything...", accept_audio=True)

user_query = None
audio_file_obj = None

if chat_submission:
    if isinstance(chat_submission, str):
        user_query = chat_submission
    else:
        user_query = chat_submission.get("text", "")
        audio_file_obj = chat_submission.get("audio", None)

if audio_file_obj and not user_query:
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_audio:
            tmp_audio.write(audio_file_obj.read())
            tmp_audio_path = tmp_audio.name

        with open(tmp_audio_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file
            )
            user_query = transcript.text
        os.unlink(tmp_audio_path)
    except Exception as e:
        user_query = f"[Audio Transcription Error: {e}]"

if user_query:
    st.session_state.chat_history.append({"role": "user", "content": user_query})
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a helpful and versatile AI assistant specialized in urban climate intelligence."},
                {"role": "user", "content": user_query}
            ],
            temperature=0.7,
        )
        ai_reply = response.choices[0].message.content

        audio_response_path = None
        if speak_replies:
            try:
                tts_lang = 'my' if any("\u1000" <= c <= "\u109F" for c in ai_reply) else 'en'
                tts = gTTS(text=ai_reply, lang=tts_lang, slow=False)
                audio_response_path = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3").name
                tts.save(audio_response_path)
                # keep only the newest few clips so the temp folder does not grow forever
                previous = [m.get("audio") for m in st.session_state.chat_history
                            if m.get("audio")]
                for stale in previous[:-3]:
                    try:
                        os.unlink(stale)
                    except OSError:
                        pass
            except Exception:
                audio_response_path = None

        st.session_state.chat_history.append({
            "role": "assistant",
            "content": ai_reply,
            "audio": audio_response_path
        })
    except Exception as e:
        st.session_state.chat_history.append({"role": "assistant", "content": f"Error: {e}"})
    st.rerun()

# --- DATA SOURCE RESOLUTION (header နှင့် metric များ တစ်ထပ်တည်းဖြစ်စေရန်) ---
active_rows, data_meta = get_active_dataset()
is_live = data_meta["mode"] == "live"
badge_class = "live-badge" if is_live else "demo-badge"
badge_text = "🟢 LIVE · OPEN-METEO" if is_live else f"⚠ {data_meta['label']}"

# --- COMPACT SLEEK TOP BRANDING / HEADER CONTAINER ---
st.markdown(f"""
<div class="custom-app-header">
    <div>
        <p class="main-title">🏙️ Yangon Urban Heat Island & Environmental Intelligence</p>
        <p class="sub-title">Advanced Spatial Analysis, Climate Modeling & Municipal Decision Support Dashboard</p>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
        <span class="{badge_class}">{badge_text}</span>
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(52, 211, 153, 0.4); padding: 6px 12px; border-radius: 10px; text-align: center;">
            <span style="font-size: 12px; color: #34d399; font-weight: bold;">🌱 SYSTEM v2.5</span>
        </div>
    </div>
</div>
""", unsafe_allow_html=True)

# --- DATA SOURCE CONTROLS ---
src_col, refresh_col = st.columns([4, 1])
with src_col:
    mode_choice = st.radio(
        "Data source",
        ["🛰 Live readings (Open-Meteo)", "🧪 Demo simulation"],
        index=0 if st.session_state.data_mode == "live" else 1,
        horizontal=True,
        key="data_mode_picker",
        label_visibility="collapsed",
    )
    new_mode = "live" if mode_choice.startswith("🛰") else "demo"
    if new_mode != st.session_state.data_mode:
        st.session_state.data_mode = new_mode
        st.rerun()
with refresh_col:
    if st.button("🔄 Refresh now"):
        fetch_live_conditions.clear()
        st.rerun()

if data_meta["error"]:
    st.warning(f"Live feed unreachable — showing simulated data instead. ({data_meta['error'][:120]})")

ee_ready, ee_message = init_earth_engine()

if is_live:
    log_observations(active_rows, data_meta.get("observed_at"))

# --- QUICK SUMMARY METRICS CARDS (LIVE - dataset နဲ့ တိုက်ရိုက်ချိတ်ထား) ---
summary_df = pd.DataFrame(active_rows)

avg_temp = round(summary_df["live_temp"].mean(), 1)
aqi_series = summary_df.loc[summary_df["live_aqi"] > 0, "live_aqi"]
avg_aqi = int(round(aqi_series.mean())) if not aqi_series.empty else 0
alert_count = int((summary_df["live_temp"] >= ALERT_THRESHOLD_DEFAULT).sum())
hottest = summary_df.loc[summary_df["live_temp"].idxmax()]
coolest = summary_df.loc[summary_df["live_temp"].idxmin()]
spread = round(hottest["live_temp"] - coolest["live_temp"], 1)

q_col1, q_col2, q_col3, q_col4 = st.columns(4)
with q_col1:
    st.metric(label="Townships monitored", value=f"{len(summary_df)}", delta="Full coverage")
with q_col2:
    st.metric(label="Average temperature", value=f"{avg_temp} °C",
              delta=f"{spread} °C spread across city")
with q_col3:
    st.metric(label="Air quality (US AQI)", value=f"{avg_aqi}" if avg_aqi else "—",
              delta=aqi_label(avg_aqi))
with q_col4:
    st.metric(label=f"Heat alerts ≥{ALERT_THRESHOLD_DEFAULT} °C", value=f"{alert_count}",
              delta=f"Hottest: {hottest['name']}", delta_color="inverse")

if is_live:
    stamp = data_meta.get("observed_at") or "just now"
    st.caption(f"📡 Live observations from Open-Meteo · station time {stamp} (Asia/Yangon) · auto-refresh every 10 minutes · UHI level = each township's temperature anomaly vs the city average.")
else:
    st.caption(f"🧪 Simulated scenario for **{st.session_state.analysis_date}** — not live telemetry.")

st.markdown("<br>", unsafe_allow_html=True)

# Navigation Menu using Horizontal Pill Radio Buttons
menu_options = [
    "🗺 Spatial Analytics",
    "⚖️ Comparison",
    "🌳 Greening UHI",
    "📉 Climate Trends",
    "🚨 Alerts",
    "🏥 Public Health",
    "👥 Feedback"
]

selected_menu = st.radio("Main navigation", menu_options, horizontal=True, label_visibility="collapsed")
st.markdown("<br>", unsafe_allow_html=True)

if selected_menu == "🗺 Spatial Analytics":
    if is_live:
        st.info("Live mode is showing current readings for all 44 townships. Switch to demo simulation above if you want to explore a modelled date scenario.")
        run_clicked = st.button("🚀 Run Spatial Intelligence Engine")
    else:
        date_col, run_col = st.columns([3, 1])
        with date_col:
            selected_date = st.date_input("📅 Select Date for Spatial Analysis", value=st.session_state.analysis_date)
        with run_col:
            st.markdown("<div style='height: 28px;'></div>", unsafe_allow_html=True)
            run_clicked = st.button("🚀 Run Spatial Intelligence Engine")
        if selected_date != st.session_state.analysis_date and run_clicked:
            st.session_state.analysis_date = selected_date

    if "searched" not in st.session_state:
        st.session_state.searched = False

    if run_clicked:
        if not st.session_state.intro_done:
            if lottie_loading:
                with st.container():
                    st_lottie(lottie_loading, height=100, key="loading_anim")

            with st.spinner("Executing advanced spatial computing algorithms..."):
                progress_bar = st.progress(0)
                status_text = st.empty()

                status_text.text("🛰 Loading Sentinel-3 & Landsat sample scenes...")
                progress_bar.progress(25)
                time.sleep(0.3)

                status_text.text("🌡 Computing Land Surface Temperature (LST) & UHI Indices...")
                progress_bar.progress(50)
                time.sleep(0.3)

                status_text.text("🤖 Running Machine Learning K-Means Clustering...")
                progress_bar.progress(75)
                time.sleep(0.3)

                status_text.text("✅ Spatial Intelligence Engine Successfully Executed!")
                progress_bar.progress(100)
                time.sleep(0.2)

                status_text.empty()
                progress_bar.empty()
            st.session_state.intro_done = True
        else:
            with st.spinner("Recomputing UHI indices & clusters..."):
                time.sleep(0.2)

        st.session_state.searched = True

    if st.session_state.searched:
        if is_live:
            st.success(f"Spatial algorithms executed on live readings ({len(active_rows)} townships).")
        else:
            st.success(f"Spatial algorithms executed for scenario date: {st.session_state.analysis_date}")

        townships_data = active_rows

        # --- FILTERS MOVED ABOVE THE MAP (တွေ့ရလွယ်စေရန်) ---
        st.markdown('<p class="custom-section-header">🎛 Map Filter Controls</p>', unsafe_allow_html=True)
        f_col1, f_col2 = st.columns(2)
        with f_col1:
            selected_status = st.selectbox("Filter by Status", ["All", "Moderate", "High", "Very High", "Low"])
        with f_col2:
            selected_cluster = st.selectbox("Filter by Cluster Zone", ["All", "Cluster Zone 1", "Cluster Zone 2", "Cluster Zone 3"])

        filtered_data = townships_data
        if selected_status != "All":
            filtered_data = [t for t in filtered_data if t["status"] == selected_status]
        if selected_cluster != "All":
            filtered_data = [t for t in filtered_data if t["cluster_zone"] == selected_cluster]

        st.markdown('<p class="custom-section-header">🛰 Satellite Layers (Google Earth Engine)</p>', unsafe_allow_html=True)
        if ee_ready:
            s_col1, s_col2 = st.columns(2)
            with s_col1:
                st.session_state.show_lst = st.checkbox(
                    "🌡 Land Surface Temperature — Landsat 8/9",
                    value=st.session_state.show_lst)
            with s_col2:
                st.session_state.show_ndvi = st.checkbox(
                    "🌿 Vegetation cover (NDVI) — Sentinel-2",
                    value=st.session_state.show_ndvi)
            st.caption("Satellite passes are every 8–16 days and monsoon cloud blocks many scenes, so these layers show a cloud-filtered median composite of recent passes — not the current moment.")
        else:
            st.info(f"Satellite layers unavailable — {ee_message}")

        st.markdown('<p class="custom-section-header">🗺 Interactive Spatial Map</p>', unsafe_allow_html=True)

        _, boundary_meta = get_townships()
        if boundary_meta.get("source"):
            st.caption(f"🗺 Township outlines: {boundary_meta['matched']} of {boundary_meta['total']} matched to {boundary_meta['source']}. Unmatched townships fall back to an approximate point.")
        else:
            st.caption("🗺 Township outlines unavailable — using approximate centre points. Check the network connection and reload to fetch the boundary file.")

        if not filtered_data:
            st.warning("No townships match the selected filters. Try widening the filter.")
        else:
            m = folium.Map(location=[16.8409, 96.1735], zoom_start=11, tiles="OpenStreetMap")

            shaded = [t for t in filtered_data if t.get("geometry")]
            if shaded:
                temps = [t["live_temp"] for t in shaded]
                t_lo, t_hi = min(temps), max(temps)
                span = max(t_hi - t_lo, 0.1)

                def temp_fill(temp):
                    frac = (temp - t_lo) / span
                    ramp = ["#1e3a8a", "#0891b2", "#22c55e", "#facc15", "#f97316", "#dc2626"]
                    return ramp[min(int(frac * len(ramp)), len(ramp) - 1)]

                boundary_group = folium.FeatureGroup(name="Township boundaries", show=True)
                for tw in shaded:
                    folium.GeoJson(
                        {"type": "Feature", "geometry": tw["geometry"], "properties": {}},
                        style_function=lambda _f, c=temp_fill(tw["live_temp"]): {
                            "fillColor": c, "color": "#e2e8f0",
                            "weight": 1, "fillOpacity": 0.45,
                        },
                        highlight_function=lambda _f: {"weight": 3, "color": "#ffffff"},
                        tooltip=f"{tw['name']} — {tw['live_temp']} °C ({tw['uhi']})",
                    ).add_to(boundary_group)
                boundary_group.add_to(m)

            heat_data = []
            for tw in filtered_data:
                # colour AND icon shape both encode level, so the map stays readable
                # for anyone who cannot distinguish red from green
                if tw["uhi_val"] >= 4:
                    marker_color, marker_icon = "red", "fire"
                elif tw["uhi_val"] in (2, 3):
                    marker_color, marker_icon = "orange", "exclamation-sign"
                else:
                    marker_color, marker_icon = "green", "leaf"

                heat_data.append([tw["coords"][0], tw["coords"][1], tw["uhi_val"] * 0.25])

                extra = ""
                if tw.get("anomaly") is not None:
                    extra += f"<b>Anomaly vs city avg:</b> {tw['anomaly']:+} °C<br>"
                if tw.get("feels_like") is not None:
                    extra += f"<b>Feels like:</b> {tw['feels_like']} °C<br>"
                if tw.get("humidity") is not None:
                    extra += f"<b>Humidity:</b> {tw['humidity']}%<br>"

                popup_content = f"""
                <b>Township:</b> {tw['name']}<br>
                <b>Temp:</b> {tw['live_temp']} °C<br>
                {extra}
                <b>AQI:</b> {tw['live_aqi'] if tw['live_aqi'] else 'n/a'}<br>
                <b>UHI:</b> {tw['uhi']}<br>
                <b>Vuln Score:</b> {tw['vuln_score']}
                """

                folium.Marker(
                    location=tw["coords"],
                    popup=folium.Popup(popup_content, max_width=250),
                    tooltip=f"{tw['name']} — {tw['live_temp']} °C ({tw['uhi']})",
                    icon=folium.Icon(color=marker_color, icon=marker_icon)
                ).add_to(m)

            if ee_ready and st.session_state.show_lst:
                with st.spinner("Fetching Landsat surface temperature composite..."):
                    try:
                        lst = get_landsat_lst_layer()
                    except Exception as exc:
                        lst = None
                        st.warning(f"LST layer failed: {str(exc)[:150]}")
                if lst:
                    folium.TileLayer(
                        tiles=lst["tile_url"], attr="Google Earth Engine / USGS Landsat",
                        name=f"LST {lst['min']}–{lst['max']} °C", overlay=True, opacity=0.65
                    ).add_to(m)
                    st.caption(f"🌡 LST composite from {lst['scenes']} scenes · latest pass {lst['latest']} · range {lst['min']}–{lst['max']} °C (blue = cool, red = hot)")
                else:
                    st.warning("No cloud-free Landsat scenes over Yangon in the last 60 days — try again after the monsoon eases.")

            if ee_ready and st.session_state.show_ndvi:
                with st.spinner("Fetching Sentinel-2 vegetation composite..."):
                    try:
                        ndvi = get_ndvi_layer()
                    except Exception as exc:
                        ndvi = None
                        st.warning(f"NDVI layer failed: {str(exc)[:150]}")
                if ndvi:
                    folium.TileLayer(
                        tiles=ndvi["tile_url"], attr="Google Earth Engine / Copernicus Sentinel-2",
                        name="NDVI", overlay=True, opacity=0.60
                    ).add_to(m)
                    st.caption(f"🌿 NDVI composite from {ndvi['scenes']} Sentinel-2 scenes (brown = bare, green = dense vegetation)")
                else:
                    st.warning("No suitable Sentinel-2 scenes found for the NDVI layer.")

            HeatMap(heat_data, radius=18, name="UHI intensity (modelled)").add_to(m)
            if ee_ready and (st.session_state.show_lst or st.session_state.show_ndvi):
                folium.LayerControl(collapsed=False).add_to(m)
            st_folium(m, use_container_width=True, height=440)

            st.markdown(
                """
                <div style="display:flex; gap:18px; flex-wrap:wrap; font-size:12.5px;
                            color:#cbd5e1; margin:-4px 0 6px 2px;">
                    <span>🔥 <b>Level 4–5</b> — well above the city average</span>
                    <span>❗ <b>Level 2–3</b> — near the city average</span>
                    <span>🍃 <b>Level 1</b> — cooler than the city average</span>
                    <span>▦ <b>Shaded areas</b> — township outlines, filled by temperature (blue coolest → red hottest)</span>
                </div>
                """, unsafe_allow_html=True)

            st.markdown("---")
            st.markdown(f'<p class="custom-section-header">📊 Municipal Analytics Table (Showing {len(filtered_data)} Townships)</p>', unsafe_allow_html=True)

            table_rows = [dict(r) for r in filtered_data]
            if ee_ready and st.session_state.show_lst:
                try:
                    sat_lst = sample_lst_by_township()
                    for r in table_rows:
                        r["sat_lst"] = sat_lst.get(r["name"])
                except Exception:
                    pass

            df = pd.DataFrame(table_rows)
            df = df.drop(columns=[c for c in ["coords", "uhi_val", "observed_at",
                                              "feels_like", "humidity", "geometry"]
                                  if c in df.columns])
            if "sat_lst" in df.columns and df["sat_lst"].isna().all():
                df = df.drop(columns=["sat_lst"])
            if df["anomaly"].isna().all():
                df = df.drop(columns=["anomaly"])
            df = df.rename(columns={
                "name": "Township Name",
                "status": "Temperature Status",
                "uhi": "UHI Impact Level",
                "tree_need": "Tree Planting Requirement",
                "vuln_score": "Vulnerability Score",
                "cluster_zone": "Cluster Zone",
                "live_temp": "Temp (°C)",
                "live_aqi": "Air Quality (AQI)",
                "anomaly": "Anomaly vs Avg (°C)",
                "sat_lst": "Satellite LST (°C)"
            })
            st.dataframe(df, use_container_width=True)

            col_dl1, col_dl2 = st.columns(2)
            with col_dl1:
                csv = df.to_csv(index=False).encode('utf-8')
                st.download_button(
                    label="📥 Export Report as CSV",
                    data=csv,
                    file_name=f"yangon_uhi_report_{'live' if is_live else st.session_state.analysis_date}.csv",
                    mime='text/csv',
                )
            with col_dl2:
                def resolve_unicode_font(pdf):
                    """DejaVu ရှိရင် Unicode (°C, မြန်မာစာ) ရအောင်၊ မရှိရင် Arial fallback."""
                    candidates = [
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
                        "/Library/Fonts/DejaVuSans.ttf",
                        "C:/Windows/Fonts/DejaVuSans.ttf",
                        "DejaVuSans.ttf",
                    ]
                    for path in candidates:
                        if os.path.exists(path):
                            try:
                                pdf.add_font("DejaVu", "", path, uni=True)
                                bold = path.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")
                                if os.path.exists(bold):
                                    pdf.add_font("DejaVu", "B", bold, uni=True)
                                return "DejaVu"
                            except Exception:
                                continue
                    return "Arial"

                def safe_text(value, font_name):
                    text = str(value)
                    if font_name == "Arial":
                        return text.encode("latin-1", "ignore").decode("latin-1")
                    return text

                def generate_pdf():
                    pdf = FPDF()
                    pdf.add_page()
                    font = resolve_unicode_font(pdf)

                    pdf.set_font(font, "B", 14)
                    pdf.cell(0, 8, safe_text("Yangon Urban Heat Island Executive Report", font), 0, 1, "C")
                    pdf.set_font(font, "", 9)
                    if is_live:
                        pdf.cell(0, 5, safe_text(f"Live readings via Open-Meteo - generated {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}", font), 0, 1, "C")
                    else:
                        pdf.cell(0, 5, safe_text(f"Simulated scenario date: {st.session_state.analysis_date}", font), 0, 1, "C")
                    pdf.ln(5)

                    pdf.set_font(font, "B", 10)
                    pdf.cell(0, 6, safe_text("Complete Township Analytics Table:", font), 0, 1)
                    pdf.set_font(font, "", 7)

                    headers = [
                        ("Township Name", 35), ("Status", 25), ("UHI Level", 20),
                        ("Temp (°C)", 25), ("AQI", 20), ("Vuln Score", 30)
                    ]
                    for title, width in headers:
                        pdf.cell(width, 6, safe_text(title, font), 1)
                    pdf.ln()

                    for _, row in df.iterrows():
                        pdf.cell(35, 5, safe_text(row['Township Name'], font), 1)
                        pdf.cell(25, 5, safe_text(row['Temperature Status'], font), 1)
                        pdf.cell(20, 5, safe_text(row['UHI Impact Level'], font), 1)
                        pdf.cell(25, 5, safe_text(row['Temp (°C)'], font), 1)
                        pdf.cell(20, 5, safe_text(row['Air Quality (AQI)'], font), 1)
                        pdf.cell(30, 5, safe_text(row['Vulnerability Score'], font), 1)
                        pdf.ln()

                    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
                    pdf.output(tmp_file.name)
                    return tmp_file.name

                if st.button("📄 Generate Comprehensive Executive PDF Report"):
                    pdf_path = generate_pdf()
                    with open(pdf_path, "rb") as pdf_file:
                        st.download_button(
                            label="📥 Download Official PDF Report",
                            data=pdf_file,
                            file_name=f"Yangon_UHI_Executive_Report_{st.session_state.analysis_date}.pdf",
                            mime="application/pdf"
                        )

    else:
        st.info("Please select a date and click the 'Run Spatial Intelligence Engine' button to load the system dashboard.")

elif selected_menu == "⚖️ Comparison":
    st.markdown('<p class="custom-section-header">⚖️ Township Side-by-Side Comparison Tool</p>', unsafe_allow_html=True)

    comparison_source = active_rows
    t_names = sorted([t["name"] for t in comparison_source])

    c1, c2 = st.columns(2)
    t1 = c1.selectbox("Township A", t_names, index=0)
    t2 = c2.selectbox("Township B", t_names, index=min(1, len(t_names) - 1))

    d1 = next(x for x in comparison_source if x["name"] == t1)
    d2 = next(x for x in comparison_source if x["name"] == t2)

    col1, col2 = st.columns(2)
    with col1:
        st.info(f"**{d1['name']}**\n\n🌡️ Temp: {d1['live_temp']} °C\n\n💨 AQI: {d1['live_aqi']} ({aqi_label(d1['live_aqi'])})\n\n🔥 UHI: {d1['uhi']}\n\n📊 Vulnerability: {d1['vuln_score']}")
    with col2:
        st.info(f"**{d2['name']}**\n\n🌡️ Temp: {d2['live_temp']} °C\n\n💨 AQI: {d2['live_aqi']} ({aqi_label(d2['live_aqi'])})\n\n🔥 UHI: {d2['uhi']}\n\n📊 Vulnerability: {d2['vuln_score']}")

    diff = round(d1["live_temp"] - d2["live_temp"], 1)
    if d1["name"] != d2["name"]:
        hotter = d1["name"] if diff > 0 else d2["name"]
        st.markdown(f"**Difference:** {hotter} is {abs(diff)} °C hotter · AQI gap {abs(d1['live_aqi'] - d2['live_aqi'])} points")

elif selected_menu == "🌳 Greening UHI":
    st.markdown('<p class="custom-section-header">🌳 Smart Tree Planting Simulator</p>', unsafe_allow_html=True)

    greening_source = active_rows
    sim_t = st.selectbox("Select Township", sorted([t["name"] for t in greening_source]), key="sim_t_box")
    add_trees = st.slider("Additional Tree Cover (%)", 5, 50, 20)

    if st.button("Estimate cooling effect"):
        base = next(x for x in greening_source if x["name"] == sim_t)
        # Published daytime air-temperature cooling per 1% canopy gain spans roughly
        # 0.02–0.15 °C across cities and seasons, so show the band, not one number.
        low = round(add_trees * 0.02, 2)
        mid = round(add_trees * 0.06, 2)
        high = round(add_trees * 0.15, 2)

        st.markdown(f"#### {sim_t} — adding {add_trees}% canopy")
        g1, g2, g3 = st.columns(3)
        with g1:
            st.metric("Conservative", f"−{low} °C", delta=f"{round(base['live_temp'] - low, 2)} °C")
        with g2:
            st.metric("Central estimate", f"−{mid} °C", delta=f"{round(base['live_temp'] - mid, 2)} °C")
        with g3:
            st.metric("Optimistic", f"−{high} °C", delta=f"{round(base['live_temp'] - high, 2)} °C")

        st.info(f"Starting point: {base['live_temp']} °C (current reading for {sim_t}).")
        st.caption(
            "This is a linear approximation, not a microclimate model. Reported daytime cooling from "
            "urban canopy gain ranges from about 0.02 to 0.15 °C per percentage point, depending on "
            "species, canopy density, irrigation, wind corridors and how humid the air already is. "
            "Yangon's monsoon humidity sits at the weaker end of that band. Treat the numbers as a "
            "planning range and validate against local measurements before committing to a target."
        )

elif selected_menu == "📉 Climate Trends":
    st.markdown('<p class="custom-section-header">📉 Yangon Climate Record — ERA5 reanalysis</p>', unsafe_allow_html=True)

    with st.spinner("Loading the Yangon temperature record..."):
        try:
            history = fetch_yangon_climate_history()
        except Exception as exc:
            history = None
            st.error(f"Climate archive unreachable: {str(exc)[:150]}")

    if history:
        yearly = history["yearly"]
        complete = yearly[yearly["year"] < pd.Timestamp.utcnow().year]

        t_col1, t_col2, t_col3 = st.columns(3)
        if len(complete) >= 2:
            first, last = complete.iloc[0], complete.iloc[-1]
            change = round(last["avg_temp"] - first["avg_temp"], 2)
            with t_col1:
                st.metric(f"Mean temperature {int(last['year'])}", f"{last['avg_temp']} °C",
                          delta=f"{change:+} °C since {int(first['year'])}")
            with t_col2:
                st.metric("Average daily high", f"{last['avg_daily_max']} °C",
                          delta=f"{round(last['avg_daily_max'] - first['avg_daily_max'], 2):+} °C")
            with t_col3:
                st.metric("Days above 38 °C", f"{int(last['hot_days'])}",
                          delta=f"{int(last['hot_days'] - first['hot_days']):+} vs {int(first['year'])}",
                          delta_color="inverse")

        st.markdown("#### Annual mean temperature")
        chart_df = yearly.set_index("year")[["avg_temp", "avg_daily_max"]]
        chart_df.columns = ["Annual mean (°C)", "Average daily high (°C)"]
        st.line_chart(chart_df)

        st.markdown("#### Monthly mean — last two years")
        st.bar_chart(history["monthly"].set_index("month")["mean_temp"])

        with st.expander("View the yearly table"):
            table = yearly.rename(columns={
                "year": "Year", "avg_temp": "Annual mean (°C)",
                "avg_daily_max": "Avg daily high (°C)", "hot_days": "Days ≥38 °C"
            })
            st.dataframe(table, use_container_width=True, hide_index=True)
            st.download_button("📥 Download climate record as CSV",
                               data=table.to_csv(index=False).encode("utf-8"),
                               file_name="yangon_climate_record.csv", mime="text/csv")

        st.caption(f"ERA5 reanalysis via Open-Meteo · {history['range']} · the current year is partial, so read it alongside the completed years rather than as a full-year figure.")

    st.markdown("---")
    st.markdown('<p class="custom-section-header">🕒 Your own observation log</p>', unsafe_allow_html=True)
    hist_df = observation_history()
    if hist_df.empty:
        st.info("Every live refresh writes the city-wide reading to a local database. Leave the dashboard running and this chart fills in over the coming hours.")
    else:
        st.line_chart(hist_df.set_index("recorded_at")["avg_temp"])
        st.caption(f"{len(hist_df)} hourly snapshots recorded so far, city-wide average across all 44 townships.")

elif selected_menu == "🚨 Alerts":
    st.markdown('<p class="custom-section-header">🚨 Automated Municipal Heatwave & Alert System</p>', unsafe_allow_html=True)
    alert_threshold = st.slider("Set Heatwave Alert Temperature Threshold (°C)", 33.0, 38.0, ALERT_THRESHOLD_DEFAULT)

    alert_source = active_rows
    critical_townships = sorted(
        [t for t in alert_source if t["live_temp"] >= alert_threshold],
        key=lambda x: x["live_temp"], reverse=True
    )

    if critical_townships:
        st.error(f"🚨 HEATWAVE ALERT ACTIVE: {len(critical_townships)} townships exceed the {alert_threshold}°C threshold.")
        for ct in critical_townships:
            severity = "Critical" if ct["live_temp"] >= alert_threshold + 1 else "Warning"
            st.markdown(f"- **{ct['name']}** — {ct['live_temp']} °C · AQI {ct['live_aqi']} · Status: *{severity}*")
    else:
        st.success("✅ All monitored townships are currently below the active heatwave alert threshold.")

elif selected_menu == "🏥 Public Health":
    st.markdown('<p class="custom-section-header">🏥 Public Health & Heat Stress Vulnerability Hub</p>', unsafe_allow_html=True)
    st.write("Monitoring heat-related illness risks, vulnerable demographics, and emergency medical response readiness across Yangon districts.")

    health_source = active_rows
    health_df = pd.DataFrame(health_source)
    high_risk = int((health_df["vuln_score"] >= 70).sum())
    hottest_health = health_df.loc[health_df["live_temp"].idxmax()]
    worst_air = health_df.loc[health_df["live_aqi"].idxmax()] if (health_df["live_aqi"] > 0).any() else None

    col_ph1, col_ph2, col_ph3 = st.columns(3)
    with col_ph1:
        st.metric(label="Townships at raised risk", value=f"{high_risk}",
                  delta="Vulnerability score ≥ 70", delta_color="inverse")
    with col_ph2:
        st.metric(label="Hottest right now", value=f"{hottest_health['live_temp']} °C",
                  delta=hottest_health["name"], delta_color="inverse")
    with col_ph3:
        if worst_air is not None:
            st.metric(label="Worst air quality", value=f"{int(worst_air['live_aqi'])} AQI",
                      delta=worst_air["name"], delta_color="inverse")
        else:
            st.metric(label="Worst air quality", value="—", delta="No AQI reading")

    st.caption("These figures come from the live readings above. The dashboard has no data on cooling centres, clinic capacity or population — connect a municipal dataset to add those.")

    st.markdown("---")
    st.markdown("#### 💊 Public Health Advisories & Medical Dispatch")
    health_township = st.selectbox("Select Target Township for Health Advisory",
                                   sorted(health_df["name"].tolist()), key="health_t_select")

    st.caption("This builds an advisory you can copy and send yourself — the dashboard has no SMS or email connection, so nothing is transmitted.")

    if st.button("Prepare heat advisory"):
        row = next((r for r in health_source if r["name"] == health_township), None)
        temp = row["live_temp"] if row else "—"
        aqi = row["live_aqi"] if row else "—"
        advisory = f"""HEAT ADVISORY — {health_township}
Issued {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}

Current temperature: {temp} °C
Air quality (US AQI): {aqi} ({aqi_label(aqi if isinstance(aqi, int) else 0)})

Guidance for residents:
- Drink water regularly, before you feel thirsty.
- Avoid outdoor work between 11:00 and 16:00 where possible.
- Check on elderly neighbours and anyone working outdoors.
- Move to a shaded or ventilated space if you feel dizzy or stop sweating.

Clinics: watch for heat exhaustion and heat stroke presentations."""
        st.code(advisory, language=None)
        st.download_button("📥 Download advisory", data=advisory.encode("utf-8"),
                           file_name=f"heat_advisory_{health_township}.txt", mime="text/plain")

elif selected_menu == "👥 Feedback":
    st.markdown('<p class="custom-section-header">👥 Citizen Heat Feedback & Crowdsourcing Hub</p>', unsafe_allow_html=True)

    with st.form("citizen_feedback_form", clear_on_submit=True):
        c_name = st.text_input("Your Name / Identifier")
        c_township = st.selectbox("Township", sorted([t["name"] for t in get_townships()[0]]))
        c_intensity = st.slider("Felt Heat Intensity (1 to 10)", 1, 10, 7)
        c_note = st.text_area("Observations / Notes (e.g., lack of roadside shade)")
        c_submit = st.form_submit_button("Submit Crowdsourced Report")

        if c_submit:
            if c_name and c_note:
                with st.spinner("📝 Saving citizen feedback..."):
                    time.sleep(0.6)
                save_feedback(c_name, c_township, c_intensity, c_note)
                st.session_state.feedback_records = load_feedback()
                st.success("ကျေးဇူးတင်ပါသည်။ မိတ်ဆွေ၏ အကြံပြုချက်ကို မှတ်တမ်းတင်ပြီးပါပြီ။")
            else:
                st.warning("ကျေးဇူးပြု၍ အမည်နှင့် မှတ်ချက်ကို ထည့်သွင်းပေးပါ။")

    if st.session_state.feedback_records:
        st.markdown("---")
        st.markdown(f"#### 📋 Collected Reports ({len(st.session_state.feedback_records)})")
        fb_df = pd.DataFrame(st.session_state.feedback_records).rename(columns={
            "submitted_at": "Submitted", "name": "Name", "township": "Township",
            "intensity": "Heat intensity", "notes": "Notes"
        })
        st.dataframe(fb_df, use_container_width=True, hide_index=True)
        st.download_button(
            label="📥 Download Feedback as CSV",
            data=fb_df.to_csv(index=False).encode("utf-8"),
            file_name="yangon_citizen_feedback.csv",
            mime="text/csv"
        )
        st.caption(f"Saved to the local database at {DB_PATH} — reports survive restarts. Deploying to a shared server keeps everyone's reports in one place.")

# --- STATIC FOOTER SECTION ---
st.markdown("""
<div class="static-footer">
    © 2026 Yangon Urban Intelligence System & Climate Resilience Hub | Streamlit · Weather &amp; air quality: Open-Meteo · Satellite: Landsat/Sentinel via Google Earth Engine · Boundaries: geoBoundaries (CC-BY 4.0)
</div>
""", unsafe_allow_html=True)
