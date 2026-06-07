# Installation im Detail

Diese Anleitung geht von Home Assistant OS oder Supervised mit SSH-Zugriff aus.
Die Pfade beziehen sich auf `/config`, also den Home-Assistant-Konfigurationsordner.

## Dateien kopieren

Variante mit Skript:

```bash
cd /config
git clone https://github.com/ThomyieD/Essensplaner-HA.git
cd Essensplaner-HA
./tools/install_to_config.sh /config
```

Variante manuell:

```bash
mkdir -p /config/custom_components/essen
mkdir -p /config/www
mkdir -p /config/essen

cp -r custom_components/essen/* /config/custom_components/essen/
cp www/essen-planer-card.js /config/www/essen-planer-card.js
cp config/essen/essen_cli.py /config/essen/essen_cli.py
chmod +x /config/essen/essen_cli.py
cp examples/gerichte.example.json /config/essen/gerichte.json
cp examples/wochenplaene.empty.json /config/essen/wochenplaene.json
```

Wenn du schon eigene Gerichte hast, `gerichte.json` nicht ueberschreiben.

## configuration.yaml

Aus `examples/configuration-snippet.yaml` uebernehmen.

Wichtig bei YAML:

- `essen:` darf einmal vorkommen.
- `sensor:` darf einmal vorkommen.
- `shell_command:` darf einmal vorkommen.

Wenn diese Abschnitte schon existieren, nur die neuen Untereintraege einruecken
und einfuegen.

## Lovelace-Ressource

Dashboard-Ressource:

```yaml
url: /local/essen-planer-card.js?v=20260607-1
type: module
```

Bei Cache-Problemen die Versionsnummer erhoehen.

## Lovelace-Views

Die drei Views stehen in `examples/lovelace-views.json`.

In Storage-Mode-Dashboards kannst du die Views ueber den Raw Configuration
Editor in dein Dashboard einfuegen. In YAML-Dashboards kannst du die JSON-Struktur
entsprechend als YAML uebernehmen.

Die Pfade sind:

- `/lovelace/essen`
- `/lovelace/essen-neu`
- `/lovelace/essen-bearbeiten`

Die Admin-Views sind `subview: true`.

## Pruefen

```bash
ha core check
ha core restart
```

Danach im Browser/App hart neu laden, falls die Custom Card noch nicht erscheint.

## Fehlerbilder

### Custom element doesn't exist: essen-planer-card

Die Ressource fehlt oder der Browser nutzt Cache.

Pruefen:

```text
/local/essen-planer-card.js?v=20260607-1
```

im Browser aufrufen. Es sollte JavaScript ausgeliefert werden.

### Sensoren fehlen

Pruefen, ob in `configuration.yaml` vorhanden:

```yaml
essen:

sensor:
  - platform: essen
```

Danach `ha core check` und Neustart.

### Plan wird nicht aktualisiert

Pruefen, ob die Shell-Commands vorhanden sind und `essen_cli.py` ausfuehrbar ist:

```bash
python3 /config/essen/essen_cli.py publish
```

Die Dateien `/config/www/essen-gerichte.json` und
`/config/www/essen-wochenplaene.json` sollten danach existieren.
