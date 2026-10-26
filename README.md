# Off-Grid EV Charger – Home Assistant integráció

Autótöltés-vezérlés **szigetüzemű (off-grid) napelemes rendszerekhez** (pl. Axpert, Deye), 1 fázisú töltővel.
A ház-akku SOC-ja és teljesítménye alapján szabályozza a töltőáramot, hogy az autó ne merítse le a ház-akkut.

## Funkciók

- **Töltési módok**
  - ☀️ **Szolár** – csak a napelem-felesleg megy az autóba. Arányos szabályozás az akku teljesítménye alapján. Teli ház-akkunál fokozatosan emeli az áramot, hogy megtalálja az inverter által visszafogott (rejtett) PV-teljesítményt. Leáll, ha 2 percig minimum árammal sincs felesleg; utána 5 perc szünet.
  - ⚡ **Gyors** – a lehető leggyorsabban tölt (max áramig), de az inverter/BMS merülési limitjét betartja.
  - 💧 **Csepp** – alacsony, fix áram, ha se nap, se sok akku nincs. Saját SOC-határral.
  - ⏸️ **Kikapcsolva** és 🖐️ **Kézi** (az integráció nem nyúl a töltőhöz).
- **Csatlakoztatáskor kérdés** a telefonon gombokkal (Szolár / Gyors / Csepp). Ha nincs válasz, a beállított idő után **Szolár**.
- **Állapot kijelzés** mindig: `sensor.ogev_status` (pl. „☀️ Szolár · 11 A ↑ · ház-akku 90%”).
- **Értesítések:** autó feltöltve (csatlakoztatva, de nem vesz fel áramot), töltés vége összegzéssel, hiányzó entitás.
- **Hiba kezelés:** ha egy szükséges entitás 1 percig nem elérhető, biztonsági leállás, visszatéréskor automatikus folytatás.
- **Statisztika** alkalomra / napra / hétre / hónapra / évre: kWh, megtehető km, megtakarítás benzineshez képest, töltési idő. HA újraindítás után is megmarad. Az `sensor.ogev_energy_total` az Energia dashboardhoz is hozzáadható.
- **Minden paraméter állítható** a felületen (fogyasztás 16 kWh/100 km, benzinár, áramhatárok, SOC-küszöbök…).

## Telepítés HACS-sal

1. Repó: `https://github.com/gyarmati11/HA_offgrid_ev_charger_control`
2. HACS → jobb felső ⋮ → **Egyéni tárolók (Custom repositories)** → add meg a repó URL-jét, típus: **Integration**.
3. Keresd meg az „Off-Grid EV Charger”-t → **Letöltés** → Home Assistant újraindítás.
4. Beállítások → Eszközök és szolgáltatások → **Integráció hozzáadása** → „Off-Grid EV Charger”.

**HACS nélkül:** másold a `custom_components/offgrid_ev_charger` mappát a `/config/custom_components/` alá, majd indítsd újra a HA-t.

> A régi „Off-Grid Autótöltés V6” automatizmust kapcsold ki, különben a kettő egymás ellen dolgozik!

## Beállítás

A varázsló ezeket kéri (a jelenlegi entitásaid előre ki vannak töltve):

| Mező | Példa |
|---|---|
| Ház-akku SOC | `sensor.akkumulator_soc` |
| Ház-akku teljesítmény + előjel | `sensor.akkumulator_teljesitmeny`, pozitív = merül |
| Töltő indító/leállító | `select.ev_charger_toggle_charging` („Start charging” / „Stop charging”), vagy egy `switch` |
| Töltőáram | `number.ev_charger_set_charge_current` |
| Autó csatlakozás | a töltő státusz szenzora vagy egy binary_sensor |
| Töltő teljesítmény *(opcionális)* | W vagy kW. Nélküle az áramból becsül, és az „autó tele” jelzés nem működik |
| Autó SOC *(opcionális)* | `sensor.ev_becsult_soc` |
| Telefon értesítés *(opcionális)* | `notify.mobile_app_telefonom` – ez kell a gombos kérdéshez |

Az entitások később módosíthatók: integráció → **Konfigurálás**.

## Entitások

| Entitás | Leírás |
|---|---|
| `select.ogev_mode` | Töltési mód |
| `sensor.ogev_status` | Aktuális állapot szövegesen (attribútumok: cél áram, hiányzó entitások…) |
| `sensor.ogev_charger_power` | Töltési teljesítmény (mért vagy becsült) |
| `sensor.ogev_energy_{session,day,week,month,year,total}` | Betöltött energia |
| `sensor.ogev_km_{session,day,week,month,year}` | Megtehető km |
| `sensor.ogev_savings_{session,day,week,month,year}` | Megtakarítás |
| `sensor.ogev_duration_{session,day,week,month,year}` | Töltési idő (perc; `formatted` attribútum: „2 ó 05 p”) |
| `binary_sensor.ogev_plugged / charging / car_full / data_error` | Csatlakoztatva / tölt / tele / adat hiba |
| `number.ogev_*` | Paraméterek |
| `button.ogev_reset_statistics` | Statisztika nullázása |

## Lovelace kártya

Az integráció a saját kártyáját **automatikusan betölti**, külön telepíteni nem kell.
Dashboard → Szerkesztés → **Kártya hozzáadása** → keresd: „Off-Grid EV töltés”. Vagy manuálisan:

```yaml
type: custom:offgrid-ev-card
```

A kártyán látszik: autó töltöttsége gyűrűben a céllal, aktuális állapot és teljesítmény, ház-akku → autó energiaáramlás,
egy érintéses módválasztó, az aktuális töltés és a napi/heti/havi/éves statisztika (kWh, km, idő, megtakarítás),
cél töltöttség csúszka, valamint figyelmeztetések (módválasztás visszaszámlálással, hiányzó adat, autó feltöltve).
Világos és sötét témával, telefonon is működik.

> Ha a kártya frissítés után nem jelenik meg, frissítsd a böngészőt (mobil appban: Beállítások → Companion app → Gyorsítótár ürítése).

## Működési sorrend (prioritás)

1. Nincs autó → leállítva
2. Hiányzó adat (1 percnél tovább) → biztonsági leállás
3. Kézi / Kikapcsolva mód
4. Autó elérte a cél SOC-t → leállítva
5. Autó tele (töltő engedélyezve, 5 percig < 100 W) → jelzés
6. Ház-akku a védelmi szint alatt → leállítva
7. A választott mód logikája (Csepp / Gyors / Szolár)

A Gyors és Csepp mód 5% hiszterézissel indul újra, hogy ne kapcsolgasson a határon.

## Változások

**1.1.1**
- Javítva: leállítás után a töltő „unknown” áramerősséget jelzett, amit a vezérlő hiányzó adatnak vett. Leállításkor már nem küld áramerősséget, indítás előtt viszont mindig beállítja.
- A töltő átmeneti elérhetetlensége már nem „hiányzó adat” hiba: a kártyán sárga jelzés jelenik meg, értesítés csak akkor jön, ha töltenie kellene, és 5 percnél tovább nem elérhető.
- Biztonsági leállás és piros hibaértesítés csak a ház-akku adatainak (SOC, teljesítmény) hiánya esetén.

**1.1.0** – Saját Lovelace kártya (`custom:offgrid-ev-card`), automatikus betöltéssel.
