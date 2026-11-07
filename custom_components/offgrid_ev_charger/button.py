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
    ctrl: EVChargeController = entry.runtime_data
    entities: list[ButtonEntity] = [ResetButton(ctrl)]
    if ctrl.car is not None:
        entities.append(RefreshCarButton(ctrl))
    async_add_entities(entities)


class ResetButton(OGEVEntity, ButtonEntity):
    _attr_icon = "mdi:restart"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "reset_statistics", "button")

    async def async_press(self) -> None:
        await self.ctrl.async_reset_statistics()


class RefreshCarButton(OGEVEntity, ButtonEntity):
    """Ask the car (OpenCARWINGS) for fresh data."""

    _attr_icon = "mdi:car-connected"

    def __init__(self, ctrl: EVChargeController) -> None:
        super().__init__(ctrl, "refresh_car", "button")

    async def async_press(self) -> None:
        await self.ctrl.async_refresh_car()
