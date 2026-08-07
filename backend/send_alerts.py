"""Send heat alerts to everyone whose township is over their threshold.

Run on a schedule (cron, GitHub Actions, Render cron job), for example hourly:

    SMTP_HOST=smtp.gmail.com SMTP_USER=you@gmail.com SMTP_PASSWORD=app-password \
    ALERT_FROM=you@gmail.com python send_alerts.py

Gmail needs an app password, not the account password. Without the SMTP
variables set the job prints what it would send and exits, so it is safe to try.
"""

import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import db
import sources

QUIET_HOURS = 6  # do not email the same person more than once in this window


def build_message(sub, reading, guide):
    msg = EmailMessage()
    msg["Subject"] = f"Heat alert — {sub['township']} is {reading['temp']} °C"
    msg["From"] = os.environ.get("ALERT_FROM", "alerts@example.org")
    msg["To"] = sub["email"]
    msg.set_content(
        f"{sub['township']} is currently {reading['temp']} °C, above the "
        f"{sub['threshold']} °C you asked to hear about.\n\n"
        f"{guide['headline_en']}\n{guide['advice_en']}\n\n"
        f"{guide['headline_my']}\n{guide['advice_my']}\n\n"
        f"Air quality (US AQI): {reading['aqi'] or 'no reading'}\n"
        f"Feels like: {reading.get('feels_like') or reading['temp']} °C\n\n"
        "To stop these emails, reply and say so, or use the unsubscribe link in the app."
    )
    return msg


def main():
    db.init()
    live = sources.fetch_live()
    by_name = {t["name"]: t for t in live["townships"]}
    now = datetime.now(timezone.utc)

    host = os.environ.get("SMTP_HOST")
    dry_run = not host
    server = None
    if not dry_run:
        server = smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", 587)))
        server.starttls()
        server.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])

    sent = 0
    for sub in db.list_subscriptions():
        reading = by_name.get(sub["township"])
        if not reading or reading["temp"] < sub["threshold"]:
            continue

        last = sub.get("last_sent")
        if last:
            stamp = last if isinstance(last, datetime) else datetime.fromisoformat(str(last))
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            if now - stamp < timedelta(hours=QUIET_HOURS):
                continue

        message = build_message(sub, reading, sources.guidance(
            reading["temp"], reading.get("feels_like")))

        if dry_run:
            print(f"[dry run] would email {sub['email']} about {sub['township']}")
        else:
            server.send_message(message)
            db.mark_sent(sub["id"])
        sent += 1

    if server:
        server.quit()
    print(f"{'Would send' if dry_run else 'Sent'} {sent} alert(s).")


if __name__ == "__main__":
    main()
