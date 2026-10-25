"""Base entity for Off-Grid EV Charger."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN
from .controller import EVChargeController


class OGEVEntity(Entity):
    """Common base: device info, translation key, dispatcher updates."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, ctrl: EVChargeController, key: str, platform: str) -> None:
        self.ctrl = ctrl
        self._attr_translation_key = key
        self._attr_unique_id = f"{ctrl.entry.entry_id}_{key}"
        # Stable, predictable entity_id (e.g. sensor.ogev_energy_day)
        self.entity_id = f"{platform}.ogev_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, ctrl.entry.entry_id)},
            name=ctrl.entry.title,
            manufacturer="Off-Grid EV Charger",
            model="Szolár töltésvezérlő",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, self.ctrl.signal, self.async_write_ha_state)
        )
