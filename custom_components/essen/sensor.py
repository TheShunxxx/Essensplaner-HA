"""Sensors for the meal planner integration."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from . import DATA_MANAGER, DOMAIN, SIGNAL_UPDATE, async_get_manager, async_register_services


async def async_setup_platform(
    hass: HomeAssistant,
    config: dict[str, Any],
    async_add_entities,
    discovery_info=None,
) -> None:
    """Set up meal planner sensors."""
    manager = await async_get_manager(hass)
    async_register_services(hass, manager)
    async_add_entities(
        [
            EssenPlanSensor(hass, manager),
            EssenDishesSensor(hass, manager),
        ],
        update_before_add=True,
    )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities,
) -> None:
    """Set up meal planner sensors from a config entry."""
    manager = await async_get_manager(hass)
    async_register_services(hass, manager)
    async_add_entities(
        [
            EssenPlanSensor(hass, manager),
            EssenDishesSensor(hass, manager),
        ],
        update_before_add=True,
    )


class EssenBaseSensor(SensorEntity):
    """Common cached sensor base."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant, manager) -> None:
        self.hass = hass
        self._manager = manager
        self._summary: dict[str, Any] = {}

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_UPDATE, self._handle_update)
        )

    def _handle_update(self) -> None:
        self.hass.add_job(self.async_schedule_update_ha_state, True)

    @property
    def native_value(self) -> str | None:
        return self._summary.get("state")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {key: value for key, value in self._summary.items() if key != "state"}


class EssenPlanSensor(EssenBaseSensor):
    """Current weekly meal plan."""

    _attr_name = "Essen Wochenplan"
    _attr_unique_id = "essen_wochenplan"
    _attr_icon = "mdi:calendar-week"

    async def async_update(self) -> None:
        self._summary = await self.hass.async_add_executor_job(
            self._manager.plan_summary
        )


class EssenDishesSensor(EssenBaseSensor):
    """Dish catalog summary."""

    _attr_name = "Essen Gerichte"
    _attr_unique_id = "essen_gerichte"
    _attr_icon = "mdi:food-fork-drink"

    async def async_update(self) -> None:
        self._summary = await self.hass.async_add_executor_job(
            self._manager.dishes_summary
        )
