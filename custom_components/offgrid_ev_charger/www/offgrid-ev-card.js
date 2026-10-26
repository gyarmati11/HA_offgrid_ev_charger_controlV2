/*
 * Off-Grid EV Charger – Lovelace card
 * Loaded automatically by the offgrid_ev_charger integration.
 *
 *   type: custom:offgrid-ev-card
 *   prefix: ogev          # optional, auto-detected
 *   title: Autótöltés     # optional
 */
const CARD_VERSION = "1.1.1";

const MODES = [
  { id: "solar", label: "Szolár", icon: "mdi:solar-power-variant", color: "#F5A524", hint: "csak napelem-felesleg" },
  { id: "fast", label: "Gyors", icon: "mdi:lightning-bolt", color: "#3D7BF7", hint: "a lehető leggyorsabban" },
  { id: "trickle", label: "Csepp", icon: "mdi:water", color: "#14B8A6", hint: "alacsony áram" },
  { id: "off", label: "Ki", icon: "mdi:pause", color: "#8E8E93", hint: "nem tölt" },
];
const MANUAL = { id: "manual", label: "Kézi", icon: "mdi:hand-back-right", color: "#8E8E93", hint: "nincs vezérlés" };
const PERIODS = [
  { id: "day", label: "Ma" },
  { id: "week", label: "Hét" },
  { id: "month", label: "Hónap" },
  { id: "year", label: "Év" },
];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (v, digits = 0) =>
  v === null || v === undefined
    ? "–"
    : Number(v).toLocaleString("hu-HU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kwh = (v) => (v === null ? "–" : fmt(v, v < 10 ? 2 : 1));
const kw = (w) => (w === null ? "–" : Math.abs(w) < 1000 ? `${fmt(w)} W` : `${fmt(w / 1000, 2)} kW`);
const money = (v) => (v === null ? "–" : Math.abs(v) >= 100000 ? `${fmt(v / 1000, 0)} e` : fmt(v));
const stripEmoji = (s) => String(s || "").replace(/^[^\p{L}\p{N}]+/u, "");

class OffgridEvCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._period = "day";
    this._dragging = false;
    this._pendingMode = null;
    this._sig = "";
  }

  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        { name: "prefix", selector: { text: {} } },
      ],
      computeLabel: (s) => ({ title: "Cím (opcionális)", prefix: "Entitás előtag (alap: ogev)" })[s.name],
    };
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    this._sig = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback() {
    this._tick();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ------------------------------------------------------------ data
  _prefix() {
    if (this._config?.prefix) return this._config.prefix;
    if (this._hass.states["sensor.ogev_status"]) return "ogev";
    const found = Object.keys(this._hass.states).find(
      (id) =>
        id.startsWith("sensor.") &&
        id.endsWith("_status") &&
        "question_pending" in (this._hass.states[id].attributes || {}) &&
        "mode_label" in (this._hass.states[id].attributes || {})
    );
    return found ? found.slice(7, -7) : "ogev";
  }

  _id(domain, key) {
    return `${domain}.${this._prefix()}_${key}`;
  }

  _st(domain, key) {
    return this._hass.states[this._id(domain, key)];
  }

  _val(domain, key) {
    const s = this._st(domain, key);
    return s ? num(s.state) : null;
  }

  _collect() {
    const status = this._st("sensor", "status");
    if (!status) return null;
    const a = status.attributes || {};
    const stats = {};
    for (const p of ["session", ...PERIODS.map((x) => x.id)]) {
      stats[p] = {
        kwh: this._val("sensor", `energy_${p}`),
        km: this._val("sensor", `km_${p}`),
        savings: this._val("sensor", `savings_${p}`),
        time: this._st("sensor", `duration_${p}`)?.attributes?.formatted ?? null,
      };
    }
    const unit = this._st("sensor", "savings_day")?.attributes?.unit_of_measurement || "";
    const modeState = this._st("select", "mode")?.state;
    return {
      status: status.state,
      mode: this._pendingMode || modeState || a.mode,
      plugged: !!a.plugged,
      charging: !!a.charging,
      question: !!a.question_pending,
      deadline: a.question_deadline || null,
      missing: a.missing_entities || [],
      offline: !!a.charger_offline,
      battSoc: num(a.battery_soc),
      battPower: num(a.battery_power),
      evSoc: num(a.ev_soc),
      current: num(a.charge_current),
      power: this._val("sensor", "charger_power"),
      estimated: !!this._st("sensor", "charger_power")?.attributes?.estimated,
      target: this._val("number", "target_soc"),
      targetMin: this._st("number", "target_soc")?.attributes?.min ?? 10,
      targetMax: this._st("number", "target_soc")?.attributes?.max ?? 100,
      full: this._st("binary_sensor", "car_full")?.state === "on",
      error: this._st("binary_sensor", "data_error")?.state === "on",
      sessionStart: this._st("sensor", "energy_session")?.attributes?.last_reset || null,
      currency: unit === "HUF" ? "Ft" : unit,
      stats,
    };
  }

  // ------------------------------------------------------------ render
  _render() {
    if (!this._hass || !this._config || this._dragging) return;
    const d = this._collect();
    const sig = JSON.stringify([d, this._period, this._config]);
    if (sig === this._sig) return;
    this._sig = sig;

    if (!d) {
      this.shadowRoot.innerHTML = `${STYLE}<ha-card><div class="empty">
        <ha-icon icon="mdi:ev-station"></ha-icon>
        <div>Nem található az <b>Off-Grid EV Charger</b> integráció.<br>
        Ellenőrizd, hogy telepítve van-e, vagy add meg a <code>prefix</code> beállítást.</div></div></ha-card>`;
      return;
    }

    const mode = MODES.find((m) => m.id === d.mode) || (d.mode === "manual" ? MANUAL : MODES[0]);
    const accent = d.plugged ? mode.color : "var(--disabled-text-color, #9e9e9e)";
    const title = this._config.title;

    this.shadowRoot.innerHTML = `${STYLE}
      <ha-card style="--accent:${accent}">
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
        ${this._hero(d, mode)}
        ${this._banner(d)}
        ${this._flow(d)}
        ${this._modes(d)}
        ${this._session(d)}
        ${this._target(d)}
        ${this._history(d)}
        <div class="footer">
          <button class="link" data-action="settings"><ha-icon icon="mdi:cog-outline"></ha-icon>Beállítások</button>
          <button class="link" data-action="more"><ha-icon icon="mdi:information-outline"></ha-icon>Részletek</button>
        </div>
      </ha-card>`;
    this._bind();
    this._tick();
  }

  _hero(d, mode) {
    const R = 44;
    const C = 2 * Math.PI * R;
    const soc = d.evSoc;
    const prog = soc === null ? (d.charging ? 1 : 0) : Math.max(0, Math.min(100, soc)) / 100;
    let tick = "";
    if (soc !== null && d.target !== null) {
      const ang = ((d.target / 100) * 360 - 90) * (Math.PI / 180);
      tick = `<circle class="tick" cx="${50 + R * Math.cos(ang)}" cy="${50 + R * Math.sin(ang)}" r="3.4"></circle>`;
    }
    const center =
      soc !== null
        ? `<div class="big">${fmt(soc)}<span>%</span></div><div class="small">cél ${fmt(d.target)}%</div>`
        : `<ha-icon icon="mdi:car-electric"></ha-icon>`;

    let sub;
    if (!d.plugged) sub = "Csatlakoztasd az autót a töltéshez";
    else if (d.charging)
      sub = `<b>${kw(d.power)}</b>${d.current !== null ? ` · ${fmt(d.current)} A` : ""}${d.estimated ? " · becsült" : ""}`;
    else sub = "Jelenleg nem tölt";

    return `
      <div class="hero" data-action="more">
        <div class="ring ${d.charging ? "live" : ""}">
          <svg viewBox="0 0 100 100">
            <circle class="track" cx="50" cy="50" r="${R}"></circle>
            <circle class="bar" cx="50" cy="50" r="${R}"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - prog)}"></circle>
            ${tick}
          </svg>
          <div class="center">${center}</div>
        </div>
        <div class="info">
          <div class="chip"><ha-icon icon="${mode.icon}"></ha-icon>${mode.label} mód</div>
          <div class="status">${esc(this._headline(d, mode))}</div>
          <div class="sub">${sub}</div>
        </div>
      </div>`;
  }

  _headline(d, mode) {
    if (d.error) return "Töltés biztonsági okból leállítva";
    if (d.offline) return "A töltő nem elérhető";
    if (d.full) return "Az autó feltöltött";
    if (d.charging && !d.error) {
      return { solar: "Töltés napenergiából", fast: "Gyorstöltés", trickle: "Csepptöltés", manual: "Töltés (kézi)" }[mode.id] || "Töltés";
    }
    return stripEmoji(d.status);
  }

  _banner(d) {
    if (d.error)
      return `<div class="banner err"><ha-icon icon="mdi:alert-circle"></ha-icon>
        <div><b>Hiányzó ház-akku adat – a töltés biztonsági okból leállt.</b><br>${esc(d.missing.join(", "))}</div></div>`;
    if (d.offline)
      return `<div class="banner warn"><ha-icon icon="mdi:access-point-network-off"></ha-icon>
        <div><b>A töltő jelenleg nem érhető el.</b><br>Amint visszajön, a vezérlés automatikusan folytatódik.</div></div>`;
    if (d.question)
      return `<div class="banner ask"><ha-icon icon="mdi:help-circle"></ha-icon>
        <div><b>Autó csatlakoztatva – válassz módot!</b><br>
        <span class="countdown">Ha nem választasz, Szolár mód indul.</span></div></div>`;
    if (d.full)
      return `<div class="banner ok"><ha-icon icon="mdi:battery-check"></ha-icon>
        <div><b>Az autó feltöltött.</b><br>Csatlakoztatva van, de nem vesz fel áramot.</div></div>`;
    return "";
  }

  _flow(d) {
    const soc = d.battSoc;
    const bIcon =
      soc === null ? "mdi:battery-unknown" : `mdi:battery${soc >= 95 ? "" : `-${Math.max(10, Math.round(soc / 10) * 10)}`}`;
    let bSub = "–";
    if (d.battPower !== null) {
      if (Math.abs(d.battPower) < 50) bSub = "nyugalomban";
      else if (d.battPower > 0) bSub = `merül ${kw(d.battPower)}`;
      else bSub = `töltődik ${kw(-d.battPower)}`;
    }
    const cls = d.battPower !== null && d.battPower > 50 ? "neg" : d.battPower !== null && d.battPower < -50 ? "pos" : "";
    return `
      <div class="flow">
        <div class="node">
          <div class="nicon"><ha-icon icon="${bIcon}"></ha-icon></div>
          <div class="ntext"><div class="nlabel">Ház-akku</div>
            <div class="nval">${soc === null ? "–" : `${fmt(soc)}%`}</div>
            <div class="nsub ${cls}">${bSub}</div></div>
        </div>
        <div class="line ${d.charging ? "live" : ""}"><span>${d.charging ? kw(d.power) : ""}</span></div>
        <div class="node right">
          <div class="ntext"><div class="nlabel">Autó</div>
            <div class="nval">${d.plugged ? (d.charging ? "Tölt" : "Csatlakoztatva") : "Nincs bedugva"}</div>
            <div class="nsub">${d.plugged && d.evSoc !== null ? `~${fmt(d.evSoc)}%` : "&nbsp;"}</div></div>
          <div class="nicon"><ha-icon icon="${d.plugged ? "mdi:car-electric" : "mdi:car-off"}"></ha-icon></div>
        </div>
      </div>`;
  }

  _modes(d) {
    const btns = MODES.map(
      (m) => `
      <button class="mode ${d.mode === m.id ? "active" : ""}" style="--m:${m.color}" data-action="mode" data-mode="${m.id}"
        title="${m.label}: ${m.hint}">
        <ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span>
      </button>`
    ).join("");
    const manual =
      d.mode === "manual"
        ? `<div class="note"><ha-icon icon="mdi:hand-back-right"></ha-icon>Kézi mód: az integráció nem vezérli a töltőt.</div>`
        : "";
    return `<div class="section"><div class="modes">${btns}</div>${manual}</div>`;
  }

  _tiles(s, cur) {
    return `
      <div class="tiles">
        <div class="tile"><ha-icon icon="mdi:lightning-bolt"></ha-icon><div class="tv">${kwh(s.kwh)}</div><div class="tl">kWh</div></div>
        <div class="tile"><ha-icon icon="mdi:road-variant"></ha-icon><div class="tv">${fmt(s.km)}</div><div class="tl">km</div></div>
        <div class="tile"><ha-icon icon="mdi:timer-outline"></ha-icon><div class="tv">${esc(s.time ?? "–")}</div><div class="tl">töltési idő</div></div>
        <div class="tile save"><ha-icon icon="mdi:piggy-bank-outline"></ha-icon><div class="tv">${money(s.savings)}<small> ${esc(cur)}</small></div><div class="tl">megtakarítás</div></div>
      </div>`;
  }

  _session(d) {
    let since = "";
    if (d.plugged && d.sessionStart) {
      const t = new Date(d.sessionStart);
      if (!isNaN(t)) since = `${t.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })} óta`;
    }
    return `
      <div class="section">
        <div class="head"><span>${d.plugged ? "Ez a töltés" : "Utolsó töltés"}</span><span class="muted">${since}</span></div>
        ${this._tiles(d.stats.session, d.currency)}
      </div>`;
  }

  _target(d) {
    if (d.target === null) return "";
    return `
      <div class="section target">
        <div class="head"><span>Cél töltöttség</span><span class="tval">${fmt(d.target)}%</span></div>
        <input type="range" min="${d.targetMin}" max="${d.targetMax}" step="5" value="${d.target}"
          style="--p:${((d.target - d.targetMin) / (d.targetMax - d.targetMin)) * 100}%" data-action="target">
        <div class="scale"><span>${d.targetMin}%</span><span>${d.evSoc !== null ? `most ~${fmt(d.evSoc)}%` : ""}</span><span>${d.targetMax}%</span></div>
      </div>`;
  }

  _history(d) {
    const tabs = PERIODS.map(
      (p) => `<button class="tab ${this._period === p.id ? "active" : ""}" data-action="period" data-period="${p.id}">${p.label}</button>`
    ).join("");
    return `
      <div class="section">
        <div class="head"><span>Statisztika</span><div class="tabs">${tabs}</div></div>
        ${this._tiles(d.stats[this._period], d.currency)}
      </div>`;
  }

  // ------------------------------------------------------------ events
  _bind() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-action]").forEach((el) => {
      const action = el.dataset.action;
      if (action === "target") {
        const update = () => {
          const v = Number(el.value);
          el.style.setProperty("--p", `${((v - el.min) / (el.max - el.min)) * 100}%`);
          const out = root.querySelector(".tval");
          if (out) out.textContent = `${v}%`;
        };
        el.addEventListener("pointerdown", () => (this._dragging = true));
        el.addEventListener("input", () => {
          this._dragging = true;
          update();
        });
        el.addEventListener("change", () => {
          this._dragging = false;
          this._hass.callService("number", "set_value", { entity_id: this._id("number", "target_soc"), value: Number(el.value) });
        });
        return;
      }
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (action === "mode") this._setMode(el.dataset.mode);
        else if (action === "period") {
          this._period = el.dataset.period;
          this._render();
        } else if (action === "more") this._moreInfo();
        else if (action === "settings") this._settings();
      });
    });
  }

  _setMode(mode) {
    this._pendingMode = mode;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = setTimeout(() => {
      this._pendingMode = null;
      this._render();
    }, 4000);
    this._render();
    this._hass.callService("select", "select_option", { entity_id: this._id("select", "mode"), option: mode });
  }

  _moreInfo() {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId: this._id("sensor", "status") }, bubbles: true, composed: true })
    );
  }

  _settings() {
    const devId = this._hass.entities?.[this._id("sensor", "status")]?.device_id;
    if (!devId) return this._moreInfo();
    history.pushState(null, "", `/config/devices/device/${devId}`);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _tick() {
    clearInterval(this._timer);
    this._timer = null;
    const st = this._hass && this._st("sensor", "status");
    const deadline = st?.attributes?.question_pending && st.attributes.question_deadline;
    if (!deadline) return;
    const upd = () => {
      const el = this.shadowRoot.querySelector(".countdown");
      if (!el) return;
      const left = Math.max(0, Math.round((new Date(deadline) - Date.now()) / 1000));
      el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} múlva automatikusan Szolár mód indul.`;
    };
    upd();
    this._timer = setInterval(upd, 1000);
  }
}

const STYLE = `<style>
  :host { display:block; container-type:inline-size; }
  ha-card { overflow:hidden; padding:4px 0 6px; color:var(--primary-text-color); --tile: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    --line: var(--divider-color, rgba(127,127,127,.2)); --muted: var(--secondary-text-color); }
  button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  ha-icon { --mdc-icon-size:20px; display:inline-flex; }
  .title { padding:14px 18px 0; font-size:18px; font-weight:500; }
  .empty { display:flex; gap:14px; align-items:center; padding:20px; color:var(--muted); line-height:1.5; }
  .empty ha-icon { --mdc-icon-size:36px; color:var(--primary-color); }

  .hero { display:flex; align-items:center; gap:18px; padding:16px 18px 12px; cursor:pointer; }
  .ring { position:relative; width:112px; height:112px; flex:none; }
  .ring svg { width:100%; height:100%; transform:rotate(-90deg); }
  .ring circle { fill:none; stroke-width:8; }
  .ring .track { stroke:var(--tile); stroke:color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .ring .bar { stroke:var(--accent); stroke-linecap:round; transition:stroke-dashoffset .8s ease, stroke .3s; }
  .ring .tick { fill:var(--card-background-color, #fff); stroke:var(--primary-text-color); stroke-width:2; }
  .ring.live svg { filter:drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)); animation:glow 2.4s ease-in-out infinite; }
  @keyframes glow { 50% { filter:drop-shadow(0 0 1px transparent); } }
  .center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .center ha-icon { --mdc-icon-size:40px; color:var(--accent); }
  .big { font-size:30px; font-weight:600; line-height:1; letter-spacing:-.5px; }
  .big span { font-size:15px; font-weight:500; margin-left:1px; color:var(--muted); }
  .small { font-size:11.5px; color:var(--muted); margin-top:4px; }
  .info { min-width:0; flex:1; }
  .chip { display:inline-flex; align-items:center; gap:5px; padding:3px 10px 3px 7px; border-radius:99px; font-size:12px; font-weight:600;
    color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .chip ha-icon { --mdc-icon-size:15px; }
  .status { font-size:17px; font-weight:500; line-height:1.3; margin:8px 0 4px; }
  .sub { font-size:13.5px; color:var(--muted); }
  .sub b { color:var(--primary-text-color); font-weight:600; }

  .banner { display:flex; gap:12px; margin:2px 16px 10px; padding:11px 13px; border-radius:12px; font-size:13px; line-height:1.45; }
  .banner ha-icon { --mdc-icon-size:22px; flex:none; margin-top:1px; }
  .banner.err { background:color-mix(in srgb, var(--error-color, #db4437) 13%, transparent); }
  .banner.err ha-icon { color:var(--error-color, #db4437); }
  .banner.warn { background:color-mix(in srgb, var(--warning-color, #ffa600) 14%, transparent); }
  .banner.warn ha-icon { color:var(--warning-color, #ffa600); }
  .banner.ask { background:color-mix(in srgb, var(--primary-color) 13%, transparent); }
  .banner.ask ha-icon { color:var(--primary-color); }
  .banner.ok { background:color-mix(in srgb, var(--success-color, #43a047) 13%, transparent); }
  .banner.ok ha-icon { color:var(--success-color, #43a047); }

  .flow { display:flex; align-items:center; gap:10px; margin:0 16px; padding:12px; border-radius:14px; background:var(--tile); }
  .node { display:flex; align-items:center; gap:10px; min-width:0; }
  .node.right { text-align:right; }
  .nicon { width:38px; height:38px; flex:none; border-radius:50%; display:flex; align-items:center; justify-content:center;
    background:var(--card-background-color, #fff); color:var(--muted); }
  .node.right .nicon { color:var(--accent); }
  .nlabel { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px; }
  .nval { font-size:15px; font-weight:600; white-space:nowrap; }
  .nsub { font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .nsub.pos { color:var(--success-color, #43a047); }
  .nsub.neg { color:var(--warning-color, #ffa600); }
  .line { flex:1; position:relative; height:4px; min-width:24px; border-radius:4px; background:var(--line); }
  .line.live { background:repeating-linear-gradient(90deg, var(--accent) 0 8px, transparent 8px 16px);
    background-size:16px 4px; animation:flow .7s linear infinite; }
  .line span { position:absolute; left:50%; bottom:9px; transform:translateX(-50%); font-size:12px; font-weight:600; color:var(--accent); white-space:nowrap; }
  @keyframes flow { to { background-position:16px 0; } }

  .section { padding:14px 16px 0; }
  .head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:14px; font-weight:500; margin-bottom:10px; }
  .muted { color:var(--muted); font-weight:400; font-size:12.5px; }

  .modes { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
  .mode { display:flex; flex-direction:column; align-items:center; gap:4px; padding:11px 4px 9px; border-radius:14px;
    background:var(--tile); color:var(--muted); font-size:12.5px; font-weight:500; transition:background .2s, color .2s, transform .1s; }
  .mode ha-icon { --mdc-icon-size:22px; }
  .mode:hover { background:color-mix(in srgb, var(--m) 10%, transparent); }
  .mode:active { transform:scale(.96); }
  .mode.active { background:var(--m); color:#fff; box-shadow:0 4px 14px -6px var(--m); }
  .note { display:flex; gap:8px; align-items:center; margin-top:8px; font-size:12.5px; color:var(--muted); }
  .note ha-icon { --mdc-icon-size:16px; }

  .tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
  .tile { padding:10px 8px; border-radius:12px; background:var(--tile); text-align:center; min-width:0; }
  .tile ha-icon { --mdc-icon-size:18px; color:var(--muted); }
  .tile.save ha-icon { color:var(--success-color, #43a047); }
  .tv { font-size:16px; font-weight:600; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tv small { font-size:11px; font-weight:500; color:var(--muted); }
  .tl { font-size:11px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .tval { font-size:16px; font-weight:600; color:var(--accent); }
  input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:8px; border-radius:8px; margin:4px 0; outline:none;
    background:linear-gradient(90deg, var(--accent) var(--p), color-mix(in srgb, var(--primary-text-color) 12%, transparent) var(--p)); }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px; border-radius:50%; cursor:pointer;
    background:var(--card-background-color, #fff); border:3px solid var(--accent); box-shadow:0 1px 4px rgba(0,0,0,.25); }
  input[type=range]::-moz-range-thumb { width:16px; height:16px; border-radius:50%; cursor:pointer;
    background:var(--card-background-color, #fff); border:3px solid var(--accent); }
  .scale { display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-top:2px; }

  .tabs { display:flex; gap:2px; padding:3px; border-radius:99px; background:var(--tile); }
  .tab { padding:4px 11px; border-radius:99px; font-size:12px; color:var(--muted); }
  .tab.active { background:var(--card-background-color, #fff); color:var(--primary-text-color); font-weight:600; box-shadow:0 1px 3px rgba(0,0,0,.15); }

  .footer { display:flex; justify-content:space-between; padding:10px 8px 0; margin-top:14px; border-top:1px solid var(--line); }
  .link { display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; font-size:13px; color:var(--primary-color); }
  .link ha-icon { --mdc-icon-size:18px; }
  .link:hover { background:color-mix(in srgb, var(--primary-color) 10%, transparent); }

  @container (max-width: 400px) {
    .hero { gap:14px; padding:14px 14px 10px; }
    .ring { width:96px; height:96px; }
    .big { font-size:26px; }
    .tiles { grid-template-columns:repeat(2,1fr); }
    .flow, .banner { margin-left:12px; margin-right:12px; }
    .section { padding-left:12px; padding-right:12px; }
    .nicon { display:none; }
  }
  @media (prefers-reduced-motion: reduce) { .line.live, .ring.live svg { animation:none; } }
</style>`;

if (!customElements.get("offgrid-ev-card")) {
  customElements.define("offgrid-ev-card", OffgridEvCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "offgrid-ev-card",
    name: "Off-Grid EV töltés",
    description: "Autótöltés állapota, módválasztó és statisztika a napelemes szigetrendszerhez.",
    preview: true,
    documentationURL: "https://github.com/gyarmati11/HA_offgrid_ev_charger_control",
  });
  console.info(`%c OFFGRID-EV-CARD %c ${CARD_VERSION} `, "background:#F5A524;color:#000;font-weight:700", "background:#333;color:#fff");
}
