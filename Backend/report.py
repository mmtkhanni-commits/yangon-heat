"""Township report as a PDF.

Burmese script needs a font that contains it. fpdf2's built-in fonts are
Latin-1 only, so this looks for a Myanmar-capable TTF on the machine and falls
back to a Latin font with English labels when there is none. The response says
which happened, so the caller is never quietly handed the wrong thing.

If you need a Burmese PDF and the server has no Myanmar font, the browser's own
print-to-PDF is the better route: it already has the fonts loaded for the page.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime

from fpdf import FPDF

# Fonts that contain Myanmar script, in order of preference
MYANMAR_FONTS = [
    ("Myanmar", "C:/Windows/Fonts/mmrtext.ttf"),
    ("Myanmar", "C:/Windows/Fonts/Padauk-Regular.ttf"),
    ("Myanmar", "/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf"),
    ("Myanmar", "/usr/share/fonts/truetype/padauk/Padauk-Regular.ttf"),
    ("Myanmar", "/usr/share/fonts/noto/NotoSansMyanmar-Regular.ttf"),
    ("Myanmar", "/System/Library/Fonts/Supplemental/Myanmar Sangam MN.ttc"),
]

# Latin fallbacks that at least handle the degree sign
LATIN_FONTS = [
    ("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ("DejaVu", "/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    ("DejaVu", "C:/Windows/Fonts/DejaVuSans.ttf"),
    ("Arial", "C:/Windows/Fonts/arial.ttf"),
]

HEADINGS = {
    "my": {
        "title": "ရန်ကုန် အပူအခြေအနေ အစီရင်ခံစာ",
        "township": "မြို့နယ်",
        "temp": "အပူချိန်",
        "feels": "ခံစားရသော",
        "aqi": "လေထုအရည်အသွေး",
        "anomaly": "မြို့ပျမ်းမျှနှင့်",
        "level": "အပူအဆင့်",
        "generated": "ထုတ်ယူသည့်အချိန်",
        "note": "အချက်အလက်ရင်းမြစ် - Open-Meteo နှင့် geoBoundaries",
    },
    "en": {
        "title": "Yangon heat report",
        "township": "Township",
        "temp": "Temp",
        "feels": "Feels like",
        "aqi": "AQI",
        "anomaly": "vs city",
        "level": "UHI level",
        "generated": "Generated",
        "note": "Data: Open-Meteo and geoBoundaries (CC-BY 4.0)",
    },
}


def _register_font(pdf):
    """Returns (font_name, supports_burmese)."""
    for name, path in MYANMAR_FONTS:
        if os.path.exists(path):
            try:
                pdf.add_font(name, "", path)
                return name, True
            except Exception:
                continue

    for name, path in LATIN_FONTS:
        if os.path.exists(path):
            try:
                pdf.add_font(name, "", path)
                return name, False
            except Exception:
                continue

    return "Helvetica", False


def _safe(text, unicode_ok):
    text = str(text)
    if unicode_ok:
        return text
    return text.encode("latin-1", "replace").decode("latin-1")


def build_report(live, lang="my", satellite=None):
    """live: the payload from sources.fetch_live(). Returns (path, burmese_ok)."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    font, unicode_ok = _register_font(pdf)
    burmese_ok = unicode_ok and lang == "my"
    words = HEADINGS["my" if burmese_ok else "en"]

    def line(text, size=9, gap=5, bold=False):
        pdf.set_font(font, "", size)
        pdf.cell(0, gap, _safe(text, unicode_ok), 0, 1)

    pdf.set_font(font, "", 15)
    pdf.cell(0, 9, _safe(words["title"], unicode_ok), 0, 1, "C")

    pdf.set_font(font, "", 8)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    pdf.cell(0, 5, _safe(f"{words['generated']}: {stamp}", unicode_ok), 0, 1, "C")
    pdf.cell(0, 5, _safe(f"Observed: {live.get('observed_at')} · "
                         f"City average: {live.get('city_mean')} C", unicode_ok), 0, 1, "C")
    pdf.ln(3)

    if satellite:
        pdf.set_font(font, "", 8)
        pdf.multi_cell(0, 4.5, _safe(
            f"Satellite composite: {satellite.get('scenes')} scenes, latest pass "
            f"{satellite.get('latest_pass')}, range {satellite.get('min')}-"
            f"{satellite.get('max')} C. Not a live reading.", unicode_ok))
        pdf.ln(2)

    widths = [46, 22, 24, 20, 24, 22]
    headers = [words["township"], words["temp"], words["feels"],
               words["aqi"], words["anomaly"], words["level"]]

    pdf.set_font(font, "", 8)
    pdf.set_fill_color(232, 237, 243)
    for width, title in zip(widths, headers):
        pdf.cell(width, 7, _safe(title, unicode_ok), 1, 0, "C", fill=True)
    pdf.ln()

    pdf.set_font(font, "", 7.5)
    for i, row in enumerate(live.get("townships", [])):
        if pdf.get_y() > 265:
            pdf.add_page()
            pdf.set_font(font, "", 8)
            for width, title in zip(widths, headers):
                pdf.cell(width, 7, _safe(title, unicode_ok), 1, 0, "C", fill=True)
            pdf.ln()
            pdf.set_font(font, "", 7.5)

        name = row.get("name_my") if burmese_ok else row["name"]
        anomaly = row.get("anomaly")
        cells = [
            name,
            f"{row['temp']} C",
            f"{row.get('feels_like') or row['temp']} C",
            row.get("aqi") or "-",
            f"{anomaly:+}" if anomaly is not None else "-",
            row.get("uhi_level", "-"),
        ]
        for width, value in zip(widths, cells):
            pdf.cell(width, 5.5, _safe(value, unicode_ok), 1, 0,
                     "L" if width == widths[0] else "C")
        pdf.ln()

    pdf.ln(3)
    pdf.set_font(font, "", 7)
    pdf.multi_cell(0, 4, _safe(words["note"], unicode_ok))
    if lang == "my" and not burmese_ok:
        pdf.multi_cell(0, 4, _safe(
            "This server has no Myanmar font installed, so the report was "
            "produced in English. Use the browser's print-to-PDF for Burmese.",
            unicode_ok))

    target = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    pdf.output(target.name)
    return target.name, burmese_ok
