"""Reset statistics button."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .controller import EVChargeController
from .entity import OGEVEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([ResetButton(entry.runtime_data)])


class ResetButton(OGEVEntity, ButtonEntity):
    _attr_icon = "mdi:restart"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "reset_statistics", "button")

    async def async_press(self) -> None:
        await self.ctrl.async_reset_statistics()
