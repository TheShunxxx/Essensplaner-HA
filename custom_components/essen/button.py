"""Buttons for the meal planner integration."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import DOMAIN, async_get_manager, async_repair_frontend_resource


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities,
) -> None:
    """Set up meal planner buttons from a config entry."""
    await async_get_manager(hass)
    async_add_entities([EssenRepairFrontendButton(hass)])


class EssenRepairFrontendButton(ButtonEntity):
    """Repair the Lovelace resource for the bundled dashboard card."""

    _attr_name = "Essensplaner Frontend reparieren"
    _attr_unique_id = "essen_frontend_reparieren"
    _attr_icon = "mdi:tools"
    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    @property
    def device_info(self):
        """Return device information for grouping in the integration UI."""
        return {
            "identifiers": {(DOMAIN, "essensplaner")},
            "name": "Essensplaner",
            "manufacturer": "Essensplaner",
        }

    async def async_press(self) -> None:
        """Repair the dashboard resource."""
        await async_repair_frontend_resource(self.hass)
