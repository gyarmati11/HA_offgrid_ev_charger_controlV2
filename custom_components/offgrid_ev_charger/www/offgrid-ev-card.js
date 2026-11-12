/* Off-Grid EV Charger card – GENERATED from card_src/offgrid-ev-card.js (ES2017). Edit the source, then run card_src/build.js */
"use strict";
/*
 * Off-Grid EV Charger – Lovelace card
 * Loaded automatically by the offgrid_ev_charger integration.
 *
 *   type: custom:offgrid-ev-card
 *   prefix: ogev          # optional, auto-detected
 *   title: Autótöltés     # optional
 */
const CARD_VERSION = "1.3.2";
const MODES = [
    { id: "solar", label: "Szolár", icon: "mdi:solar-power-variant", color: "#F5A524", hint: "csak napelem-felesleg" },
    { id: "fast", label: "Gyors", icon: "mdi:lightning-bolt", color: "#3D7BF7", hint: "max áram; hálózaton a korlát alatt" },
    { id: "trickle", label: "Csepp", icon: "mdi:water", color: "#14B8A6", hint: "alacsony áram, ház-akkutól függetlenül" },
    { id: "off", label: "Ki", icon: "mdi:pause", color: "#8E8E93", hint: "nem tölt" },
];
const MANUAL = { id: "manual", label: "Kézi", icon: "mdi:hand-back-right", color: "#8E8E93", hint: "nincs vezérlés" };
const PERIODS = [
    { id: "day", label: "Ma" },
    { id: "week", label: "Hét" },
    { id: "month", label: "Hónap" },
    { id: "year", label: "Év" },
];
const esc = (s) => String(s !== null && s !== void 0 ? s : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
};
const fmt = (v, digits = 0) => v === null || v === undefined
    ? "–"
    : Number(v).toLocaleString("hu-HU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kwh = (v) => (v === null ? "–" : fmt(v, v < 10 ? 2 : 1));
const kw = (w) => (w === null ? "–" : Math.abs(w) < 1000 ? `${fmt(w)} W` : `${fmt(w / 1000, 2)} kW`);
const money = (v) => (v === null ? "–" : Math.abs(v) >= 100000 ? `${fmt(v / 1000, 0)} e` : fmt(v));
const ago = (iso) => {
    const t = iso ? new Date(iso) : null;
    if (!t || isNaN(t))
        return null;
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1)
        return "most";
    if (m < 60)
        return `${m} perce`;
    if (m < 48 * 60)
        return `${Math.round(m / 60)} órája`;
    return `${Math.round(m / 1440)} napja`;
};
const hm = (iso) => {
    const t = iso ? new Date(iso) : null;
    return t && !isNaN(t) ? t.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" }) : "";
};
const dur = (min) => (min === null ? "" : `${Math.floor(min / 60)} ó ${String(Math.round(min % 60)).padStart(2, "0")} p`);
// leading emoji / symbols (no \p{} – works on older WebViews)
const stripEmoji = (s) => String(s || "").replace(/^[^A-Za-z0-9ÁÉÍÓÖŐÚÜŰáéíóöőúüű]+/, "");
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
        this._config = Object.assign({}, (config || {}));
        this._sig = "";
        if (this._hass)
            this._render();
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
        var _a;
        if ((_a = this._config) === null || _a === void 0 ? void 0 : _a.prefix)
            return this._config.prefix;
        if (this._hass.states["sensor.ogev_status"])
            return "ogev";
        const found = Object.keys(this._hass.states).find((id) => id.startsWith("sensor.") &&
            id.endsWith("_status") &&
            "question_pending" in (this._hass.states[id].attributes || {}) &&
            "mode_label" in (this._hass.states[id].attributes || {}));
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
        var _a, _b, _c, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
        const status = this._st("sensor", "status");
        if (!status)
            return null;
        const a = status.attributes || {};
        const stats = {};
        for (const p of ["session", ...PERIODS.map((x) => x.id)]) {
            stats[p] = {
                kwh: this._val("sensor", `energy_${p}`),
                km: this._val("sensor", `km_${p}`),
                savings: this._val("sensor", `savings_${p}`),
                time: (_c = (_b = (_a = this._st("sensor", `duration_${p}`)) === null || _a === void 0 ? void 0 : _a.attributes) === null || _b === void 0 ? void 0 : _b.formatted) !== null && _c !== void 0 ? _c : null,
            };
        }
        const unit = ((_f = (_e = this._st("sensor", "savings_day")) === null || _e === void 0 ? void 0 : _e.attributes) === null || _f === void 0 ? void 0 : _f.unit_of_measurement) || "";
        const modeState = (_g = this._st("select", "mode")) === null || _g === void 0 ? void 0 : _g.state;
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
            onGrid: a.on_grid === true,
            gridPower: num(a.grid_power),
            gridLimit: num(a.grid_limit),
            evSoc: num(a.ev_soc),
            current: num(a.charge_current),
            power: this._val("sensor", "charger_power"),
            estimated: !!((_j = (_h = this._st("sensor", "charger_power")) === null || _h === void 0 ? void 0 : _h.attributes) === null || _j === void 0 ? void 0 : _j.estimated),
            target: this._val("number", "target_soc"),
            targetMin: (_m = (_l = (_k = this._st("number", "target_soc")) === null || _k === void 0 ? void 0 : _k.attributes) === null || _l === void 0 ? void 0 : _l.min) !== null && _m !== void 0 ? _m : 10,
            targetMax: (_q = (_p = (_o = this._st("number", "target_soc")) === null || _o === void 0 ? void 0 : _o.attributes) === null || _p === void 0 ? void 0 : _p.max) !== null && _q !== void 0 ? _q : 100,
            full: ((_r = this._st("binary_sensor", "car_full")) === null || _r === void 0 ? void 0 : _r.state) === "on",
            error: ((_s = this._st("binary_sensor", "data_error")) === null || _s === void 0 ? void 0 : _s.state) === "on",
            sessionStart: ((_u = (_t = this._st("sensor", "energy_session")) === null || _t === void 0 ? void 0 : _t.attributes) === null || _u === void 0 ? void 0 : _u.last_reset) || null,
            car: a.car || {},
            range: num(a.ev_range),
            rangeTarget: num(a.range_at_target),
            toTarget: num(a.energy_to_target),
            minutes: num(a.minutes_to_target),
            finishAt: a.finish_at || null,
            stale: !!a.ev_soc_stale,
            depOn: !!a.departure_on,
            depTime: a.departure_time || "07:00",
            boost: !!a.boost_active,
            depSwitch: a.entity_departure_on || this._id("switch", "departure_enabled"),
            depTimeEnt: a.entity_departure_time || this._id("time", "departure_time"),
            currency: unit === "HUF" ? "Ft" : unit,
            stats,
        };
    }
    // ------------------------------------------------------------ render
    _render() {
        if (!this._hass || !this._config || this._dragging)
            return;
        const d = this._collect();
        const sig = JSON.stringify([d, this._period, this._config]);
        if (sig === this._sig)
            return;
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
        this._d = d;
        this.shadowRoot.innerHTML = `${STYLE}
      <ha-card style="--accent:${accent}">
        ${title ? `<div class="title">${esc(title)}</div>` : ""}
        ${this._hero(d, mode)}
        ${this._banner(d)}
        ${this._flow(d)}
        ${this._modes(d)}
        ${this._target(d)}
        ${this._car(d)}
        ${this._session(d)}
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
        const center = soc !== null
            ? `<div class="big">${fmt(soc)}<span>%</span></div><div class="small">${d.range !== null ? `≈ ${fmt(d.range)} km` : `cél ${fmt(d.target)}%`}</div>`
            : `<ha-icon icon="mdi:car-electric"></ha-icon>`;
        let sub;
        if (!d.plugged)
            sub = "Csatlakoztasd az autót a töltéshez";
        else if (d.charging)
            sub = `<b>${kw(d.power)}</b>${d.current !== null ? ` · ${fmt(d.current)} A` : ""}${d.estimated ? " · becsült" : ""}`;
        else
            sub = "Jelenleg nem tölt";
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
        if (d.error)
            return "Töltés biztonsági okból leállítva";
        if (d.offline)
            return "A töltő nem elérhető";
        if (d.full)
            return "Az autó feltöltött";
        if (d.charging && !d.error && d.boost)
            return "Gyorstöltés az indulásig";
        if (d.charging && d.onGrid && (d.mode === "fast" || d.boost))
            return "Gyorstöltés hálózatról";
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
        const bIcon = soc === null ? "mdi:battery-unknown" : `mdi:battery${soc >= 95 ? "" : `-${Math.max(10, Math.round(soc / 10) * 10)}`}`;
        let bSub = "–";
        if (d.battPower !== null) {
            if (Math.abs(d.battPower) < 50)
                bSub = "nyugalomban";
            else if (d.battPower > 0)
                bSub = `merül ${kw(d.battPower)}`;
            else
                bSub = `töltődik ${kw(-d.battPower)}`;
        }
        const cls = d.battPower !== null && d.battPower > 50 ? "neg" : d.battPower !== null && d.battPower < -50 ? "pos" : "";
        const left = d.onGrid
            ? `<div class="node">
          <div class="nicon grid"><ha-icon icon="mdi:transmission-tower"></ha-icon></div>
          <div class="ntext"><div class="nlabel">Hálózat</div>
            <div class="nval">${d.gridPower === null ? "–" : kw(d.gridPower)}</div>
            <div class="nsub ${d.gridLimit && d.gridPower > d.gridLimit * 0.95 ? "neg" : ""}">${d.gridLimit ? `korlát ${kw(d.gridLimit)}` : "&nbsp;"}${soc !== null ? ` · akku ${fmt(soc)}%` : ""}</div></div>
        </div>`
            : `<div class="node">
          <div class="nicon"><ha-icon icon="${bIcon}"></ha-icon></div>
          <div class="ntext"><div class="nlabel">Ház-akku</div>
            <div class="nval">${soc === null ? "–" : `${fmt(soc)}%`}</div>
            <div class="nsub ${cls}">${bSub}</div></div>
        </div>`;
        return `
      <div class="flow">
        ${left}
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
        const btns = MODES.map((m) => `
      <button class="mode ${d.mode === m.id ? "active" : ""}" style="--m:${m.color}" data-action="mode" data-mode="${m.id}"
        title="${m.label}: ${m.hint}">
        <ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span>
      </button>`).join("");
        const manual = d.mode === "manual"
            ? `<div class="note"><ha-icon icon="mdi:hand-back-right"></ha-icon>Kézi mód: az integráció nem vezérli a töltőt.</div>`
            : "";
        return `<div class="section"><div class="modes">${btns}</div>${manual}</div>`;
    }
    _tiles(s, cur) {
        var _a;
        return `
      <div class="tiles">
        <div class="tile"><ha-icon icon="mdi:lightning-bolt"></ha-icon><div class="tv">${kwh(s.kwh)}</div><div class="tl">kWh</div></div>
        <div class="tile"><ha-icon icon="mdi:road-variant"></ha-icon><div class="tv">${fmt(s.km)}</div><div class="tl">km</div></div>
        <div class="tile"><ha-icon icon="mdi:timer-outline"></ha-icon><div class="tv">${esc((_a = s.time) !== null && _a !== void 0 ? _a : "–")}</div><div class="tl">töltési idő</div></div>
        <div class="tile save"><ha-icon icon="mdi:piggy-bank-outline"></ha-icon><div class="tv">${money(s.savings)}<small> ${esc(cur)}</small></div><div class="tl">megtakarítás</div></div>
      </div>`;
    }
    _session(d) {
        let since = "";
        if (d.plugged && d.sessionStart) {
            const t = new Date(d.sessionStart);
            if (!isNaN(t))
                since = `${t.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" })} óta`;
        }
        return `
      <div class="section">
        <div class="head"><span>${d.plugged ? "Ez a töltés" : "Utolsó töltés"}</span><span class="muted">${since}</span></div>
        ${this._tiles(d.stats.session, d.currency)}
      </div>`;
    }
    _target(d) {
        if (d.target === null)
            return "";
        let info = "";
        if (d.plugged && d.evSoc !== null) {
            if (d.toTarget !== null && d.toTarget <= 0.05)
                info = `<ha-icon icon="mdi:check-circle"></ha-icon>A cél elérve`;
            else if (d.toTarget !== null) {
                info = `<ha-icon icon="mdi:battery-arrow-up"></ha-icon>Még <b>${fmt(d.toTarget, 1)} kWh</b>`;
                if (d.minutes !== null)
                    info += ` · kész kb. <b>${hm(d.finishAt)}</b> (${dur(d.minutes)})`;
            }
        }
        const depHint = d.boost
            ? "Gyorsít, hogy időre kész legyen"
            : d.depOn
                ? "Ha kell, gyorsít az indulásig"
                : "Kikapcsolva";
        return `
      <div class="section target">
        <div class="head"><span>Meddig töltse?</span>
          <span class="tval"><span class="tnum">${fmt(d.target)}%</span>${d.rangeTarget !== null ? `<span class="tkm"> ≈ ${fmt(d.rangeTarget)} km</span>` : ""}</span></div>
        <input type="range" min="${d.targetMin}" max="${d.targetMax}" step="5" value="${d.target}"
          style="--p:${((d.target - d.targetMin) / (d.targetMax - d.targetMin)) * 100}%" data-action="target">
        <div class="scale"><span>${d.targetMin}%</span><span>${d.evSoc !== null ? `most ~${fmt(d.evSoc)}%` : ""}</span><span>${d.targetMax}%</span></div>
        ${info ? `<div class="eta">${info}</div>` : ""}
        <div class="dep ${d.boost ? "boost" : ""}">
          <ha-icon icon="${d.boost ? "mdi:clock-fast" : "mdi:clock-outline"}"></ha-icon>
          <div class="dtext"><div class="dlabel">Indulásra kész</div><div class="dhint">${depHint}</div></div>
          <input type="time" value="${esc(d.depTime)}" data-action="deptime" ${d.depOn ? "" : 'class="dim"'}>
          <button class="toggle ${d.depOn ? "on" : ""}" data-action="depon" aria-label="Indulásra kész"><span></span></button>
        </div>
      </div>`;
    }
    _car(d) {
        const c = d.car;
        if (!c.configured)
            return "";
        const upd = ago(c.updated);
        const sub = !c.found
            ? "Az OpenCARWINGS entitások nem találhatók"
            : d.stale
                ? "Régi adat – frissítés folyamatban…"
                : upd
                    ? `frissítve ${upd}`
                    : "";
        const tile = (icon, val, unit, label) => `<div class="tile"><ha-icon icon="${icon}"></ha-icon><div class="tv">${val}${unit && val !== "–" ? `<small> ${unit}</small>` : ""}</div><div class="tl">${label}</div></div>`;
        const acBtn = c.ac_entity
            ? `<button class="pill ${c.ac_on ? "on" : ""}" data-action="ac"><ha-icon icon="mdi:fan"></ha-icon>Klíma ${c.ac_on ? "be" : "ki"}</button>`
            : "";
        return `
      <div class="section">
        <div class="head"><span>Autó</span><span class="muted ${d.stale ? "warn" : ""}">${esc(sub)}</span></div>
        <div class="tiles compact">
          ${tile("mdi:map-marker-distance", fmt(c.range_acoff), "km", "hatótáv")}
          ${tile("mdi:air-conditioner", fmt(c.range_acon), "km", "klímával")}
          ${tile("mdi:battery-heart-variant", fmt(c.soh), "%", "akku állapot")}
          ${tile("mdi:thermometer", c.cabin_temp === null || c.cabin_temp === undefined ? "–" : fmt(c.cabin_temp), "°C", "utastér")}
        </div>
        <div class="actions">
          <button class="pill" data-action="refresh"><ha-icon icon="mdi:refresh"></ha-icon>Adatok frissítése</button>
          ${acBtn}
        </div>
      </div>`;
    }
    _history(d) {
        const tabs = PERIODS.map((p) => `<button class="tab ${this._period === p.id ? "active" : ""}" data-action="period" data-period="${p.id}">${p.label}</button>`).join("");
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
                    const out = root.querySelector(".tnum");
                    if (out)
                        out.textContent = `${v}%`;
                    const km = root.querySelector(".tkm");
                    const per = this._d && this._d.rangeTarget && this._d.target ? this._d.rangeTarget / this._d.target : null;
                    if (km && per)
                        km.textContent = ` ≈ ${fmt(per * v)} km`;
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
            if (action === "deptime") {
                el.addEventListener("focus", () => (this._dragging = true));
                el.addEventListener("blur", () => {
                    this._dragging = false;
                    this._render();
                });
                el.addEventListener("change", () => {
                    if (!el.value)
                        return;
                    this._hass.callService("time", "set_value", { entity_id: this._d.depTimeEnt, time: `${el.value}:00` });
                });
                return;
            }
            el.addEventListener("click", (ev) => {
                ev.stopPropagation();
                if (action === "mode")
                    this._setMode(el.dataset.mode);
                else if (action === "period") {
                    this._period = el.dataset.period;
                    this._render();
                }
                else if (action === "more")
                    this._moreInfo();
                else if (action === "settings")
                    this._settings();
                else if (action === "depon")
                    this._hass.callService("switch", "toggle", { entity_id: this._d.depSwitch });
                else if (action === "refresh") {
                    el.classList.add("busy");
                    this._hass.callService("button", "press", { entity_id: this._id("button", "refresh_car") });
                }
                else if (action === "ac" && this._d.car.ac_entity)
                    this._hass.callService("switch", "toggle", { entity_id: this._d.car.ac_entity });
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
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._id("sensor", "status") }, bubbles: true, composed: true }));
    }
    _settings() {
        var _a, _b;
        const devId = (_b = (_a = this._hass.entities) === null || _a === void 0 ? void 0 : _a[this._id("sensor", "status")]) === null || _b === void 0 ? void 0 : _b.device_id;
        if (!devId)
            return this._moreInfo();
        history.pushState(null, "", `/config/devices/device/${devId}`);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
    }
    _tick() {
        var _a;
        clearInterval(this._timer);
        this._timer = null;
        const st = this._hass && this._st("sensor", "status");
        const deadline = ((_a = st === null || st === void 0 ? void 0 : st.attributes) === null || _a === void 0 ? void 0 : _a.question_pending) && st.attributes.question_deadline;
        if (!deadline)
            return;
        const upd = () => {
            const el = this.shadowRoot.querySelector(".countdown");
            if (!el)
                return;
            const left = Math.max(0, Math.round((new Date(deadline) - Date.now()) / 1000));
            el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} múlva automatikusan Szolár mód indul.`;
        };
        upd();
        this._timer = setInterval(upd, 1000);
    }
}
const STYLE = `<style>
  :host { display:block; container-type:inline-size; }
  ha-card { overflow:hidden; padding:4px 0 6px; color:var(--primary-text-color); --tile: rgba(128,128,128,.10);
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
  .ring .track { stroke:var(--tile); stroke:rgba(128,128,128,0.11); stroke:color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
  .ring .bar { stroke:var(--accent); stroke-linecap:round; transition:stroke-dashoffset .8s ease, stroke .3s; }
  .ring .tick { fill:var(--card-background-color, #fff); stroke:var(--primary-text-color); stroke-width:2; }
  .ring.live svg { filter:drop-shadow(0 0 6px rgba(128,128,128,0.35)); filter:drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)); animation:glow 2.4s ease-in-out infinite; }
  @keyframes glow { 50% { filter:drop-shadow(0 0 1px transparent); } }
  .center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .center ha-icon { --mdc-icon-size:40px; color:var(--accent); }
  .big { font-size:30px; font-weight:600; line-height:1; letter-spacing:-.5px; }
  .big span { font-size:15px; font-weight:500; margin-left:1px; color:var(--muted); }
  .small { font-size:11.5px; color:var(--muted); margin-top:4px; }
  .info { min-width:0; flex:1; }
  .chip { display:inline-flex; align-items:center; gap:5px; padding:3px 10px 3px 7px; border-radius:99px; font-size:12px; font-weight:600;
    color:var(--accent); background:rgba(128,128,128,0.16); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .chip ha-icon { --mdc-icon-size:15px; }
  .status { font-size:17px; font-weight:500; line-height:1.3; margin:8px 0 4px; }
  .sub { font-size:13.5px; color:var(--muted); }
  .sub b { color:var(--primary-text-color); font-weight:600; }

  .banner { display:flex; gap:12px; margin:2px 16px 10px; padding:11px 13px; border-radius:12px; font-size:13px; line-height:1.45; }
  .banner ha-icon { --mdc-icon-size:22px; flex:none; margin-top:1px; }
  .banner.err { background:rgba(128,128,128,0.15); background:color-mix(in srgb, var(--error-color, #db4437) 13%, transparent); }
  .banner.err ha-icon { color:var(--error-color, #db4437); }
  .banner.warn { background:rgba(128,128,128,0.16); background:color-mix(in srgb, var(--warning-color, #ffa600) 14%, transparent); }
  .banner.warn ha-icon { color:var(--warning-color, #ffa600); }
  .banner.ask { background:rgba(128,128,128,0.15); background:color-mix(in srgb, var(--primary-color) 13%, transparent); }
  .banner.ask ha-icon { color:var(--primary-color); }
  .banner.ok { background:rgba(128,128,128,0.15); background:color-mix(in srgb, var(--success-color, #43a047) 13%, transparent); }
  .banner.ok ha-icon { color:var(--success-color, #43a047); }

  .flow { display:flex; align-items:center; gap:10px; margin:0 16px; padding:12px; border-radius:14px; background:var(--tile); }
  .node { display:flex; align-items:center; gap:10px; min-width:0; }
  .node.right { text-align:right; }
  .nicon { width:38px; height:38px; flex:none; border-radius:50%; display:flex; align-items:center; justify-content:center;
    background:var(--card-background-color, #fff); color:var(--muted); }
  .node.right .nicon { color:var(--accent); }
  .nicon.grid { color:#3D7BF7; }
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
  .mode:hover { background:rgba(128,128,128,0.12); background:color-mix(in srgb, var(--m) 10%, transparent); }
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

  .tval { font-size:16px; font-weight:600; color:var(--accent); white-space:nowrap; }
  .tkm { font-size:13px; font-weight:500; color:var(--muted); }
  .muted.warn { color:var(--warning-color, #ffa600); }
  .eta { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-top:10px; font-size:13px; color:var(--muted); }
  .eta b { color:var(--primary-text-color); font-weight:600; }
  .eta ha-icon { --mdc-icon-size:17px; color:var(--accent); }
  .dep { display:flex; align-items:center; gap:10px; margin-top:12px; padding:10px 12px; border-radius:12px; background:var(--tile); }
  .dep > ha-icon { color:var(--muted); }
  .dep.boost { background:rgba(128,128,128,0.16); background:color-mix(in srgb, #3D7BF7 14%, transparent); }
  .dep.boost > ha-icon { color:#3D7BF7; }
  .dtext { flex:1; min-width:0; }
  .dlabel { font-size:14px; font-weight:500; }
  .dhint { font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  input[type=time] { font:inherit; font-size:15px; font-weight:600; color:var(--primary-text-color); background:var(--card-background-color, #fff);
    border:1px solid var(--line); border-radius:8px; padding:4px 6px; color-scheme:light dark; }
  input[type=time].dim { opacity:.5; }
  .toggle { position:relative; width:42px; height:24px; flex:none; border-radius:99px; background:rgba(128,128,128,0.24); background:color-mix(in srgb, var(--primary-text-color) 22%, transparent); transition:background .2s; }
  .toggle span { position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:transform .2s; }
  .toggle.on { background:var(--accent); }
  .toggle.on span { transform:translateX(18px); }
  .actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:99px; font-size:13px; font-weight:500;
    background:var(--tile); color:var(--primary-text-color); }
  .pill ha-icon { --mdc-icon-size:17px; color:var(--muted); }
  .pill.on { background:rgba(128,128,128,0.20); background:color-mix(in srgb, #14B8A6 18%, transparent); }
  .pill.on ha-icon { color:#14B8A6; }
  .pill.busy ha-icon { animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:8px; border-radius:8px; margin:4px 0; outline:none;
    background:linear-gradient(90deg, var(--accent) var(--p), rgba(128,128,128,0.14) var(--p)); background:linear-gradient(90deg, var(--accent) var(--p), color-mix(in srgb, var(--primary-text-color) 12%, transparent) var(--p)); }
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
  .link:hover { background:rgba(128,128,128,0.12); background:color-mix(in srgb, var(--primary-color) 10%, transparent); }

  @container (max-width: 400px) {
    .tiles.compact { grid-template-columns:repeat(4,1fr); gap:6px; }
    .tiles.compact .tile { padding:8px 4px; }
    .tiles.compact .tv { font-size:14px; }
    .tiles.compact .tv small { display:none; }
    .hero { gap:14px; padding:14px 14px 10px; }
    .ring { width:96px; height:96px; }
    .big { font-size:26px; }
    .tiles { grid-template-columns:repeat(2,1fr); }
    .flow, .banner { margin-left:12px; margin-right:12px; }
    .section { padding-left:12px; padding-right:12px; }
    .nicon { display:none; }
  }
  @supports not (container-type: inline-size) { @media (max-width: 440px) {
    .tiles.compact { grid-template-columns:repeat(4,1fr); gap:6px; }
    .tiles.compact .tile { padding:8px 4px; }
    .tiles.compact .tv { font-size:14px; }
    .tiles.compact .tv small { display:none; }
    .hero { gap:14px; padding:14px 14px 10px; }
    .ring { width:96px; height:96px; }
    .big { font-size:26px; }
    .tiles { grid-template-columns:repeat(2,1fr); }
    .flow, .banner { margin-left:12px; margin-right:12px; }
    .section { padding-left:12px; padding-right:12px; }
    .nicon { display:none; }
  } }
  @media (prefers-reduced-motion: reduce) { .line.live, .ring.live svg { animation:none; } }

  @supports (color: color-mix(in srgb, red 50%, blue)) { ha-card { --tile: color-mix(in srgb, var(--primary-text-color) 5%, transparent); } }
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
