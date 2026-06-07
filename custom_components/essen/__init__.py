"""Meal planner integration for Home Assistant."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
import json
import logging
from pathlib import Path
import random
from threading import RLock
import unicodedata
from typing import Any

import voluptuous as vol

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.typing import ConfigType

DOMAIN = "essen"
DATA_MANAGER = "manager"
SIGNAL_UPDATE = "essen_updated"
PLATFORMS = [Platform.SENSOR]
FRONTEND_URL = "/essen-planer"

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Any(None, dict)}, extra=vol.ALLOW_EXTRA)

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

YEAR = vol.All(vol.Coerce(int), vol.Range(min=2000, max=2100))
WEEK = vol.All(vol.Coerce(int), vol.Range(min=1, max=53))
KLASSE = vol.All(vol.Coerce(int), vol.Range(min=1, max=4))

YEAR_WEEK_SCHEMA = {
    vol.Optional("year"): YEAR,
    vol.Optional("week"): WEEK,
}


def _normalize(value: Any) -> str:
    text = str(value or "").strip().casefold()
    text = unicodedata.normalize("NFKD", text)
    return "".join(char for char in text if not unicodedata.combining(char))


def _plan_key(year: int, week: int) -> str:
    return f"{year}-W{week:02d}"


def _display_date(value: date) -> str:
    return value.strftime("%d.%m.")


class MealPlanner:
    """Persist dishes and weekly plans in JSON files."""

    def __init__(self, base_path: str) -> None:
        self.base_path = Path(base_path)
        self.dishes_file = self.base_path / "gerichte.json"
        self.plans_file = self.base_path / "wochenplaene.json"
        self.public_dishes_file = self.base_path.parent / "www" / "essen-gerichte.json"
        self.public_plans_file = self.base_path.parent / "www" / "essen-wochenplaene.json"
        self.public_card_file = self.base_path.parent / "www" / "essen-planer-card.js"
        self.default_dishes_file = Path(__file__).with_name("default_gerichte.json")
        self.card_source_file = Path(__file__).with_name("frontend") / "essen-planer-card.js"
        self._lock = RLock()

    def ensure_files(self) -> None:
        with self._lock:
            self.base_path.mkdir(parents=True, exist_ok=True)
            if not self.dishes_file.exists():
                dishes = self._read_json_file(self.default_dishes_file)
                self._write_json_file(self.dishes_file, dishes)
            if not self.plans_file.exists():
                self._write_json_file(
                    self.plans_file,
                    {"version": 1, "current_plan": None, "plans": {}},
                )
            self._publish_dishes_data(self._load_dishes_data())
            self._publish_plans_data(self._load_plans())
            self._publish_card_file()

    def create_plan(self, year: int | None = None, week: int | None = None) -> dict[str, Any]:
        with self._lock:
            year, week = self._resolve_year_week(year, week)
            plan = self._blank_plan(year, week)
            for day in plan["days"]:
                dish = self._pick_dish(day["key"], plan)
                if dish is not None:
                    self._assign_dish(day, dish)
            self._store_plan(plan)
            return plan

    def reroll_day(
        self,
        day: str,
        year: int | None = None,
        week: int | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            plan = self._get_or_create_plan(year, week)
            day_entry = self._find_day(plan, day)
            self._clear_day(day_entry)
            dish = self._pick_dish(day_entry["key"], plan)
            if dish is None:
                raise ValueError("Kein passendes aktives Gericht gefunden.")
            self._assign_dish(day_entry, dish)
            self._store_plan(plan)
            return plan

    def set_day(
        self,
        day: str,
        dish_id: int | None = None,
        dish_name: str | None = None,
        year: int | None = None,
        week: int | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            plan = self._get_or_create_plan(year, week)
            day_entry = self._find_day(plan, day)
            if dish_id is None and not str(dish_name or "").strip():
                self._clear_day(day_entry)
            else:
                dish = self._find_dish(dish_id=dish_id, dish_name=dish_name, strict=False)
                if dish is None:
                    self._assign_custom(day_entry, str(dish_name or "").strip())
                else:
                    self._assign_dish(day_entry, dish)
            self._store_plan(plan)
            return plan

    def clear_day(
        self,
        day: str,
        year: int | None = None,
        week: int | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            plan = self._get_or_create_plan(year, week)
            self._clear_day(self._find_day(plan, day))
            self._store_plan(plan)
            return plan

    def add_dish(self, name: str, klasse: int) -> dict[str, Any]:
        name = str(name or "").strip()
        if not name:
            raise ValueError("Bitte einen Gerichtnamen angeben.")
        with self._lock:
            data = self._load_dishes_data()
            dishes = data.setdefault("dishes", [])
            next_id = max((int(dish.get("id", 0)) for dish in dishes), default=0) + 1
            dish = {"id": next_id, "name": name, "klasse": int(klasse), "active": True}
            dishes.append(dish)
            self._save_dishes_data(data)
            return dish

    def update_dish(
        self,
        dish_id: int,
        name: str | None = None,
        klasse: int | None = None,
        active: bool | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            data = self._load_dishes_data()
            for dish in data.get("dishes", []):
                if int(dish.get("id", 0)) == int(dish_id):
                    if name is not None and str(name).strip():
                        dish["name"] = str(name).strip()
                    if klasse is not None:
                        dish["klasse"] = int(klasse)
                    if active is not None:
                        dish["active"] = bool(active)
                    self._save_dishes_data(data)
                    return dish
        raise ValueError(f"Gericht mit ID {dish_id} nicht gefunden.")

    def deactivate_dish(self, dish_id: int) -> dict[str, Any]:
        return self.update_dish(dish_id=dish_id, active=False)

    def plan_summary(self) -> dict[str, Any]:
        with self._lock:
            plans_data = self._load_plans()
            plan = self._current_plan(plans_data)
            if plan is None:
                return {"state": "kein Plan", "days": [], "label": None}
            filled = sum(1 for day in plan["days"] if day.get("dish_name"))
            label = f"KW {plan['week']} / {plan['year']}"
            return {
                "state": f"{label}: {filled}/7",
                "label": label,
                "year": plan["year"],
                "week": plan["week"],
                "key": plan["key"],
                "days": plan["days"],
                "created_at": plan.get("created_at"),
                "updated_at": plan.get("updated_at"),
            }

    def dishes_summary(self) -> dict[str, Any]:
        with self._lock:
            dishes = self._load_dishes()
            active = [dish for dish in dishes if dish.get("active", True)]
            by_class = Counter(int(dish.get("klasse", 0)) for dish in active)
            return {
                "state": f"{len(active)} aktiv",
                "active_count": len(active),
                "total_count": len(dishes),
                "by_class": dict(sorted(by_class.items())),
                "active_dishes": active,
                "all_dishes": dishes,
            }

    def _blank_plan(self, year: int, week: int) -> dict[str, Any]:
        monday = self._monday_for_week(year, week)
        now = datetime.now().isoformat(timespec="seconds")
        days = []
        for key, name, offset in DAY_ORDER:
            day_date = monday + timedelta(days=offset)
            days.append(
                {
                    "key": key,
                    "name": name,
                    "date": day_date.isoformat(),
                    "date_display": _display_date(day_date),
                    "dish_id": None,
                    "dish_name": "",
                    "klasse": None,
                }
            )
        return {
            "key": _plan_key(year, week),
            "year": year,
            "week": week,
            "created_at": now,
            "updated_at": now,
            "days": days,
        }

    def _get_or_create_plan(self, year: int | None, week: int | None) -> dict[str, Any]:
        year, week = self._resolve_year_week(year, week)
        plans_data = self._load_plans()
        key = _plan_key(year, week)
        plan = plans_data.get("plans", {}).get(key)
        if plan is None:
            return self._blank_plan(year, week)
        return plan

    def _store_plan(self, plan: dict[str, Any]) -> None:
        plans_data = self._load_plans()
        plan["updated_at"] = datetime.now().isoformat(timespec="seconds")
        plans_data.setdefault("plans", {})[plan["key"]] = plan
        plans_data["current_plan"] = plan["key"]
        self._save_plans(plans_data)

    def _current_plan(self, plans_data: dict[str, Any]) -> dict[str, Any] | None:
        key = plans_data.get("current_plan")
        plans = plans_data.get("plans", {})
        if key in plans:
            return plans[key]
        if plans:
            return plans[sorted(plans)[-1]]
        return None

    def _resolve_year_week(
        self,
        year: int | None = None,
        week: int | None = None,
    ) -> tuple[int, int]:
        if year is not None and week is not None:
            year = int(year)
            week = int(week)
            self._monday_for_week(year, week)
            return year, week
        current = self._current_plan(self._load_plans())
        if current is not None:
            return int(current["year"]), int(current["week"])
        iso = (date.today() + timedelta(days=7)).isocalendar()
        return iso.year, iso.week

    def _monday_for_week(self, year: int, week: int) -> date:
        try:
            return date.fromisocalendar(int(year), int(week), 1)
        except ValueError as err:
            raise ValueError(f"Ungültige KW {week} für Jahr {year}.") from err

    def _find_day(self, plan: dict[str, Any], day: str) -> dict[str, Any]:
        key = DAY_ALIASES.get(_normalize(day))
        if key is None:
            raise ValueError(f"Unbekannter Tag: {day}")
        for day_entry in plan["days"]:
            if day_entry["key"] == key:
                return day_entry
        raise ValueError(f"Tag {day} ist im Plan nicht vorhanden.")

    def _pick_dish(self, day_key: str, plan: dict[str, Any]) -> dict[str, Any] | None:
        dishes = [dish for dish in self._load_dishes() if dish.get("active", True)]
        random.SystemRandom().shuffle(dishes)
        for dish in dishes:
            if self._dish_allowed(dish, day_key, plan):
                return dish
        return None

    def _dish_allowed(
        self,
        dish: dict[str, Any],
        day_key: str,
        plan: dict[str, Any],
    ) -> bool:
        dish_id = int(dish["id"])
        used_ids = {
            int(day["dish_id"])
            for day in plan["days"]
            if day.get("dish_id") not in (None, "")
        }
        if dish_id in used_ids:
            return False

        klasse = int(dish.get("klasse", 0))
        counts = Counter(
            int(day["klasse"])
            for day in plan["days"]
            if day.get("klasse") not in (None, "")
        )
        if klasse == 2 and counts[2] >= 2:
            return False
        if klasse == 3 and counts[3] >= 1:
            return False
        if klasse == 4:
            return day_key in ("samstag", "sonntag") and counts[4] < 1
        return True

    def _assign_dish(self, day_entry: dict[str, Any], dish: dict[str, Any]) -> None:
        day_entry["dish_id"] = int(dish["id"])
        day_entry["dish_name"] = dish["name"]
        day_entry["klasse"] = int(dish["klasse"])
        day_entry["custom"] = False

    def _assign_custom(self, day_entry: dict[str, Any], value: str) -> None:
        if not value:
            self._clear_day(day_entry)
            return
        day_entry["dish_id"] = None
        day_entry["dish_name"] = value
        day_entry["klasse"] = None
        day_entry["custom"] = True

    def _clear_day(self, day_entry: dict[str, Any]) -> None:
        day_entry["dish_id"] = None
        day_entry["dish_name"] = ""
        day_entry["klasse"] = None
        day_entry["custom"] = False

    def _find_dish(
        self,
        dish_id: int | None = None,
        dish_name: str | None = None,
        strict: bool = True,
    ) -> dict[str, Any]:
        dishes = [dish for dish in self._load_dishes() if dish.get("active", True)]
        if dish_id is not None:
            for dish in dishes:
                if int(dish.get("id", 0)) == int(dish_id):
                    return dish
            if strict:
                raise ValueError(f"Aktives Gericht mit ID {dish_id} nicht gefunden.")
            return None
        wanted = _normalize(dish_name)
        if wanted:
            for dish in dishes:
                if _normalize(dish.get("name")) == wanted:
                    return dish
            for dish in dishes:
                if wanted in _normalize(dish.get("name")):
                    return dish
        if strict:
            raise ValueError(f"Aktives Gericht '{dish_name}' nicht gefunden.")
        return None

    def _load_dishes(self) -> list[dict[str, Any]]:
        return self._load_dishes_data().get("dishes", [])

    def _load_dishes_data(self) -> dict[str, Any]:
        return self._read_json_file(self.dishes_file)

    def _save_dishes_data(self, data: dict[str, Any]) -> None:
        self._write_json_file(self.dishes_file, data)
        self._publish_dishes_data(data)

    def _publish_dishes_data(self, data: dict[str, Any]) -> None:
        self.public_dishes_file.parent.mkdir(parents=True, exist_ok=True)
        self._write_json_file(self.public_dishes_file, data)

    def _load_plans(self) -> dict[str, Any]:
        return self._read_json_file(self.plans_file)

    def _save_plans(self, data: dict[str, Any]) -> None:
        self._write_json_file(self.plans_file, data)
        self._publish_plans_data(data)

    def _publish_plans_data(self, data: dict[str, Any]) -> None:
        self.public_plans_file.parent.mkdir(parents=True, exist_ok=True)
        self._write_json_file(self.public_plans_file, data)

    def _publish_card_file(self) -> None:
        source = self.card_source_file.read_bytes()
        self.public_card_file.parent.mkdir(parents=True, exist_ok=True)
        if self.public_card_file.exists() and self.public_card_file.read_bytes() == source:
            return
        tmp_path = self.public_card_file.with_suffix(self.public_card_file.suffix + ".tmp")
        tmp_path.write_bytes(source)
        tmp_path.replace(self.public_card_file)

    def _read_json_file(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_json_file(self, path: Path, data: dict[str, Any]) -> None:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        tmp_path.replace(path)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the meal planner."""
    await async_register_frontend(hass)

    if config.get(DOMAIN) is not None:
        manager = await async_get_manager(hass)
        async_register_services(hass, manager)

    _LOGGER.info("Essensplanung loaded")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the meal planner from a config entry."""
    manager = await async_get_manager(hass)
    async_register_services(hass, manager)
    await async_register_frontend(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the meal planner config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Expose bundled dashboard assets."""
    hass.data.setdefault(DOMAIN, {})
    if hass.data[DOMAIN].get("frontend_registered"):
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                FRONTEND_URL,
                str(Path(__file__).with_name("frontend")),
                False,
            )
        ]
    )
    hass.data[DOMAIN]["frontend_registered"] = True


async def async_get_manager(hass: HomeAssistant) -> MealPlanner:
    """Return the shared meal planner manager."""
    hass.data.setdefault(DOMAIN, {})
    manager = hass.data[DOMAIN].get(DATA_MANAGER)
    if manager is None:
        manager = MealPlanner(hass.config.path("essen"))
        await hass.async_add_executor_job(manager.ensure_files)
        hass.data[DOMAIN][DATA_MANAGER] = manager
    return manager


def async_register_services(hass: HomeAssistant, manager: MealPlanner) -> None:
    """Register meal planner services once."""
    if hass.data.setdefault(DOMAIN, {}).get("services_registered"):
        return

    async def call_manager(method_name: str, call: ServiceCall) -> None:
        method = getattr(manager, method_name)
        try:
            await hass.async_add_executor_job(lambda: method(**dict(call.data)))
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err
        async_dispatcher_send(hass, SIGNAL_UPDATE)
        hass.bus.async_fire(f"{DOMAIN}_updated")

    def service_handler(method_name: str):
        async def handle_service(call: ServiceCall) -> None:
            await call_manager(method_name, call)

        return handle_service

    hass.services.async_register(
        DOMAIN,
        "create_plan",
        service_handler("create_plan"),
        schema=vol.Schema(YEAR_WEEK_SCHEMA),
    )
    hass.services.async_register(
        DOMAIN,
        "reroll_day",
        service_handler("reroll_day"),
        schema=vol.Schema({vol.Required("day"): cv.string, **YEAR_WEEK_SCHEMA}),
    )
    hass.services.async_register(
        DOMAIN,
        "set_day",
        service_handler("set_day"),
        schema=vol.Schema(
            {
                vol.Required("day"): cv.string,
                vol.Optional("dish_id"): vol.Coerce(int),
                vol.Optional("dish_name"): cv.string,
                **YEAR_WEEK_SCHEMA,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "clear_day",
        service_handler("clear_day"),
        schema=vol.Schema({vol.Required("day"): cv.string, **YEAR_WEEK_SCHEMA}),
    )
    hass.services.async_register(
        DOMAIN,
        "add_dish",
        service_handler("add_dish"),
        schema=vol.Schema({vol.Required("name"): cv.string, vol.Required("klasse"): KLASSE}),
    )
    hass.services.async_register(
        DOMAIN,
        "update_dish",
        service_handler("update_dish"),
        schema=vol.Schema(
            {
                vol.Required("dish_id"): vol.Coerce(int),
                vol.Optional("name"): cv.string,
                vol.Optional("klasse"): KLASSE,
                vol.Optional("active"): cv.boolean,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "deactivate_dish",
        service_handler("deactivate_dish"),
        schema=vol.Schema({vol.Required("dish_id"): vol.Coerce(int)}),
    )

    hass.data[DOMAIN]["services_registered"] = True
