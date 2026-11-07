"""Ready-by (departure) switch."""
from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([DepartureSwitch(entry.runtime_data)])


class DepartureSwitch(OGEVEntity, SwitchEntity):
    """When on, the car is charged to the target by the departure time (boost if needed)."""

    _attr_icon = "mdi:clock-check-outline"

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "departure_enabled", "switch")

    @property
    def is_on(self) -> bool:
        return self.ctrl.departure_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"boost_active": self.ctrl.boost_active}

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.ctrl.async_set_departure_on(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.ctrl.async_set_departure_on(False)
