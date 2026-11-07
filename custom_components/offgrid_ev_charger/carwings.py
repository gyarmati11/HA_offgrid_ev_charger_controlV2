"""Link to the OpenCARWINGS integration (ha_opencarwings) – Nissan Leaf / e-NV200.

Entities are found through the entity registry by their stable unique IDs
(``ha_opencarwings_<key>_<VIN>``), so only the VIN has to be configured.
"""
from __future__ import annotations

from datetime import datetime
import logging
import math
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

CARWINGS_DOMAIN = "ha_opencarwings"
_INVALID = (STATE_UNKNOWN, STATE_UNAVAILABLE, "", "none", "None")

# key -> (entity domain, unique_id prefix)
ENTITIES: dict[str, tuple[str, str]] = {
    "soc": ("sensor", "ha_opencarwings_soc_"),
    "range_acoff": ("sensor", "ha_opencarwings_range_acoff_"),
    "range_acon": ("sensor", "ha_opencarwings_range_acon_"),
    "plugged_in": ("sensor", "ha_opencarwings_plugged_in_"),
    "charging": ("sensor", "ha_opencarwings_charging_"),
    "quick_charging": ("sensor", "ha_opencarwings_quick_charging_"),
    "charge_finish": ("sensor", "ha_opencarwings_charge_finish_"),
    "soh": ("sensor", "ha_opencarwings_soh_"),
    "cabin_temp": ("sensor", "ha_opencarwings_cabin_temp_"),
    "wh_content": ("sensor", "ha_opencarwings_wh_content_"),
    "last_updated": ("sensor", "ha_opencarwings_last_updated_"),
    "refresh": ("button", "ha_opencarwings_car_refresh_"),
    "ac": ("switch", "ha_opencarwings_ac_"),
}


def find_cars(hass: HomeAssistant) -> dict[str, str]:
    """Return {VIN: friendly label} for every car of the OpenCARWINGS integration."""
    reg = er.async_get(hass)
    cars: dict[str, str] = {}
    prefix = ENTITIES["soc"][1]
    for ent in reg.entities.values():
        if ent.platform != CARWINGS_DOMAIN or not ent.unique_id.startswith(prefix):
            continue
        vin = ent.unique_id[len(prefix):]
        if vin.startswith("display_") or not vin:
            continue
        name = (ent.name or ent.original_name or "").replace("State of Charge", "").strip()
        cars[vin] = f"{name} ({vin})" if name else vin
    return cars


def _bool(state: str | None) -> bool | None:
    if state is None:
        return None
    s = state.strip().lower()
    if s in ("true", "on", "plugged", "1", "yes"):
        return True
    if s in ("false", "off", "unplugged", "0", "no"):
        return False
    return None


class CarLink:
    """Reads the car state and sends commands through OpenCARWINGS."""

    def __init__(self, hass: HomeAssistant, vin: str) -> None:
        self.hass = hass
        self.vin = vin
        self._ids: dict[str, str] = {}

    def entity_id(self, key: str) -> str | None:
        if key in self._ids:
            return self._ids[key]
        domain, prefix = ENTITIES[key]
        eid = er.async_get(self.hass).async_get_entity_id(
            domain, CARWINGS_DOMAIN, f"{prefix}{self.vin}"
        )
        if eid:
            self._ids[key] = eid
        return eid

    def _state(self, key: str):
        eid = self.entity_id(key)
        st = self.hass.states.get(eid) if eid else None
        if st is None or st.state in _INVALID:
            return None
        return st

    def _num(self, key: str) -> float | None:
        st = self._state(key)
        if st is None:
            return None
        try:
            val = float(st.state)
        except (TypeError, ValueError):
            return None
        return val if math.isfinite(val) else None

    def read(self) -> dict[str, Any]:
        soc_state = self._state("soc")
        ts: datetime | None = None
        lu = self._state("last_updated")
        if lu is not None:
            ts = dt_util.parse_datetime(lu.state)
        if ts is None and soc_state is not None:
            ts = soc_state.last_updated
        ac = self._state("ac")
        plugged = self._state("plugged_in")
        charging = self._state("charging")
        quick = self._state("quick_charging")
        finish = self._state("charge_finish")
        return {
            "found": self.entity_id("soc") is not None,
            "soc": self._num("soc"),
            "range_acoff": self._num("range_acoff"),
            "range_acon": self._num("range_acon"),
            "soh": self._num("soh"),
            "cabin_temp": self._num("cabin_temp"),
            "wh_content": self._num("wh_content"),
            "plugged": _bool(plugged.state) if plugged else None,
            "charging": (
                bool(_bool(charging.state) or (_bool(quick.state) if quick else False))
                if charging
                else None
            ),
            "charge_finish": _bool(finish.state) if finish else None,
            "ac_on": (ac.state == "on") if ac else None,
            "updated": ts,
            "refresh_entity": self.entity_id("refresh"),
            "ac_entity": self.entity_id("ac"),
        }

    async def async_refresh(self) -> bool:
        eid = self.entity_id("refresh")
        if not eid:
            return False
        try:
            await self.hass.services.async_call(
                "button", "press", {"entity_id": eid}, blocking=False
            )
            return True
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("OpenCARWINGS refresh failed: %s", err)
            return False
