from pathlib import Path
import json
import os
import sys
from urllib.request import Request, urlopen

SOURCE_URL = os.getenv("PREDICT_SOURCE_URL", "").strip()
SOURCE_TOKEN = os.getenv("PREDICT_SOURCE_TOKEN", "").strip()

OUTPUT = Path("data.json")

def http_get_json(url: str):
    headers = {"User-Agent": "PredictAppLive/1.0"}
    if SOURCE_TOKEN:
        headers["Authorization"] = f"Bearer {SOURCE_TOKEN}"
    req = Request(url, headers=headers)
    with urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)

def find_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("predictions", "items", "data", "events", "matches", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []

def first_value(item, *keys, default=None):
    for key in keys:
        value = item.get(key)
        if value not in (None, "", []):
            return value
    return default

def normalize_item(item):
    return {
        "league": first_value(item, "league", "competition", "tournament", "country_league", default="Necunoscut"),
        "match": first_value(item, "match", "fixture", "event_name", "name", "home_away", default="Meci necunoscut"),
        "kickoff": str(first_value(item, "kickoff", "start_time", "time", "date", default="-")),
        "market": first_value(item, "market", "bet_type", "prediction_type", default="General"),
        "pick": first_value(item, "pick", "prediction", "tip", "selection", default="Fără pronostic"),
        "confidence": int(float(first_value(item, "confidence", "probability", "success_rate", default=0))),
        "odds": float(first_value(item, "odds", "price", "quote", default=0) or 0),
        "tag": first_value(item, "tag", "tier", "risk", default="safe"),
        "value": bool(first_value(item, "value", "is_value", default=False)),
        "reason": first_value(item, "reason", "explanation", "analysis", default="Actualizare automată.")
    }

def main():
    if not SOURCE_URL:
        print("Lipsește secretul PREDICT_SOURCE_URL.", file=sys.stderr)
        sys.exit(1)

    payload = http_get_json(SOURCE_URL)
    items = find_items(payload)

    normalized = []
    for item in items:
        if isinstance(item, dict):
            normalized.append(normalize_item(item))

    normalized.sort(key=lambda x: (x.get("confidence", 0), x.get("odds", 0)), reverse=True)

    output = {"predictions": normalized}
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scrise {len(normalized)} predicții în {OUTPUT}")

if __name__ == "__main__":
    main()
