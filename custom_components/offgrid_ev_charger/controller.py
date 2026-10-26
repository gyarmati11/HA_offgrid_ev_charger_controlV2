"""Charging controller – the brain of the Off-Grid EV Charger integration."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
import math
from typing import Any

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, State, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    ACTION_PREFIX,
    CAR_FULL_DELAY,
    CHARGER_OFFLINE_NOTIFY_MIN,
    CHARGING_THRESHOLD_W,
    CONF_BATTERY_POWER,
    CONF_BATTERY_SOC,
    CONF_CHARGER_POWER,
    CONF_CHARGER_POWER_UNIT,
    CONF_CONTROL,
    CONF_CURRENT,
    CONF_EV_SOC,
    CONF_NOTIFY,
    CONF_PLUG,
    CONF_PLUG_STATES,
    CONF_POWER_SIGN,
    CONF_START_OPTION,
    CONF_STOP_OPTION,
    DATA_ERROR_DELAY,
    DEFAULT_PLUG_STATES,
    DEFAULT_START_OPTION,
    DEFAULT_STOP_OPTION,
    DOMAIN,
    EVENT_NOTIFICATION_ACTION,
    MODE_FAST,
    MODE_MANUAL,
    MODE_OFF,
    MODE_SOLAR,
    MODE_TRICKLE,
    MODES,
    PARAMS,
    QUESTION_MODES,
    SIGN_POS_CHARGE,
    SOC_HYSTERESIS,
    SOLAR_RESTART_DELAY,
    SOLAR_SHORTAGE_DELAY,
    STORAGE_VERSION,
    TICK_SECONDS,
    UNPLUG_DELAY,
)

_LOGGER = logging.getLogger(__name__)

_INVALID = (STATE_UNKNOWN, STATE_UNAVAILABLE, "", "none", "None")
_CAL_PERIODS = ("day", "week", "month", "year")

MODE_LABELS = {
    MODE_SOLAR: "☀️ Szolár",
    MODE_FAST: "⚡ Gyors",
    MODE_TRICKLE: "💧 Csepp",
    MODE_OFF: "⏸️ Kikapcsolva",
    MODE_MANUAL: "🖐️ Kézi",
}


def format_duration(seconds: float) -> str:
    """Return 'H ó MM p'."""
    minutes = int(round(seconds / 60))
    return f"{minutes // 60} ó {minutes % 60:02d} p"


class EVChargeController:
    """Reads the inverter/charger entities and drives the charger."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.signal = f"{DOMAIN}_{entry.entry_id}_update"
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")

        # persisted
        self.mode: str = MODE_SOLAR
        self.params: dict[str, float] = {k: float(v[3]) for k, v in PARAMS.items()}
        self.total_kwh = 0.0
        self.periods: dict[str, dict[str, Any]] = {
            p: {"key": None, "kwh": 0.0, "sec": 0.0} for p in _CAL_PERIODS
        }
        self.session: dict[str, Any] = {"kwh": 0.0, "sec": 0.0, "start": None}

        # runtime
        self.status = "⏳ Indulás…"
        self.charger_power = 0.0
        self.power_estimated = True
        self.plugged = False
        self.charging = False
        self.car_full = False
        self.data_error = False
        self.missing: list[str] = []
        self.target_current: int | None = None
        self.question_pending = False
        self.question_deadline: datetime | None = None
        self.readings: dict[str, Any] = {}

        self._unsubs: list[CALLBACK_TYPE] = []
        self._lock = asyncio.Lock()
        self._rerun = False
        self._last_tick: datetime | None = None
        self._missing_since: datetime | None = None
        self._full_since: datetime | None = None
        self._short_since: datetime | None = None
        self._last_stop: datetime | None = None
        self._last_current: int | None = None
        self._sent_current: int | None = None
        self._cmd_enabled = False
        self._want_charge = False
        self._offline_since: datetime | None = None
        self._offline_notified = False
        self.charger_offline = False
        self.charger_missing: list[str] = []
        self._unplug_timer: CALLBACK_TYPE | None = None
        self._question_timer: CALLBACK_TYPE | None = None

    # ------------------------------------------------------------------
    # Setup / teardown
    # ------------------------------------------------------------------
    @property
    def cfg(self) -> dict[str, Any]:
        return {**self.entry.data, **self.entry.options}

    async def async_setup(self) -> None:
        data = await self._store.async_load() or {}
        if data.get("mode") in MODES:
            self.mode = data["mode"]
        for key, val in (data.get("params") or {}).items():
            if key in PARAMS:
                try:
                    self.params[key] = float(val)
                except (TypeError, ValueError):
                    pass
        self.total_kwh = float(data.get("total_kwh", 0.0))
        for period, val in (data.get("periods") or {}).items():
            if period in self.periods and isinstance(val, dict):
                self.periods[period].update(val)
        if isinstance(data.get("session"), dict):
            self.session.update(data["session"])
        self._rollover()

        self.plugged = bool(self._raw_plugged())

        self._unsubs.append(
            async_track_time_interval(
                self.hass, self._async_tick, timedelta(seconds=TICK_SECONDS)
            )
        )
        self._unsubs.append(
            async_track_state_change_event(
                self.hass, [self.cfg[CONF_PLUG]], self._plug_changed
            )
        )
        self._unsubs.append(
            self.hass.bus.async_listen(EVENT_NOTIFICATION_ACTION, self._on_action)
        )
        self._unsubs.append(async_call_later(self.hass, 5, self._async_tick))

    async def async_shutdown(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self._cancel_timers()
        await self._store.async_save(self._data())

    def _cancel_timers(self) -> None:
        if self._unplug_timer:
            self._unplug_timer()
            self._unplug_timer = None
        if self._question_timer:
            self._question_timer()
            self._question_timer = None

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def _data(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "params": self.params,
            "total_kwh": self.total_kwh,
            "periods": self.periods,
            "session": self.session,
        }

    def _save(self) -> None:
        self._store.async_delay_save(self._data, 60)

    # ------------------------------------------------------------------
    # Public API for entities
    # ------------------------------------------------------------------
    @callback
    def _update(self) -> None:
        async_dispatcher_send(self.hass, self.signal)

    async def async_set_mode(self, mode: str, from_user: bool = True) -> None:
        if mode not in MODES:
            return
        self.mode = mode
        self._save()
        if from_user and self.question_pending:
            await self._close_question()
        self._update()
        self.async_request_tick()

    async def async_set_param(self, key: str, value: float) -> None:
        self.params[key] = float(value)
        self._save()
        self._update()
        self.async_request_tick()

    async def async_reset_statistics(self) -> None:
        self.total_kwh = 0.0
        for period in self.periods.values():
            period["kwh"] = 0.0
            period["sec"] = 0.0
        self.session.update({"kwh": 0.0, "sec": 0.0})
        await self._store.async_save(self._data())
        self._update()

    @callback
    def async_request_tick(self) -> None:
        self.hass.async_create_task(self._async_tick())

    def stats(self, period: str) -> dict[str, float]:
        src = self.session if period == "session" else self.periods[period]
        kwh = float(src.get("kwh", 0.0))
        sec = float(src.get("sec", 0.0))
        cons = self.params["ev_consumption"] or 16.0
        km = kwh / cons * 100
        litres = km * self.params["petrol_consumption"] / 100
        savings = litres * self.params["petrol_price"] - kwh * self.params["electricity_price"]
        return {"kwh": kwh, "sec": sec, "km": km, "savings": savings}

    def period_start(self, period: str) -> datetime | None:
        if period == "session":
            start = self.session.get("start")
            return dt_util.parse_datetime(start) if start else None
        now = dt_util.now()
        day = dt_util.start_of_local_day(now)
        if period == "day":
            return day
        if period == "week":
            return day - timedelta(days=now.weekday())
        if period == "month":
            return day.replace(day=1)
        return day.replace(month=1, day=1)

    # ------------------------------------------------------------------
    # Entity helpers
    # ------------------------------------------------------------------
    def _state(self, entity_id: str | None) -> State | None:
        if not entity_id:
            return None
        st = self.hass.states.get(entity_id)
        if st is None or st.state in _INVALID:
            return None
        return st

    def _num(self, entity_id: str | None) -> float | None:
        st = self._state(entity_id)
        if st is None:
            return None
        try:
            val = float(st.state)
        except (TypeError, ValueError):
            return None
        return val if math.isfinite(val) else None

    def _raw_plugged(self) -> bool | None:
        st = self._state(self.cfg.get(CONF_PLUG))
        if st is None:
            return None
        if st.domain in ("binary_sensor", "switch", "input_boolean"):
            return st.state == STATE_ON
        allowed = [
            s.strip().lower()
            for s in str(self.cfg.get(CONF_PLUG_STATES) or DEFAULT_PLUG_STATES).split(",")
            if s.strip()
        ]
        return st.state.lower() in allowed

    def _charger_enabled(self, st: State | None) -> bool:
        if st is None:
            return False
        if st.domain in ("switch", "input_boolean"):
            return st.state == STATE_ON
        return st.state == (self.cfg.get(CONF_START_OPTION) or DEFAULT_START_OPTION)

    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> None:
        try:
            async with asyncio.timeout(10):
                await self.hass.services.async_call(domain, service, data, blocking=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("%s.%s failed (%s): %s", domain, service, data, err)

    async def _set_enabled(self, on: bool) -> None:
        eid = self.cfg[CONF_CONTROL]
        domain = eid.split(".")[0]
        if domain in ("switch", "input_boolean"):
            await self._call(domain, "turn_on" if on else "turn_off", {"entity_id": eid})
        else:
            option = (
                self.cfg.get(CONF_START_OPTION) or DEFAULT_START_OPTION
                if on
                else self.cfg.get(CONF_STOP_OPTION) or DEFAULT_STOP_OPTION
            )
            await self._call(domain, "select_option", {"entity_id": eid, "option": option})

    async def _set_current(self, amps: int) -> None:
        eid = self.cfg[CONF_CURRENT]
        st = self.hass.states.get(eid)
        if st is not None:
            lo = st.attributes.get("min")
            hi = st.attributes.get("max")
            if lo is not None:
                amps = max(amps, int(math.ceil(float(lo))))
            if hi is not None:
                amps = min(amps, int(float(hi)))
        await self._call(eid.split(".")[0], "set_value", {"entity_id": eid, "value": amps})

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    def _nid(self, tag: str) -> str:
        return f"{DOMAIN}_{self.entry.entry_id}_{tag}"

    async def _notify(
        self, title: str, message: str, tag: str, actions: list[dict] | None = None
    ) -> None:
        nid = self._nid(tag)
        persistent_notification.async_create(self.hass, message, title, nid)
        service = (self.cfg.get(CONF_NOTIFY) or "").strip()
        if not service:
            return
        service = service.removeprefix("notify.")
        payload: dict[str, Any] = {"title": title, "message": message, "data": {"tag": nid}}
        if actions:
            payload["data"]["actions"] = actions
        try:
            await self.hass.services.async_call("notify", service, payload, blocking=False)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Notification via notify.%s failed: %s", service, err)

    async def _clear(self, tag: str) -> None:
        nid = self._nid(tag)
        persistent_notification.async_dismiss(self.hass, nid)
        service = (self.cfg.get(CONF_NOTIFY) or "").strip().removeprefix("notify.")
        if service:
            try:
                await self.hass.services.async_call(
                    "notify",
                    service,
                    {"message": "clear_notification", "data": {"tag": nid}},
                    blocking=False,
                )
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    # Plug handling and mode question
    # ------------------------------------------------------------------
    @callback
    def _plug_changed(self, event: Event) -> None:
        raw = self._raw_plugged()
        if raw is None:
            return  # unavailable – handled by data error logic
        if raw:
            if self._unplug_timer:
                self._unplug_timer()
                self._unplug_timer = None
            if not self.plugged:
                self.plugged = True
                self.hass.async_create_task(self._on_plugged())
        elif self.plugged and self._unplug_timer is None:
            self._unplug_timer = async_call_later(
                self.hass, UNPLUG_DELAY, self._confirm_unplug
            )

    async def _on_plugged(self) -> None:
        self.session = {"kwh": 0.0, "sec": 0.0, "start": dt_util.utcnow().isoformat()}
        self.mode = MODE_SOLAR
        self._save()
        timeout = int(self.params["question_timeout"])
        soc = self._num(self.cfg[CONF_BATTERY_SOC])
        ev_soc = self._num(self.cfg.get(CONF_EV_SOC))
        msg = "Milyen módon töltsünk?"
        if soc is not None:
            msg += f" Ház-akku: {round(soc)}%."
        if ev_soc is not None:
            msg += f" Autó: ~{round(ev_soc)}%."
        msg += f" {timeout} perc múlva automatikusan Szolár."
        suffix = f"_{self.entry.entry_id}"
        actions = [
            {"action": f"{ACTION_PREFIX}{m.upper()}{suffix}", "title": MODE_LABELS[m]}
            for m in QUESTION_MODES
        ]
        self.question_pending = True
        self.question_deadline = dt_util.utcnow() + timedelta(minutes=timeout)
        await self._notify("🔌 Autó csatlakoztatva", msg, "question", actions)
        if self._question_timer:
            self._question_timer()
        self._question_timer = async_call_later(
            self.hass, timeout * 60, self._question_timeout
        )
        self._update()
        self.async_request_tick()

    async def _question_timeout(self, _now: datetime) -> None:
        self._question_timer = None
        if not self.question_pending:
            return
        await self._close_question()
        await self.async_set_mode(MODE_SOLAR, from_user=False)

    async def _close_question(self) -> None:
        self.question_pending = False
        self.question_deadline = None
        if self._question_timer:
            self._question_timer()
            self._question_timer = None
        await self._clear("question")
        self._update()

    @callback
    def _on_action(self, event: Event) -> None:
        action = str(event.data.get("action", ""))
        suffix = f"_{self.entry.entry_id}"
        if not (action.startswith(ACTION_PREFIX) and action.endswith(suffix)):
            return
        mode = action[len(ACTION_PREFIX) : -len(suffix)].lower()
        if mode in MODES:
            self.hass.async_create_task(self.async_set_mode(mode, from_user=True))

    async def _confirm_unplug(self, _now: datetime) -> None:
        self._unplug_timer = None
        if self._raw_plugged() is not False:
            return
        self.plugged = False
        if self.question_pending:
            await self._close_question()
        st = self.stats("session")
        if st["kwh"] > 0.05:
            await self._notify(
                "🚗 Töltés vége",
                f"{st['kwh']:.2f} kWh ≈ {st['km']:.0f} km, "
                f"töltési idő: {format_duration(st['sec'])}, "
                f"megtakarítás: {st['savings']:.0f} {self.hass.config.currency}. "
                f"Ma összesen: {self.stats('day')['kwh']:.2f} kWh.",
                "summary",
            )
        await self._clear("full")
        self._update()
        self.async_request_tick()

    # ------------------------------------------------------------------
    # Energy accounting
    # ------------------------------------------------------------------
    def _rollover(self) -> None:
        now = dt_util.now()
        iso = now.isocalendar()
        keys = {
            "day": now.date().isoformat(),
            "week": f"{iso[0]}-W{iso[1]:02d}",
            "month": now.strftime("%Y-%m"),
            "year": str(now.year),
        }
        for period, key in keys.items():
            if self.periods[period].get("key") != key:
                self.periods[period] = {"key": key, "kwh": 0.0, "sec": 0.0}

    def _account(self, dt: float) -> None:
        self._rollover()
        if dt <= 0:
            return
        kwh = self.charger_power * dt / 3_600_000
        sec = dt if self.charger_power > CHARGING_THRESHOLD_W else 0.0
        self.total_kwh += kwh
        for period in self.periods.values():
            period["kwh"] += kwh
            period["sec"] += sec
        if self.plugged:
            self.session["kwh"] = float(self.session.get("kwh", 0.0)) + kwh
            self.session["sec"] = float(self.session.get("sec", 0.0)) + sec
        if kwh or sec:
            self._save()

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------
    async def _async_tick(self, _now: datetime | None = None) -> None:
        if self._lock.locked():
            self._rerun = True
            return
        async with self._lock:
            self._rerun = True
            while self._rerun:
                self._rerun = False
                try:
                    await self._run()
                except Exception:  # noqa: BLE001
                    _LOGGER.exception("EV charge controller tick failed")

    async def _run(self) -> None:
        cfg = self.cfg
        P = self.params
        now = dt_util.utcnow()
        dt = 0.0
        if self._last_tick is not None:
            dt = min(max((now - self._last_tick).total_seconds(), 0.0), 120.0)
        self._last_tick = now
        self._account(dt)

        soc = self._num(cfg[CONF_BATTERY_SOC])
        p_raw = self._num(cfg[CONF_BATTERY_POWER])
        ctrl = self._state(cfg[CONF_CONTROL])
        cur = self._num(cfg[CONF_CURRENT])
        plug_raw = self._raw_plugged()

        # Critical: only the house battery data. Without it we cannot protect the battery.
        missing = [
            eid
            for eid, ok in (
                (cfg[CONF_BATTERY_SOC], soc is not None),
                (cfg[CONF_BATTERY_POWER], p_raw is not None),
            )
            if not ok
        ]
        # Charger side: many chargers report "unknown" current while stopped or drop
        # off Wi-Fi when idle. That is not dangerous – we simply cannot command them.
        self.charger_missing = [
            eid
            for eid, ok in (
                (cfg[CONF_CONTROL], ctrl is not None),
                (cfg[CONF_PLUG], plug_raw is not None),
            )
            if not ok
        ]
        self.missing = missing
        if missing:
            self._missing_since = self._missing_since or now
            error = (now - self._missing_since).total_seconds() >= DATA_ERROR_DELAY
        else:
            self._missing_since = None
            error = False
        if error and not self.data_error:
            await self._notify(
                "⚠️ EV töltés – hiányzó ház-akku adat",
                f"Nem elérhető: {', '.join(missing)}. A töltés biztonsági okból leállt, "
                "az adatok visszatérésekor automatikusan folytatódik.",
                "error",
            )
        elif not error and self.data_error:
            await self._clear("error")
        self.data_error = error

        p = None
        if p_raw is not None:
            p = -p_raw if cfg.get(CONF_POWER_SIGN) == SIGN_POS_CHARGE else p_raw

        # Current: fall back to the last known / last commanded value when unknown.
        if cur is not None:
            current = int(round(cur))
            self._last_current = current
        else:
            current = int(self._last_current or P["min_current"])

        # Measured charger power (needed below to guess the on/off state if unknown)
        cp_meas = self._num(cfg.get(CONF_CHARGER_POWER))
        if cp_meas is not None and cfg.get(CONF_CHARGER_POWER_UNIT) == "kW":
            cp_meas *= 1000

        if ctrl is not None:
            enabled = self._charger_enabled(ctrl)
        elif cp_meas is not None and cp_meas > CHARGING_THRESHOLD_W:
            enabled = True
        else:
            enabled = self._cmd_enabled
        ev_soc = self._num(cfg.get(CONF_EV_SOC))

        # --- charger power (measured or estimated)
        if cp_meas is not None:
            cp = cp_meas
            self.power_estimated = False
        else:
            self.power_estimated = True
            cp = current * P["voltage"] if (enabled and self.plugged and ctrl is not None) else 0.0
        self.charger_power = float(max(round(cp), 0))
        self.charging = self.charger_power > CHARGING_THRESHOLD_W

        self.readings = {
            "battery_soc": soc,
            "battery_power": p,
            "ev_soc": ev_soc,
            "charge_current": current if (cur is not None or enabled) else None,
            "charge_current_known": cur is not None,
            "charger_enabled": enabled,
        }

        # --- car full: enabled, plugged, measured power below threshold for 5 min
        if (
            self.plugged
            and enabled
            and ctrl is not None
            and not self.power_estimated
            and self.charger_power < CHARGING_THRESHOLD_W
        ):
            self._full_since = self._full_since or now
            full = (now - self._full_since).total_seconds() >= CAR_FULL_DELAY
        else:
            self._full_since = None
            full = False
        if full and not self.car_full:
            st = self.stats("session")
            await self._notify(
                "🔋 Az autó feltöltött",
                "Csatlakoztatva van, de nem vesz fel áramot. "
                f"Ez az alkalom: {st['kwh']:.2f} kWh (~{st['km']:.0f} km), "
                f"{format_duration(st['sec'])}, megtakarítás: "
                f"{st['savings']:.0f} {self.hass.config.currency}.",
                "full",
            )
        self.car_full = full

        if missing and not error:
            self.status = f"⏳ Ház-akku adatra várakozás: {', '.join(missing)}"[:255]
            self._update()
            return

        # --- charger unreachable: nothing to command, wait for it
        if ctrl is None:
            self._offline_since = self._offline_since or now
            mins = int((now - self._offline_since).total_seconds() // 60)
            self.charger_offline = True
            if (
                self._want_charge
                and self.plugged
                and mins >= CHARGER_OFFLINE_NOTIFY_MIN
                and not self._offline_notified
            ):
                self._offline_notified = True
                await self._notify(
                    "📡 EV töltő nem elérhető",
                    f"A töltő {mins} perce nem érhető el ({cfg[CONF_CONTROL]}), "
                    "pedig töltenie kellene. Visszatéréskor automatikusan folytatódik.",
                    "offline",
                )
            self.status = (
                "📡 Töltő nem elérhető"
                + (f" ({mins} perce)" if mins else "")
                + " – visszatéréskor folytatódik"
            )
            self.target_current = None
            self._update()
            return
        if self.charger_offline:
            self.charger_offline = False
            self._offline_since = None
            if self._offline_notified:
                self._offline_notified = False
                await self._clear("offline")
            self._sent_current = None  # charger may have restarted: resend

        enable, amps, msg = self._plan(now, error, soc, p, enabled, current, ev_soc, ctrl)
        if enable is not None:
            self._want_charge = enable

        if enable is True:
            if amps is not None and (
                (cur is not None and amps != current)
                or (cur is None and amps != self._sent_current)
            ):
                await self._set_current(amps)
                self._sent_current = amps
                self._last_current = amps
            if not enabled:
                if amps is not None and self._sent_current is None:
                    # make sure the charger starts with a defined current
                    await self._set_current(amps)
                    self._sent_current = amps
                    self._last_current = amps
                await self._set_enabled(True)
            self._cmd_enabled = True
        elif enable is False:
            if enabled:
                await self._set_enabled(False)
                self._last_stop = now
            # Do NOT touch the current while stopped – several chargers reject it
            # and report "unknown" afterwards. It is set again right before start.
            self._cmd_enabled = False
            self._sent_current = None

        self.target_current = amps if enable else None
        self.status = msg[:255]
        self._update()

    # ------------------------------------------------------------------
    # Decision logic
    # ------------------------------------------------------------------
    def _plan(
        self,
        now: datetime,
        error: bool,
        soc: float | None,
        p: float | None,
        enabled: bool,
        current: int,
        ev_soc: float | None,
        ctrl: State | None,
    ) -> tuple[bool | None, int | None, str]:
        """Return (enable?, amps, status). enable=None → leave charger alone."""
        P = self.params
        U = P["voltage"] or 230.0
        min_a = int(P["min_current"])
        max_a = max(int(P["max_current"]), min_a)
        mode = self.mode
        if mode != MODE_SOLAR:
            self._short_since = None

        if not self.plugged:
            return False, min_a, "🔌 Nincs autó csatlakoztatva"
        if error:
            return False, None, f"⚠️ Nem elérhető: {', '.join(self.missing)} – biztonsági leállítás"
        if mode == MODE_MANUAL:
            return None, None, "🖐️ Kézi mód – az integráció nem vezérli a töltőt"
        if mode == MODE_OFF:
            return False, None, "⏸️ Töltés kikapcsolva"

        assert soc is not None and p is not None
        socr = round(soc)
        target = P["target_soc"]
        if ev_soc is not None and ev_soc >= target:
            return False, None, f"✅ Cél elérve: {round(ev_soc)}% / {round(target)}%"
        if self.car_full:
            return None, None, "🔋 Autó feltöltve – csatlakoztatva, nem vesz fel áramot"
        if soc < P["protect_soc"]:
            return (
                False,
                None,
                f"🛑 Ház-akku {socr}% – védelmi szint ({round(P['protect_soc'])}%) alatt",
            )

        # ---------------- Trickle ----------------
        if mode == MODE_TRICKLE:
            limit = P["trickle_min_soc"] + (0 if enabled else SOC_HYSTERESIS)
            if soc < limit:
                return False, None, f"💧 Csepp szünetel – ház-akku {socr}% < {round(limit)}%"
            amps = min(max(int(P["trickle_current"]), min_a), max_a)
            return True, amps, f"💧 Csepptöltés · {amps} A · ház-akku {socr}%"

        # ---------------- Fast ----------------
        if mode == MODE_FAST:
            limit = P["fast_min_soc"] + (0 if enabled else SOC_HYSTERESIS)
            if soc < limit:
                return False, None, f"⚡ Gyors szünetel – ház-akku {socr}% < {round(limit)}%"
            max_dis = P["max_battery_discharge"]
            if not enabled:
                amps, label = min_a, "⚡ Gyorstöltés indul"
            elif p > max_dis:
                amps = current - math.ceil((p - max_dis) / U)
                label = "⚡ Gyors · inverter/akku limit miatt visszafogva"
            else:
                amps = current + min(2, math.floor((max_dis - p) / U))
                label = "⚡ Gyorstöltés"
            amps = min(max(amps, min_a), max_a)
            return True, amps, f"{label} · {amps} A · ház-akku {socr}%"

        # ---------------- Solar ----------------
        full = soc >= P["battery_full_soc"]
        goal = P["solar_allowed_discharge"] if full else -P["solar_reserve"]
        err = p - goal  # >0 → too much drawn from battery

        if not enabled:
            self._short_since = None
            surplus = round(-p - P["solar_reserve"])
            if soc < P["solar_start_soc"]:
                return (
                    False,
                    None,
                    f"☀️ Szolár vár – ház-akku {socr}% (indul {round(P['solar_start_soc'])}% felett)",
                )
            since = (now - self._last_stop).total_seconds() if self._last_stop else 1e9
            if since < SOLAR_RESTART_DELAY:
                return False, None, "☀️ Szolár vár – újraindítási szünet"
            if surplus >= min_a * U:
                return True, min_a, f"☀️ Szolár indul – felesleg {surplus} W"
            if full and p <= 50:
                return True, min_a, "☀️ Szolár indul – ház-akku tele, rejtett PV keresése"
            return False, None, f"☀️ Szolár vár – kevés felesleg ({max(surplus, 0)} W)"

        if soc < P["solar_stop_soc"]:
            return (
                False,
                min_a,
                f"☀️ Szolár leáll – ház-akku {socr}% < {round(P['solar_stop_soc'])}%",
            )

        if current <= min_a and err > 300:
            self._short_since = self._short_since or now
            if (now - self._short_since).total_seconds() >= SOLAR_SHORTAGE_DELAY:
                self._short_since = None
                return False, min_a, "☀️ Szolár leáll – tartósan nincs felesleg"
        else:
            self._short_since = None

        if err > 0:
            delta = -math.ceil(err / U)
        elif err < -U:
            delta = min(math.floor(-err / U), 3)
        else:
            delta = 0
        amps = min(max(current + delta, min_a), max_a)
        arrow = "↑" if amps > current else ("↓" if amps < current else "=")
        msg = f"☀️ Szolár · {amps} A {arrow} · ház-akku {socr}%"
        if full:
            msg += " · PV keresés"
        return True, amps, msg
