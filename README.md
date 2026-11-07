# Off-Grid EV Charger – Home Assistant integráció

Autótöltés-vezérlés **szigetüzemű (off-grid) napelemes rendszerekhez** (pl. Axpert, Deye), 1 fázisú töltővel.
A ház-akku SOC-ja és teljesítménye alapján szabályozza a töltőáramot, hogy az autó ne merítse le a ház-akkut.

## Funkciók

- **Töltési módok**
  - ☀️ **Szolár** – csak a napelem-felesleg megy az autóba. Arányos szabályozás az akku teljesítménye alapján. Teli ház-akkunál fokozatosan emeli az áramot, hogy megtalálja az inverter által visszafogott (rejtett) PV-teljesítményt. Leáll, ha 2 percig minimum árammal sincs felesleg; utána 5 perc szünet.
  - ⚡ **Gyors** – a beállított max árammal tölt, amíg az inverter akkuról megy. Ha hálózatra vált, úgy szabályoz, hogy a hálózatból felvett teljesítmény a korlát alatt maradjon (alap: 4000 W). Ha már a minimális áram sem fér bele, szünetel, és 2 perc után, ráhagyással indul újra. Ehhez add meg az inverter üzemmód entitását és/vagy a hálózati teljesítmény szenzort; ezek nélkül a régi, ház-akku alapú védelem működik.
  - 💧 **Csepp** – alacsony, fix áram, a ház-akku töltöttségétől és adataitól függetlenül.
  - ⏸️ **Kikapcsolva** és 🖐️ **Kézi** (az integráció nem nyúl a töltőhöz).
- **Csatlakoztatáskor kérdés** a telefonon gombokkal (Szolár / Gyors / Csepp). Ha nincs válasz, a beállított idő után **Szolár**.
- **Állapot kijelzés** mindig: `sensor.ogev_status` (pl. „☀️ Szolár · 11 A ↑ · ház-akku 90%”).
- **Értesítések:** autó feltöltve (csatlakoztatva, de nem vesz fel áramot), töltés vége összegzéssel, hiányzó entitás.
- **Hiba kezelés:** ha egy szükséges entitás 1 percig nem elérhető, biztonsági leállás, visszatéréskor automatikus folytatás.
- **Statisztika** alkalomra / napra / hétre / hónapra / évre: kWh, megtehető km, megtakarítás benzineshez képest, töltési idő. HA újraindítás után is megmarad. Az `sensor.ogev_energy_total` az Energia dashboardhoz is hozzáadható.
- **Minden paraméter állítható** a felületen (fogyasztás 16 kWh/100 km, benzinár, áramhatárok, SOC-küszöbök…).

## Nissan Leaf / e-NV200 – OpenCARWINGS

Ha telepítve van az [OpenCARWINGS integráció](https://github.com/czapeczek/ha_opencarwings), a beállításoknál
válaszd ki az autót („OpenCARWINGS autó”). Ha csak egy autód van, a párosítás automatikus. Ezután:

- **Valós töltöttség az autóból.** Mivel az autó csak ritkán küld adatot, két frissítés között a betöltött kWh-ból
  becsüli a SOC-t (`sensor.ogev_ev_soc`). A kapacitást az autó adataiból számolja, a hatásfok állítható (alap: 88%).
- **Automatikus frissítés:** csatlakoztatás után 2 perccel, töltés közben 30 percenként (állítható, 0 = ki),
  a cél közelében 10 percenként, leálláskor egy ellenőrző frissítés. Csatlakoztatás előtti (régi) adat alapján nem áll le.
- **Meddig töltse:** cél töltöttség (pl. 80% ≈ 200 km), a célt elérve leáll és értesít. Csak 2%-os esés után indul újra.
- **Indulásra kész:** add meg az indulás idejét. Ha a napelemből nem érné el a célt addig, időben gyorstöltésre vált.
- **Kártyán:** hatótáv (klímával és anélkül), akku állapot (SOH), utastér hőmérséklet, frissítés és klíma gomb,
  hátralévő kWh és várható befejezés.

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

**1.3.0**
- Csepp mód: a ház-akku töltöttségétől függetlenül tölt (akku adat nélkül is).
- Gyors mód: max árammal tölt akkuról; hálózatra váltáskor azonnal a hálózati korlát (alap 4000 W) alá szabályoz, szükség esetén szünetel. Új opcionális beállítások: inverter üzemmód entitás, „hálózaton” állapotok, hálózati teljesítmény szenzor; új paraméter: `number.ogev_grid_max_power`.
- A `number.ogev_trickle_min_soc` megszűnt (törölhető az entitások közül).
- Kártya: hálózati üzemben a hálózati teljesítmény és a korlát látszik.

**1.2.0**
- OpenCARWINGS (Nissan Leaf / e-NV200) támogatás: autó töltöttség, hatótáv, akku állapot, automatikus adatfrissítés.
- „Meddig töltse”: cél km-ben is, hátralévő energia és várható befejezés, értesítés a cél elérésekor.
- Új: „Indulásra kész” időpont automatikus gyorsítással.
- Új entitások: `sensor.ogev_ev_soc`, `sensor.ogev_ev_range`, `sensor.ogev_energy_to_target`, `sensor.ogev_time_to_target`,
  `switch.ogev_departure_enabled`, `time.ogev_departure_time`, `button.ogev_refresh_car`.

**1.1.1**
- Javítva: leállítás után a töltő „unknown” áramerősséget jelzett, amit a vezérlő hiányzó adatnak vett. Leállításkor már nem küld áramerősséget, indítás előtt viszont mindig beállítja.
- A töltő átmeneti elérhetetlensége már nem „hiányzó adat” hiba: a kártyán sárga jelzés jelenik meg, értesítés csak akkor jön, ha töltenie kellene, és 5 percnél tovább nem elérhető.
- Biztonsági leállás és piros hibaértesítés csak a ház-akku adatainak (SOC, teljesítmény) hiánya esetén.

**1.1.0** – Saját Lovelace kártya (`custom:offgrid-ev-card`), automatikus betöltéssel.
