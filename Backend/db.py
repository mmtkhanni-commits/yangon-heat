"""Storage for citizen reports, alert subscriptions and the reading log.

Uses SQLite by default so the project runs with no setup. Set DATABASE_URL to a
Postgres connection string (Neon, Supabase, Railway) and the same code runs
against Postgres — hosted platforms wipe local disk on restart, so anything you
need to keep belongs in Postgres.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_POSTGRES = DATABASE_URL.startswith("postgres")

SQLITE_PATH = Path(__file__).parent / "data" / "uhi.db"

if IS_POSTGRES:
    import psycopg
    from psycopg.rows import dict_row


@contextmanager
def connection():
    if IS_POSTGRES:
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
    else:
        SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def _ph(n):
    """Placeholder style differs between the two drivers."""
    return ", ".join(["%s" if IS_POSTGRES else "?"] * n)


def _q(sql):
    return sql if IS_POSTGRES else sql.replace("%s", "?")


SCHEMA_PG = [
    """CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        name TEXT NOT NULL,
        township TEXT NOT NULL,
        intensity INTEGER NOT NULL,
        notes TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        email TEXT NOT NULL,
        township TEXT NOT NULL,
        threshold REAL NOT NULL DEFAULT 36.0,
        confirmed BOOLEAN NOT NULL DEFAULT TRUE,
        last_sent TIMESTAMPTZ,
        UNIQUE (email, township)
    )""",
    """CREATE TABLE IF NOT EXISTS readings (
        id SERIAL PRIMARY KEY,
        recorded_hour TEXT NOT NULL,
        township TEXT NOT NULL,
        temp REAL,
        aqi INTEGER,
        UNIQUE (recorded_hour, township)
    )""",
]

SCHEMA_SQLITE = [
    """CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submitted_at TEXT NOT NULL,
        name TEXT NOT NULL,
        township TEXT NOT NULL,
        intensity INTEGER NOT NULL,
        notes TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        email TEXT NOT NULL,
        township TEXT NOT NULL,
        threshold REAL NOT NULL DEFAULT 36.0,
        confirmed INTEGER NOT NULL DEFAULT 1,
        last_sent TEXT,
        UNIQUE (email, township)
    )""",
    """CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_hour TEXT NOT NULL,
        township TEXT NOT NULL,
        temp REAL,
        aqi INTEGER,
        UNIQUE (recorded_hour, township)
    )""",
]


def init():
    with connection() as conn:
        cur = conn.cursor()
        for stmt in (SCHEMA_PG if IS_POSTGRES else SCHEMA_SQLITE):
            cur.execute(stmt)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ------------------------------------------------------------------ reports

def add_report(name, township, intensity, notes):
    with connection() as conn:
        cur = conn.cursor()
        if IS_POSTGRES:
            cur.execute(
                "INSERT INTO reports (name, township, intensity, notes) VALUES (%s,%s,%s,%s)",
                (name, township, intensity, notes))
        else:
            cur.execute(
                "INSERT INTO reports (submitted_at, name, township, intensity, notes)"
                " VALUES (?,?,?,?,?)", (_now(), name, township, intensity, notes))


def list_reports(limit=200):
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_q("SELECT submitted_at, name, township, intensity, notes"
                       " FROM reports ORDER BY id DESC LIMIT %s"), (limit,))
        return [dict(r) for r in cur.fetchall()]


def report_summary():
    """Average felt intensity per township, so crowd reports can be compared
    against the measured temperature."""
    with connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT township, COUNT(*) AS reports, AVG(intensity) AS avg_intensity"
                    " FROM reports GROUP BY township")
        return [dict(r) for r in cur.fetchall()]


# ------------------------------------------------------------ subscriptions

def add_subscription(email, township, threshold):
    with connection() as conn:
        cur = conn.cursor()
        if IS_POSTGRES:
            cur.execute(
                "INSERT INTO subscriptions (email, township, threshold) VALUES (%s,%s,%s)"
                " ON CONFLICT (email, township) DO UPDATE SET threshold = EXCLUDED.threshold",
                (email, township, threshold))
        else:
            cur.execute(
                "INSERT INTO subscriptions (created_at, email, township, threshold)"
                " VALUES (?,?,?,?) ON CONFLICT (email, township)"
                " DO UPDATE SET threshold = excluded.threshold",
                (_now(), email, township, threshold))


def remove_subscription(email, township=None):
    with connection() as conn:
        cur = conn.cursor()
        if township:
            cur.execute(_q("DELETE FROM subscriptions WHERE email = %s AND township = %s"),
                        (email, township))
        else:
            cur.execute(_q("DELETE FROM subscriptions WHERE email = %s"), (email,))
        return cur.rowcount


def list_subscriptions():
    with connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, email, township, threshold, last_sent FROM subscriptions")
        return [dict(r) for r in cur.fetchall()]


def mark_sent(sub_id):
    with connection() as conn:
        cur = conn.cursor()
        if IS_POSTGRES:
            cur.execute("UPDATE subscriptions SET last_sent = NOW() WHERE id = %s", (sub_id,))
        else:
            cur.execute("UPDATE subscriptions SET last_sent = ? WHERE id = ?", (_now(), sub_id))


# ----------------------------------------------------------------- readings

def log_readings(rows, observed_at):
    if not observed_at:
        return
    hour = str(observed_at)[:13]
    payload = [(hour, r["name"], r["temp"], r["aqi"]) for r in rows]
    with connection() as conn:
        cur = conn.cursor()
        stmt = ("INSERT INTO readings (recorded_hour, township, temp, aqi) VALUES (%s,%s,%s,%s)"
                " ON CONFLICT (recorded_hour, township) DO NOTHING")
        cur.executemany(_q(stmt), payload)


def reading_history(hours=168):
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_q(
            "SELECT recorded_hour, ROUND(AVG(temp)::numeric, 2) AS avg_temp,"
            " ROUND(AVG(aqi)::numeric, 0) AS avg_aqi FROM readings"
            " GROUP BY recorded_hour ORDER BY recorded_hour DESC LIMIT %s"
        ) if IS_POSTGRES else
            "SELECT recorded_hour, ROUND(AVG(temp), 2) AS avg_temp,"
            " ROUND(AVG(aqi), 0) AS avg_aqi FROM readings"
            " GROUP BY recorded_hour ORDER BY recorded_hour DESC LIMIT ?", (hours,))
        rows = [dict(r) for r in cur.fetchall()]
    return list(reversed(rows))
