"""Adjustable parameters."""
from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import PARAMS
from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    ctrl: EVChargeController = entry.runtime_data
    async_add_entities([ParamNumber(ctrl, key) for key in PARAMS])


class ParamNumber(OGEVEntity, NumberEntity):
    def __init__(self, ctrl: EVChargeController, key: str) -> None:
        super().__init__(ctrl, key, "number")
        lo, hi, step, _default, unit, icon, is_config = PARAMS[key]
        self.key = key
        self._unit = unit
        self._attr_native_min_value = lo
        self._attr_native_max_value = hi
        self._attr_native_step = step
        self._attr_icon = icon
        self._attr_mode = NumberMode.SLIDER if unit == "%" else NumberMode.BOX
        if is_config:
            self._attr_entity_category = EntityCategory.CONFIG

    @property
    def native_unit_of_measurement(self) -> str:
        return self._unit.replace("{cur}", self.hass.config.currency)

    @property
    def native_value(self) -> float:
        return self.ctrl.params[self.key]

    async def async_set_native_value(self, value: float) -> None:
        await self.ctrl.async_set_param(self.key, value)
