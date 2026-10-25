"""Binary sensors: plugged, charging, car full, data error."""
from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    ctrl: EVChargeController = entry.runtime_data
    async_add_entities(
        [
            OGEVBinary(ctrl, "plugged", "plugged", BinarySensorDeviceClass.PLUG),
            OGEVBinary(ctrl, "charging", "charging", BinarySensorDeviceClass.BATTERY_CHARGING),
            OGEVBinary(ctrl, "car_full", "car_full", None, "mdi:battery-check"),
            DataErrorBinary(ctrl),
        ]
    )


class OGEVBinary(OGEVEntity, BinarySensorEntity):
    def __init__(self, ctrl, key, attr, device_class, icon=None) -> None:
        super().__init__(ctrl, key, "binary_sensor")
        self._ctrl_attr = attr
        self._attr_device_class = device_class
        if icon:
            self._attr_icon = icon

    @property
    def is_on(self) -> bool:
        return bool(getattr(self.ctrl, self._ctrl_attr))


class DataErrorBinary(OGEVEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "data_error", "binary_sensor")

    @property
    def is_on(self) -> bool:
        return self.ctrl.data_error

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"missing_entities": self.ctrl.missing}
