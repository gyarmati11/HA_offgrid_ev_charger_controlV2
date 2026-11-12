"""Off-Grid EV Charger – solar / fast / trickle EV charging for off-grid systems."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, PLATFORMS
from .controller import EVChargeController

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_FILE = "offgrid-ev-card.js"
CARD_URL = f"/{DOMAIN}/{CARD_FILE}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the Lovelace card and register it as a dashboard resource."""
    try:
        from homeassistant.components.http import StaticPathConfig

        path = Path(__file__).parent / "www" / CARD_FILE
        manifest = await hass.async_add_executor_job(
            (Path(__file__).parent / "manifest.json").read_text
        )
        version = json.loads(manifest).get("version", "0")
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL, str(path), False)]
        )
        await async_register_card_resource(hass, f"{CARD_URL}?v={version}")
    except Exception as err:  # noqa: BLE001 – the card is optional
        _LOGGER.warning("Could not register the Lovelace card: %s", err)
    return True


async def async_register_card_resource(hass: HomeAssistant, url: str) -> bool:
    """Add / update the card in the Lovelace resources (like HACS does).

    Lovelace resources are loaded by the dashboard itself, so the card is defined
    in the element registry the frontend uses – on desktop and in the mobile app.
    """
    data: Any = hass.data.get("lovelace")
    if data is None:
        _LOGGER.warning("Lovelace is not loaded – add %s as a dashboard resource manually", url)
        return False
    resources = getattr(data, "resources", None)
    if resources is None and isinstance(data, dict):
        resources = data.get("resources")
    if resources is None or not hasattr(resources, "async_create_item"):
        _LOGGER.warning(
            "Lovelace resources are in YAML mode. Add this to your resources: "
            "- url: %s  type: module",
            url,
        )
        return False
    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    base = url.split("?", 1)[0]
    found = False
    for item in list(resources.async_items() or []):
        item_url = str(item.get("url", ""))
        if item_url.split("?", 1)[0] != base:
            continue
        if found:  # duplicate entry – remove it
            await resources.async_delete_item(item["id"])
            continue
        found = True
        if item_url != url or item.get("type") != "module":
            await resources.async_update_item(item["id"], {"res_type": "module", "url": url})
            _LOGGER.info("Updated Lovelace resource %s", url)
    if not found:
        await resources.async_create_item({"res_type": "module", "url": url})
        _LOGGER.info("Registered Lovelace resource %s", url)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ctrl = EVChargeController(hass, entry)
    await ctrl.async_setup()
    entry.runtime_data = ctrl
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        await entry.runtime_data.async_shutdown()
    return ok


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
