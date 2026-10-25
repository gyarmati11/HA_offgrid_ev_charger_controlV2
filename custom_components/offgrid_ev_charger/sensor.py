"""Sensors: status, power, energy, km, savings, duration."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfEnergy, UnitOfLength, UnitOfPower, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import PERIODS
from .controller import MODE_LABELS, EVChargeController, format_duration
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    ctrl: EVChargeController = entry.runtime_data
    entities: list[SensorEntity] = [
        StatusSensor(ctrl),
        ChargerPowerSensor(ctrl),
        TotalEnergySensor(ctrl),
    ]
    for period in PERIODS:
        entities += [
            EnergySensor(ctrl, period),
            KmSensor(ctrl, period),
            SavingsSensor(ctrl, period),
            DurationSensor(ctrl, period),
        ]
    async_add_entities(entities)


class StatusSensor(OGEVEntity, SensorEntity):
    _attr_icon = "mdi:ev-station"

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "status", "sensor")

    @property
    def native_value(self) -> str:
        return self.ctrl.status

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        c = self.ctrl
        return {
            "mode": c.mode,
            "mode_label": MODE_LABELS.get(c.mode),
            "plugged": c.plugged,
            "charging": c.charging,
            "target_current": c.target_current,
            "question_pending": c.question_pending,
            "power_estimated": c.power_estimated,
            "missing_entities": c.missing,
        }


class ChargerPowerSensor(OGEVEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.POWER
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_suggested_display_precision = 0

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "charger_power", "sensor")

    @property
    def native_value(self) -> float:
        return self.ctrl.charger_power

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"estimated": self.ctrl.power_estimated}


class TotalEnergySensor(OGEVEntity, SensorEntity):
    """Lifetime counter – usable in the Energy dashboard."""

    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_suggested_display_precision = 2

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "energy_total", "sensor")

    @property
    def native_value(self) -> float:
        return round(self.ctrl.total_kwh, 3)


class _PeriodSensor(OGEVEntity, SensorEntity):
    metric = ""

    def __init__(self, ctrl: EVChargeController, period: str) -> None:
        super().__init__(ctrl, f"{self.metric}_{period}", "sensor")
        self.period = period

    @property
    def _stats(self) -> dict[str, float]:
        return self.ctrl.stats(self.period)


class EnergySensor(_PeriodSensor):
    metric = "energy"
    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL
    _attr_native_unit_of_measurement = UnitOfEnergy.KILO_WATT_HOUR
    _attr_suggested_display_precision = 2

    @property
    def native_value(self) -> float:
        return round(self._stats["kwh"], 3)

    @property
    def last_reset(self) -> datetime | None:
        return self.ctrl.period_start(self.period)


class KmSensor(_PeriodSensor):
    metric = "km"
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS
    _attr_suggested_display_precision = 1

    @property
    def native_value(self) -> float:
        return round(self._stats["km"], 1)


class SavingsSensor(_PeriodSensor):
    metric = "savings"
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_suggested_display_precision = 0
    _attr_icon = "mdi:piggy-bank-outline"

    @property
    def native_unit_of_measurement(self) -> str:
        return self.hass.config.currency

    @property
    def native_value(self) -> float:
        return round(self._stats["savings"], 0)


class DurationSensor(_PeriodSensor):
    metric = "duration"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_suggested_display_precision = 0
    _attr_icon = "mdi:timer-outline"

    @property
    def native_value(self) -> float:
        return round(self._stats["sec"] / 60, 1)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"formatted": format_duration(self._stats["sec"])}
