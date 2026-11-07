"""Config flow for Off-Grid EV Charger."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import selector

from .carwings import find_cars
from .const import (
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CARWINGS_VIN,
    CONF_CHARGER_POWER,
    CONF_CHARGER_POWER_UNIT,
    CONF_CONTROL,
    CONF_CURRENT,
    CONF_EV_SOC,
    CONF_GRID_POWER,
    CONF_GRID_STATES,
    CONF_INVERTER_MODE,
    CONF_NAME,
    CONF_NOTIFY,
    CONF_PLUG,
    CONF_PLUG_STATES,
    CONF_POWER_SIGN,
    CONF_START_OPTION,
    CONF_STOP_OPTION,
    CARWINGS_NONE,
    DEFAULT_GRID_STATES,
    DEFAULT_NAME,
    DEFAULT_PLUG_STATES,
    DEFAULT_START_OPTION,
    DEFAULT_STOP_OPTION,
    DOMAIN,
    OPTIONAL_KEYS,
    SIGN_POS_CHARGE,
    SIGN_POS_DISCHARGE,
)


def _ent(domains: list[str]) -> selector.EntitySelector:
    return selector.EntitySelector(selector.EntitySelectorConfig(domain=domains))


def _sv(defaults: dict[str, Any], key: str, fallback: Any = None) -> dict[str, Any]:
    val = defaults.get(key, fallback)
    return {"suggested_value": val} if val not in (None, "") else {}


def _schema(hass: HomeAssistant, defaults: dict[str, Any], with_name: bool) -> vol.Schema:
    fields: dict[Any, Any] = {}
    cars = find_cars(hass)
    car_default = defaults.get(CONF_CARWINGS_VIN)
    if not car_default:
        car_default = next(iter(cars)) if len(cars) == 1 else CARWINGS_NONE
    car_options = [selector.SelectOptionDict(value=CARWINGS_NONE, label="—")] + [
        selector.SelectOptionDict(value=vin, label=label) for vin, label in cars.items()
    ]
    if car_default not in (CARWINGS_NONE, *cars):
        car_options.append(selector.SelectOptionDict(value=car_default, label=f"{car_default} (nem található)"))
    if with_name:
        fields[vol.Required(CONF_NAME, default=defaults.get(CONF_NAME, DEFAULT_NAME))] = str
    fields.update(
        {
            vol.Required(CONF_BATTERY_SOC, description=_sv(defaults, CONF_BATTERY_SOC, "sensor.akkumulator_soc")): _ent(["sensor", "input_number"]),
            vol.Required(CONF_BATTERY_POWER, description=_sv(defaults, CONF_BATTERY_POWER, "sensor.akkumulator_teljesitmeny")): _ent(["sensor", "input_number"]),
            vol.Required(CONF_POWER_SIGN, default=defaults.get(CONF_POWER_SIGN, SIGN_POS_DISCHARGE)): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[SIGN_POS_DISCHARGE, SIGN_POS_CHARGE],
                    translation_key="power_sign",
                    mode=selector.SelectSelectorMode.LIST,
                )
            ),
            vol.Required(CONF_CONTROL, description=_sv(defaults, CONF_CONTROL, "select.ev_charger_toggle_charging")): _ent(["select", "input_select", "switch", "input_boolean"]),
            vol.Optional(CONF_START_OPTION, default=defaults.get(CONF_START_OPTION, DEFAULT_START_OPTION)): str,
            vol.Optional(CONF_STOP_OPTION, default=defaults.get(CONF_STOP_OPTION, DEFAULT_STOP_OPTION)): str,
            vol.Required(CONF_CURRENT, description=_sv(defaults, CONF_CURRENT, "number.ev_charger_set_charge_current")): _ent(["number", "input_number"]),
            vol.Required(CONF_PLUG, description=_sv(defaults, CONF_PLUG)): _ent(["sensor", "binary_sensor", "switch", "input_boolean"]),
            vol.Optional(CONF_PLUG_STATES, default=defaults.get(CONF_PLUG_STATES, DEFAULT_PLUG_STATES)): str,
            vol.Optional(CONF_CHARGER_POWER, description=_sv(defaults, CONF_CHARGER_POWER)): _ent(["sensor"]),
            vol.Required(CONF_CHARGER_POWER_UNIT, default=defaults.get(CONF_CHARGER_POWER_UNIT, "W")): selector.SelectSelector(
                selector.SelectSelectorConfig(options=["W", "kW"], mode=selector.SelectSelectorMode.LIST)
            ),
            vol.Optional(CONF_INVERTER_MODE, description=_sv(defaults, CONF_INVERTER_MODE)): _ent(["sensor", "select", "binary_sensor", "input_select"]),
            vol.Optional(CONF_GRID_STATES, default=defaults.get(CONF_GRID_STATES, DEFAULT_GRID_STATES)): str,
            vol.Optional(CONF_GRID_POWER, description=_sv(defaults, CONF_GRID_POWER)): _ent(["sensor"]),
            vol.Required(CONF_CARWINGS_VIN, default=car_default): selector.SelectSelector(
                selector.SelectSelectorConfig(options=car_options, mode=selector.SelectSelectorMode.DROPDOWN)
            ),
            vol.Optional(CONF_EV_SOC, description=_sv(defaults, CONF_EV_SOC, "sensor.ev_becsult_soc")): _ent(["sensor", "input_number"]),
            vol.Optional(CONF_NOTIFY, description=_sv(defaults, CONF_NOTIFY)): str,
        }
    )
    return vol.Schema(fields)


def _validate(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, str]:
    errors: dict[str, str] = {}
    ctrl = data.get(CONF_CONTROL, "")
    if ctrl.split(".")[0] in ("select", "input_select"):
        st = hass.states.get(ctrl)
        options = st.attributes.get("options") if st else None
        if options and (
            data.get(CONF_START_OPTION) not in options or data.get(CONF_STOP_OPTION) not in options
        ):
            errors[CONF_START_OPTION] = "invalid_option"
    notify = (data.get(CONF_NOTIFY) or "").strip().removeprefix("notify.")
    if notify and not hass.services.has_service("notify", notify):
        errors[CONF_NOTIFY] = "invalid_notify"
    return errors


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    out = dict(data)
    for key in OPTIONAL_KEYS:
        out[key] = (out.get(key) or "").strip() if isinstance(out.get(key), str) else (out.get(key) or "")
    return out


class OGEVConfigFlow(ConfigFlow, domain=DOMAIN):
    """Initial setup."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _validate(self.hass, user_input)
            if not errors:
                data = _normalize(user_input)
                title = data.pop(CONF_NAME, DEFAULT_NAME)
                return self.async_create_entry(title=title, data=data)
        return self.async_show_form(
            step_id="user",
            data_schema=_schema(self.hass, user_input or {}, with_name=True),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OGEVOptionsFlow:
        return OGEVOptionsFlow()


class OGEVOptionsFlow(OptionsFlow):
    """Change the entity mapping later."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        current = {**self.config_entry.data, **self.config_entry.options}
        if user_input is not None:
            errors = _validate(self.hass, user_input)
            if not errors:
                return self.async_create_entry(data=_normalize(user_input))
            current = {**current, **user_input}
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(self.hass, current, with_name=False),
            errors=errors,
        )
