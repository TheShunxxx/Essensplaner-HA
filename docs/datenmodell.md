# Datenmodell

Der Essensplaner braucht keine Datenbank. Alle Daten liegen lokal als JSON in
`/config/essen`.

## Dateien

```text
/config/essen/gerichte.json
/config/essen/wochenplaene.json
/config/www/essen-gerichte.json
/config/www/essen-wochenplaene.json
```

`/config/essen` ist die eigentliche Datenhaltung. Die Dateien unter
`/config/www` sind veröffentlichte Kopien für das Lovelace-Frontend.

## gerichte.json

Beispiel:

```json
{
  "version": 1,
  "dishes": [
    {
      "id": 12,
      "name": "Schnitzel mit Pommes",
      "klasse": 4,
      "active": true
    }
  ]
}
```

Felder:

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | Zahl | stabile interne ID |
| `name` | Text | Anzeigename und Suchtext |
| `klasse` | Zahl | Planungsregel 1 bis 4 |
| `active` | Boolean | nur aktive Gerichte werden neu eingeplant |

Beim "Löschen" in der UI wird ein Gericht nicht entfernt, sondern auf
`"active": false` gesetzt. So bleiben alte Wochenpläne nachvollziehbar.

## wochenplaene.json

Leerer Startzustand:

```json
{
  "version": 1,
  "current_plan": null,
  "plans": {}
}
```

Ein gespeicherter Plan:

```json
{
  "version": 1,
  "current_plan": "2026-W23",
  "plans": {
    "2026-W23": {
      "key": "2026-W23",
      "year": 2026,
      "week": 23,
      "created_at": "2026-06-01T12:00:00",
      "updated_at": "2026-06-01T12:00:00",
      "days": [
        {
          "key": "montag",
          "name": "Montag",
          "date": "2026-06-01",
          "date_display": "01.06.",
          "dish_id": 1,
          "dish_name": "Nudeln mit Tomatensauce",
          "klasse": 1,
          "custom": false
        }
      ]
    }
  }
}
```

Wichtige Felder pro Tag:

| Feld | Bedeutung |
|---|---|
| `key` | technischer Tag, z.B. `montag` |
| `name` | Anzeigename |
| `date` | ISO-Datum |
| `date_display` | kurze Anzeige |
| `dish_id` | ID aus `gerichte.json`, oder `null` bei Freitext |
| `dish_name` | angezeigter Text |
| `klasse` | Klasse des Gerichts, oder `null` bei Freitext |
| `custom` | `true`, wenn der Text nicht aus dem Gerichtskatalog kommt |

## Sensoren

Die Integration stellt zwei Sensoren bereit:

- `sensor.essen_wochenplan`
- `sensor.essen_gerichte`

`sensor.essen_wochenplan` enthält den aktuellen Plan als Attribute. Wenn kein
Plan existiert, ist der Status `kein Plan`.

`sensor.essen_gerichte` enthält aktive und alle Gerichte als Attribute. Die UI
nutzt zusätzlich die JSON-Kopie in `/config/www`, damit Änderungen direkt im
Browser sichtbar werden.

## Backup

Vor größeren Änderungen reicht normalerweise ein Backup von:

```text
/config/essen/gerichte.json
/config/essen/wochenplaene.json
```

Die Dateien unter `/config/www` werden von der Integration automatisch aktualisiert.
