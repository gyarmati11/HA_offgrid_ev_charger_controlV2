"""Departure (ready-by) time."""
from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([DepartureTime(entry.runtime_data)])


class DepartureTime(OGEVEntity, TimeEntity):
    _attr_icon = "mdi:clock-outline"

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "departure_time", "time")

    @property
    def native_value(self) -> time:
        return self.ctrl.departure_value()

    async def async_set_value(self, value: time) -> None:
        await self.ctrl.async_set_departure(value)
