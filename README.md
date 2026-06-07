# Essensplaner HA

Ein lokaler Essensplaner fuer Home Assistant: Gerichte pflegen, Wochenplan per
Zufall generieren, einzelne Tage neu wuerfeln, Tage manuell ueberschreiben und
Gerichte nach Aufwand/Kategorie begrenzen.

Das Projekt ist aus einem privaten Excel/VBA-Essensplaner entstanden und wurde
als Home-Assistant-Custom-Integration plus Lovelace-Custom-Card nachgebaut. Die
oeffentliche Version enthaelt **keine privaten Gerichte**, sondern nur
Beispieldaten, unter anderem `Schnitzel mit Pommes`.

## Features

- Wochenplan fuer Montag bis Sonntag erstellen.
- Zeitraum direkt im Dashboard waehlen: diese Woche oder naechste Woche.
- Zufallslogik vermeidet doppelte Gerichte in derselben Woche.
- Kategorien/Klassen fuer Aufwand und Haeufigkeit:
  - Klasse 1: normale Gerichte, keine Wochenbegrenzung.
  - Klasse 2: maximal 2 Gerichte pro Woche.
  - Klasse 3: maximal 1 Gericht pro Woche.
  - Klasse 4: nur Samstag/Sonntag und maximal 1 Gericht pro Woche.
- Einzelne Tage neu wuerfeln.
- Einzelne Tage leeren.
- Gericht fuer einen Tag aus einer suchbaren Liste auswaehlen.
- Freitext in einen Tag schreiben, auch wenn das Gericht nicht im Katalog steht.
- Neue Gerichte hinzufuegen.
- Gerichte bearbeiten.
- Gerichte deaktivieren statt hart loeschen.
- Tabletfreundliche Custom Card mit eigener Suche und Eingabefeldern.
- Datenhaltung lokal in JSON-Dateien, keine Datenbank noetig.

## Screens/Views

Die Lovelace-Oberflaeche besteht aus drei Views:

- `Essen`: Wochenplan erstellen und bearbeiten.
- `Neues Gericht`: Gericht mit Kategorie anlegen.
- `Gerichte bearbeiten`: bestehende aktive Gerichte suchen, umbenennen, Kategorie aendern oder deaktivieren.

Die beiden Admin-Views sind als `subview: true` gedacht, damit sie nicht als
normale Tabs erscheinen.

## Projektstruktur

```text
custom_components/essen/      Home-Assistant-Custom-Integration
www/essen-planer-card.js      Lovelace-Custom-Card
config/essen/essen_cli.py     Robuster CLI-Helfer fuer shell_command
examples/                     Beispiel-Daten und Copy/Paste-Konfiguration
docs/                         Detaildokumentation
tools/install_to_config.sh    Optionales Kopierskript fuer /config
```

## Installation

### 1. Dateien kopieren

Repository auf deinen Home-Assistant-Server kopieren oder klonen und dann:

```bash
./tools/install_to_config.sh /config
```

Das Skript kopiert:

- `custom_components/essen` nach `/config/custom_components/essen`
- `www/essen-planer-card.js` nach `/config/www/essen-planer-card.js`
- `config/essen/essen_cli.py` nach `/config/essen/essen_cli.py`
- Beispieldaten nach `/config/essen/gerichte.json`, falls dort noch keine Datei existiert
- leere Plan-Datei nach `/config/essen/wochenplaene.json`, falls dort noch keine Datei existiert

Alternativ kannst du die Dateien manuell an dieselben Orte kopieren.

### 2. Home Assistant konfigurieren

Den Inhalt aus [`examples/configuration-snippet.yaml`](examples/configuration-snippet.yaml)
in `configuration.yaml` uebernehmen.

Wichtig: Falls `sensor:` oder `shell_command:` bei dir schon existieren, diese
Top-Level-Keys nicht doppelt anlegen, sondern nur die eingerueckten Eintraege in
die bestehenden Abschnitte kopieren.

Minimal benoetigt:

```yaml
essen:

sensor:
  - platform: essen

shell_command:
  essen_publish: "python3 /config/essen/essen_cli.py publish"
  essen_create_plan: "python3 /config/essen/essen_cli.py create_plan --year {{ year | int }} --week {{ week | int }}"
  essen_reroll_day: "python3 /config/essen/essen_cli.py reroll_day --year {{ year | int }} --week {{ week | int }} --day '{{ day }}'"
  essen_set_day: "python3 /config/essen/essen_cli.py set_day --year {{ year | int }} --week {{ week | int }} --day '{{ day }}' --dish-name '{{ dish_name }}'"
  essen_clear_day: "python3 /config/essen/essen_cli.py clear_day --year {{ year | int }} --week {{ week | int }} --day '{{ day }}'"
  essen_add_dish: "python3 /config/essen/essen_cli.py add_dish --name '{{ name }}' --klasse {{ klasse | int }}"
  essen_update_dish: "python3 /config/essen/essen_cli.py update_dish --dish-id {{ dish_id | int }} --name '{{ name }}' --klasse {{ klasse | int }}"
  essen_deactivate_dish: "python3 /config/essen/essen_cli.py deactivate_dish --dish-id {{ dish_id | int }}"
```

### 3. Lovelace-Ressource eintragen

In Home Assistant:

```text
Einstellungen -> Dashboards -> Ressourcen -> Ressource hinzufuegen
```

```yaml
url: /local/essen-planer-card.js?v=20260607-1
type: module
```

Bei spaeteren Aenderungen an `essen-planer-card.js` die Version hinter `?v=`
erhoehen, damit Tablets/Browser nicht die alte Datei aus dem Cache verwenden.

### 4. Views anlegen

Die drei Views aus [`examples/lovelace-views.json`](examples/lovelace-views.json)
in dein Dashboard uebernehmen. Einzelne Dateien liegen zusaetzlich hier:

- [`examples/lovelace-view-plan.json`](examples/lovelace-view-plan.json)
- [`examples/lovelace-view-new.json`](examples/lovelace-view-new.json)
- [`examples/lovelace-view-edit.json`](examples/lovelace-view-edit.json)

### 5. Pruefen und neu starten

In der HA-SSH-Konsole:

```bash
ha core check
ha core restart
```

Danach sollte der View `/lovelace/essen` erreichbar sein.

## Kategorien / Klassen

Die Kategorie ist im JSON-Feld `klasse` gespeichert. Sie bildet nicht die Art
des Essens ab, sondern die Planungsregel.

| Klasse | Bedeutung | Regel |
|---:|---|---|
| 1 | Alltag / schnell genug | darf beliebig oft vorkommen, aber dasselbe Gericht nicht doppelt in einer Woche |
| 2 | etwas aufwaendiger | maximal 2x pro Woche |
| 3 | deutlich aufwaendig / selten | maximal 1x pro Woche |
| 4 | Wochenendessen | nur Samstag oder Sonntag, maximal 1x pro Woche |

Beispiel: In den Beispieldaten ist `Schnitzel mit Pommes` Klasse 4. Beim
Generieren wird es deshalb nur fuer Samstag oder Sonntag beruecksichtigt.

Mehr Details stehen in
[`docs/kategorien-und-planlogik.md`](docs/kategorien-und-planlogik.md).

## Datenhaltung

Es wird keine externe Datenbank benoetigt. Die Integration arbeitet lokal mit
JSON-Dateien:

```text
/config/essen/gerichte.json
/config/essen/wochenplaene.json
/config/www/essen-gerichte.json
/config/www/essen-wochenplaene.json
```

`gerichte.json` ist der eigentliche Gerichtskatalog. `wochenplaene.json`
enthaelt die gespeicherten Wochenplaene. Die Dateien unter `/config/www` sind
oeffentliche Kopien fuer die Lovelace-Card, damit die UI nach Aenderungen sofort
frische Daten laden kann.

Siehe auch [`docs/datenmodell.md`](docs/datenmodell.md).

## Bedienung

Plan erstellen:

1. Im View `Essen` bei `Plan erstellen` diese Woche oder naechste Woche waehlen.
2. `Plan erstellen` klicken.
3. Die Woche wird nach Kategorienregeln gefuellt.

Tag neu wuerfeln:

1. Beim gewuenschten Tag den Sync/Wuerfel-Button klicken.
2. Nur dieser Tag wird neu gesetzt.

Gericht aus Liste waehlen:

1. Beim Tag auf das Listen-Icon klicken.
2. Gericht suchen oder antippen.
3. Der Tag wird auf dieses Gericht gesetzt.

Freitext setzen:

1. In das Tagesfeld schreiben, z.B. `Resteessen`.
2. Enter druecken oder das Feld verlassen.
3. Wenn der Text keinem aktiven Gericht entspricht, wird er als freie Planung gespeichert.

Gericht hinzufuegen:

1. `Neues Gericht` oeffnen.
2. Namen eingeben.
3. Klasse waehlen.
4. `Gericht hinzufuegen` klicken.

Gericht deaktivieren:

1. `Gerichte bearbeiten` oeffnen.
2. Gericht suchen und auswaehlen.
3. `Gericht loeschen` klicken.
4. Das Gericht bleibt in der JSON-Historie, wird aber nicht mehr fuer neue Plaene genutzt.

## Hinweise

- Die Custom Card nutzt aktuell `shell_command.*`, weil das in der Praxis auf
  Tablets robuster war als direkte Frontend-Aufrufe der Integration-Services.
- Die Integration registriert trotzdem eigene Services wie `essen.create_plan`.
  Diese koennen in Developer Tools oder Automationen verwendet werden.
- Wenn die Karte nach einem Update nicht neu aussieht: Lovelace-Ressourcen-Version
  erhoehen und Browser/App neu laden.
- Fuer oeffentliche Repos bitte eine Lizenz ergaenzen, wenn andere den Code
  wirklich weiterverwenden duerfen.

## Weiterfuehrende Doku

- [Installation im Detail](docs/installation.md)
- [Kategorien und Planlogik](docs/kategorien-und-planlogik.md)
- [Datenmodell](docs/datenmodell.md)
- [Entwicklungsnotizen und offene Ideen](docs/entwicklungsnotizen.md)
