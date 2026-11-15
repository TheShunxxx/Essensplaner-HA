# Reste-Abgleich mit der Einkaufs-App

Die Einkaufs-App führt die Reste (Kühlschrank und Gefrierschrank). Home
Assistant bekommt nur eine Kopie: Nach jeder Änderung am Bestand schickt die App
den **kompletten Bestand** an den Webhook `essensplaner_reste`. Eine Automation
reicht ihn an den Dienst `essen.reste_ersetzen` weiter, der `reste.json` damit
ersetzt. Die Reste-Ansicht der Dashboard-Karte zeigt die Reste dann nur an.

> [!important]
> Reste nicht mehr in der Karte einbuchen, ändern oder löschen. Beim nächsten
> Abgleich überschreibt die Einkaufs-App den Bestand, solche Änderungen gehen
> dann verloren.

## Was die App schickt

`POST` an `http://HOME-ASSISTANT:8123/api/webhook/essensplaner_reste` mit
`Content-Type: application/json`:

```json
{
  "stand": "2026-11-14T12:00:00+00:00",
  "reste": [
    {
      "id": "app-1",
      "gericht": "Chili",
      "portionen": "2,5",
      "ort": "Kühlschrank",
      "datum_gekocht": "2026-11-14",
      "ablauf_datum": "2026-11-17"
    }
  ]
}
```

- `ort` ist `Kühlschrank` oder `Eingefroren`.
- `portionen` ist Text, auch mit Dezimalkomma.
- Eine leere Liste `"reste": []` heißt: keine Reste mehr.

## Dienst `essen.reste_ersetzen`

| Feld | Pflicht | Inhalt |
|---|---|---|
| `reste` | ja | Liste der Reste im Format oben |
| `stand` | nein | Zeitpunkt des Bestands (ISO 8601 mit Zeitzone) |

- Alle Einträge werden zuerst geprüft (id vorhanden und eindeutig, Gericht
  vorhanden, Portionen > 0, bekannter Ort, gültige Daten). Ist ein Eintrag
  ungültig, schlägt der Aufruf fehl und `reste.json` bleibt unverändert.
- Danach wird `reste.json` in einem Schritt ersetzt (temporäre Datei, dann
  umbenennen), die Kopie für die Karte (`/config/www/essen-reste.json`)
  aktualisiert und `essen_updated` gefeuert. Eine schon geöffnete Karte lädt
  die Reste noch nicht von selbst nach: Seite neu laden oder in der
  Reste-Ansicht aktualisieren.
- Kommt ein Abgleich mit älterem `stand` an als der zuletzt übernommene, wird er
  ignoriert. So überschreibt ein verspäteter Aufruf keinen neueren Bestand. Der
  letzte Stand wird nur im Speicher gehalten; nach einem Neustart von Home
  Assistant wird der erste Abgleich immer übernommen.

## Beispiel-Automation

In Home Assistant unter `Einstellungen -> Automationen & Szenen -> Automation
erstellen -> Als YAML bearbeiten` einfügen:

```yaml
alias: Essensplaner – Reste aus der Einkaufs-App übernehmen
description: >-
  Die Einkaufs-App schickt nach jeder Änderung den ganzen Reste-Bestand.
  Er ersetzt die Reste des Essensplaners.
mode: queued
max: 10
triggers:
  - trigger: webhook
    webhook_id: essensplaner_reste
    allowed_methods:
      - POST
    local_only: true
conditions:
  - condition: template
    value_template: "{{ trigger.json is defined and trigger.json.reste is defined }}"
actions:
  - action: essen.reste_ersetzen
    data:
      reste: "{{ trigger.json.reste }}"
      stand: "{{ trigger.json.stand | default('') }}"
```

- `local_only: true`: Der Webhook nimmt nur Aufrufe aus dem eigenen Netz an,
  nicht über Nabu Casa oder eine Portfreigabe. Die Webhook-ID ist leicht zu
  erraten, deshalb sollte das so bleiben.
- `mode: queued`: Kommen mehrere Abgleiche kurz hintereinander, laufen sie
  nacheinander statt sich gegenseitig abzubrechen.
- Die Bedingung verhindert, dass ein Aufruf ohne JSON-Inhalt den Bestand leert.
- Für Home Assistant vor 2024.10 heißt es `trigger:`/`platform: webhook`,
  `condition:` und `action:`/`service:` statt `triggers:`/`trigger:`,
  `conditions:` und `actions:`/`action:`.

## Ausprobieren

Aus dem Heimnetz, z. B. vom PC:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"stand": "2026-11-14T12:00:00+00:00", "reste": [{"id": "app-1", "gericht": "Chili", "portionen": "2,5", "ort": "Kühlschrank", "datum_gekocht": "2026-11-14", "ablauf_datum": "2026-11-17"}]}' \
  http://HOME-ASSISTANT:8123/api/webhook/essensplaner_reste
```

Danach zeigt die Reste-Ansicht der Karte den Eintrag „Chili“. Fehler stehen in
der Ablaufverfolgung der Automation und im Home-Assistant-Log.
