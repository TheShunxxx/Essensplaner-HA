#!/usr/bin/env python3
"""Command line helper for the Home Assistant meal planner."""

from __future__ import annotations

import base64
from collections import Counter
from datetime import date, datetime, timedelta
import argparse
import json
from pathlib import Path
import random
import unicodedata
from urllib.parse import unquote

BASE = Path("/config/essen")
DISHES_FILE = BASE / "gerichte.json"
PLANS_FILE = BASE / "wochenplaene.json"
PUBLIC_DISHES_FILE = Path("/config/www/essen-gerichte.json")
PUBLIC_PLANS_FILE = Path("/config/www/essen-wochenplaene.json")

DAY_ORDER = [
    ("montag", "Montag", 0),
    ("dienstag", "Dienstag", 1),
    ("mittwoch", "Mittwoch", 2),
    ("donnerstag", "Donnerstag", 3),
    ("freitag", "Freitag", 4),
    ("samstag", "Samstag", 5),
    ("sonntag", "Sonntag", 6),
]

DAY_ALIASES = {
    "sa": "samstag",
    "samstag": "samstag",
    "so": "sonntag",
    "sonntag": "sonntag",
    "mo": "montag",
    "montag": "montag",
    "di": "dienstag",
    "dienstag": "dienstag",
    "mi": "mittwoch",
    "mittwoch": "mittwoch",
    "do": "donnerstag",
    "donnerstag": "donnerstag",
    "fr": "freitag",
    "freitag": "freitag",
}


def normalize(value):
    text = str(value or "").strip().casefold()
    text = unicodedata.normalize("NFKD", text)
    return "".join(char for char in text if not unicodedata.combining(char))


def decode_text(value):
    value = str(value or "")
    if value.startswith("b64_"):
        payload = value[4:]
        padding = "=" * (-len(payload) % 4)
        return base64.urlsafe_b64decode(f"{payload}{padding}").decode("utf-8")
    return unquote(value)


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    tmp_path.replace(path)


def publish():
    write_json(PUBLIC_DISHES_FILE, read_json(DISHES_FILE))
    write_json(PUBLIC_PLANS_FILE, load_plans())


def plan_key(year, week):
    return f"{int(year)}-W{int(week):02d}"


def blank_plan(year, week):
    monday = date.fromisocalendar(int(year), int(week), 1)
    now = datetime.now().isoformat(timespec="seconds")
    days = []
    for key, name, offset in DAY_ORDER:
        day_date = monday + timedelta(days=offset)
        days.append(
            {
                "key": key,
                "name": name,
                "date": day_date.isoformat(),
                "date_display": day_date.strftime("%d.%m."),
                "dish_id": None,
                "dish_name": "",
                "klasse": None,
                "custom": False,
            }
        )
    return {
        "key": plan_key(year, week),
        "year": int(year),
        "week": int(week),
        "created_at": now,
        "updated_at": now,
        "days": days,
    }


def active_dishes():
    return [dish for dish in read_json(DISHES_FILE).get("dishes", []) if dish.get("active", True)]


def load_plans():
    if not PLANS_FILE.exists():
        return {"version": 1, "current_plan": None, "plans": {}}
    return read_json(PLANS_FILE)


def store_plan(plan):
    plans = load_plans()
    plan["updated_at"] = datetime.now().isoformat(timespec="seconds")
    plans.setdefault("plans", {})[plan["key"]] = plan
    plans["current_plan"] = plan["key"]
    write_json(PLANS_FILE, plans)
    publish()


def get_or_create_plan(year, week):
    return load_plans().get("plans", {}).get(plan_key(year, week)) or blank_plan(year, week)


def find_day(plan, day):
    key = DAY_ALIASES.get(normalize(day))
    if key is None:
        raise SystemExit(f"Unbekannter Tag: {day}")
    for entry in plan["days"]:
        if entry["key"] == key:
            return entry
    raise SystemExit(f"Tag nicht gefunden: {day}")


def find_dish(dish_name=None, strict=True):
    wanted = normalize(dish_name)
    if wanted:
        for dish in active_dishes():
            if normalize(dish.get("name")) == wanted:
                return dish
        for dish in active_dishes():
            if wanted in normalize(dish.get("name")):
                return dish
    if strict:
        raise SystemExit(f"Gericht nicht gefunden: {dish_name}")
    return None


def assign_dish(day_entry, dish):
    day_entry["dish_id"] = int(dish["id"])
    day_entry["dish_name"] = dish["name"]
    day_entry["klasse"] = int(dish["klasse"])
    day_entry["custom"] = False


def assign_custom(day_entry, value):
    value = str(value or "").strip()
    if not value:
        clear_day_entry(day_entry)
        return
    day_entry["dish_id"] = None
    day_entry["dish_name"] = value
    day_entry["klasse"] = None
    day_entry["custom"] = True


def clear_day_entry(day_entry):
    day_entry["dish_id"] = None
    day_entry["dish_name"] = ""
    day_entry["klasse"] = None
    day_entry["custom"] = False


def dish_allowed(dish, day_key, plan):
    dish_id = int(dish["id"])
    used_ids = {int(day["dish_id"]) for day in plan["days"] if day.get("dish_id") not in (None, "")}
    if dish_id in used_ids:
        return False

    klasse = int(dish.get("klasse", 0))
    counts = Counter(int(day["klasse"]) for day in plan["days"] if day.get("klasse") not in (None, ""))
    if klasse == 2 and counts[2] >= 2:
        return False
    if klasse == 3 and counts[3] >= 1:
        return False
    if klasse == 4:
        return day_key in ("samstag", "sonntag") and counts[4] < 1
    return True


def pick_dish(day_key, plan):
    dishes = active_dishes()
    random.SystemRandom().shuffle(dishes)
    for dish in dishes:
        if dish_allowed(dish, day_key, plan):
            return dish
    raise SystemExit("Kein passendes aktives Gericht gefunden.")


def create_plan(args):
    plan = blank_plan(args.year, args.week)
    for day in plan["days"]:
        assign_dish(day, pick_dish(day["key"], plan))
    store_plan(plan)


def reroll_day(args):
    plan = get_or_create_plan(args.year, args.week)
    day = find_day(plan, args.day)
    clear_day_entry(day)
    assign_dish(day, pick_dish(day["key"], plan))
    store_plan(plan)


def set_day(args):
    plan = get_or_create_plan(args.year, args.week)
    day = find_day(plan, args.day)
    dish_name = decode_text(args.dish_name)
    dish = find_dish(dish_name, strict=False)
    assign_dish(day, dish) if dish else assign_custom(day, dish_name)
    store_plan(plan)


def clear_day(args):
    plan = get_or_create_plan(args.year, args.week)
    clear_day_entry(find_day(plan, args.day))
    store_plan(plan)


def add_dish(args):
    name = decode_text(args.name).strip()
    data = read_json(DISHES_FILE)
    dishes = data.setdefault("dishes", [])
    next_id = max((int(dish.get("id", 0)) for dish in dishes), default=0) + 1
    dishes.append({"id": next_id, "name": name, "klasse": int(args.klasse), "active": True})
    write_json(DISHES_FILE, data)
    publish()


def update_dish(args):
    name = decode_text(args.name).strip()
    data = read_json(DISHES_FILE)
    for dish in data.get("dishes", []):
        if int(dish.get("id", 0)) == int(args.dish_id):
            if name:
                dish["name"] = name
            dish["klasse"] = int(args.klasse)
            dish["active"] = True
            write_json(DISHES_FILE, data)
            publish()
            return
    raise SystemExit(f"Gericht-ID nicht gefunden: {args.dish_id}")


def deactivate_dish(args):
    data = read_json(DISHES_FILE)
    for dish in data.get("dishes", []):
        if int(dish.get("id", 0)) == int(args.dish_id):
            dish["active"] = False
            write_json(DISHES_FILE, data)
            publish()
            return
    raise SystemExit(f"Gericht-ID nicht gefunden: {args.dish_id}")


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(required=True)

    command = subparsers.add_parser("publish")
    command.set_defaults(func=lambda args: publish())

    command = subparsers.add_parser("create_plan")
    command.add_argument("--year", type=int, required=True)
    command.add_argument("--week", type=int, required=True)
    command.set_defaults(func=create_plan)

    for name, func in (("reroll_day", reroll_day), ("clear_day", clear_day)):
        command = subparsers.add_parser(name)
        command.add_argument("--year", type=int, required=True)
        command.add_argument("--week", type=int, required=True)
        command.add_argument("--day", required=True)
        command.set_defaults(func=func)

    command = subparsers.add_parser("set_day")
    command.add_argument("--year", type=int, required=True)
    command.add_argument("--week", type=int, required=True)
    command.add_argument("--day", required=True)
    command.add_argument("--dish-name", default="")
    command.set_defaults(func=set_day)

    command = subparsers.add_parser("add_dish")
    command.add_argument("--name", required=True)
    command.add_argument("--klasse", type=int, required=True)
    command.set_defaults(func=add_dish)

    command = subparsers.add_parser("update_dish")
    command.add_argument("--dish-id", type=int, required=True)
    command.add_argument("--name", required=True)
    command.add_argument("--klasse", type=int, required=True)
    command.set_defaults(func=update_dish)

    command = subparsers.add_parser("deactivate_dish")
    command.add_argument("--dish-id", type=int, required=True)
    command.set_defaults(func=deactivate_dish)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
