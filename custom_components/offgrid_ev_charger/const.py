"""Constants for the Off-Grid EV Charger integration."""
from __future__ import annotations

DOMAIN = "offgrid_ev_charger"
PLATFORMS = ["sensor", "binary_sensor", "select", "number", "button"]
STORAGE_VERSION = 1

# --- Config entry keys -------------------------------------------------
CONF_NAME = "name"
CONF_BATTERY_SOC = "battery_soc"
CONF_BATTERY_POWER = "battery_power"
CONF_POWER_SIGN = "power_sign"
CONF_CONTROL = "charger_control"
CONF_START_OPTION = "start_option"
CONF_STOP_OPTION = "stop_option"
CONF_CURRENT = "charge_current"
CONF_PLUG = "plug_entity"
CONF_PLUG_STATES = "plug_states"
CONF_CHARGER_POWER = "charger_power"
CONF_CHARGER_POWER_UNIT = "charger_power_unit"
CONF_EV_SOC = "ev_soc"
CONF_NOTIFY = "notify_service"

SIGN_POS_DISCHARGE = "positive_discharge"
SIGN_POS_CHARGE = "positive_charge"

DEFAULT_NAME = "EV töltő"
DEFAULT_START_OPTION = "Start charging"
DEFAULT_STOP_OPTION = "Stop charging"
DEFAULT_PLUG_STATES = (
    "connected, charging, charged, waiting, plugged, finished, full, "
    "charge_done, connected_waiting, on"
)

OPTIONAL_KEYS = (CONF_CHARGER_POWER, CONF_EV_SOC, CONF_NOTIFY)

# --- Modes -------------------------------------------------------------
MODE_SOLAR = "solar"
MODE_FAST = "fast"
MODE_TRICKLE = "trickle"
MODE_OFF = "off"
MODE_MANUAL = "manual"
MODES = [MODE_SOLAR, MODE_FAST, MODE_TRICKLE, MODE_OFF, MODE_MANUAL]
QUESTION_MODES = [MODE_SOLAR, MODE_FAST, MODE_TRICKLE]

# --- Timing / thresholds -----------------------------------------------
TICK_SECONDS = 30
DATA_ERROR_DELAY = 60          # s – missing data tolerated before safe stop
CAR_FULL_DELAY = 300           # s – enabled but < threshold → car full
SOLAR_SHORTAGE_DELAY = 120     # s – at min current still no surplus → stop
SOLAR_RESTART_DELAY = 300      # s – pause before solar restarts
UNPLUG_DELAY = 30              # s – debounce for unplugging
CHARGING_THRESHOLD_W = 100     # W – above this the car is really charging
SOC_HYSTERESIS = 5             # % – restart margin for fast / trickle

EVENT_NOTIFICATION_ACTION = "mobile_app_notification_action"
ACTION_PREFIX = "OGEV_"

PERIODS = ["session", "day", "week", "month", "year"]

# key: (min, max, step, default, unit, icon, is_config)
# unit "{cur}" is replaced by the HA currency.
PARAMS: dict[str, tuple] = {
    "target_soc": (10, 100, 1, 80, "%", "mdi:battery-charging-80", False),
    "max_current": (6, 32, 1, 16, "A", "mdi:current-ac", True),
    "min_current": (6, 16, 1, 6, "A", "mdi:current-ac", True),
    "trickle_current": (6, 16, 1, 6, "A", "mdi:water-outline", True),
    "voltage": (200, 250, 1, 230, "V", "mdi:sine-wave", True),
    "solar_start_soc": (20, 100, 1, 80, "%", "mdi:solar-power", True),
    "solar_stop_soc": (10, 100, 1, 60, "%", "mdi:solar-power-variant", True),
    "battery_full_soc": (80, 100, 1, 97, "%", "mdi:battery", True),
    "solar_reserve": (0, 3000, 50, 300, "W", "mdi:battery-arrow-up", True),
    "solar_allowed_discharge": (0, 2000, 50, 300, "W", "mdi:battery-arrow-down", True),
    "protect_soc": (5, 80, 1, 25, "%", "mdi:shield-half-full", True),
    "fast_min_soc": (5, 90, 1, 30, "%", "mdi:flash", True),
    "trickle_min_soc": (5, 90, 1, 40, "%", "mdi:water-outline", True),
    "max_battery_discharge": (1000, 15000, 100, 4500, "W", "mdi:flash-alert", True),
    "question_timeout": (1, 30, 1, 5, "min", "mdi:timer-sand", True),
    "ev_consumption": (5, 40, 0.5, 16, "kWh/100km", "mdi:car-electric", True),
    "petrol_consumption": (2, 20, 0.1, 7, "L/100km", "mdi:gas-station", True),
    "petrol_price": (100, 2000, 1, 620, "{cur}/L", "mdi:cash", True),
    "electricity_price": (0, 500, 1, 0, "{cur}/kWh", "mdi:cash", True),
}
