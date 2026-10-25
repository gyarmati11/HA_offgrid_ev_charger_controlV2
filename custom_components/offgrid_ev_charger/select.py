"""Charging mode select."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import MODES
from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([ModeSelect(entry.runtime_data)])


class ModeSelect(OGEVEntity, SelectEntity):
    _attr_icon = "mdi:ev-station"
    _attr_options = MODES

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "mode", "select")

    @property
    def current_option(self) -> str:
        return self.ctrl.mode

    async def async_select_option(self, option: str) -> None:
        await self.ctrl.async_set_mode(option, from_user=True)
