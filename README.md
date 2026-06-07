# Essensplaner für Home Assistant

Ein Essensplaner für Home Assistant mit Wochenplan, Gerichteliste und einfachen Regeln für aufwendigere Gerichte.

## Funktionen

- Wochenplan für Montag bis Sonntag erstellen
- Plan für diese oder nächste Woche generieren
- einzelne Tage neu würfeln
- Tage leeren oder frei überschreiben
- Gericht aus einer suchbaren Liste auswählen
- neue Gerichte hinzufügen
- Gerichte bearbeiten oder deaktivieren
- lokale Datenhaltung in JSON-Dateien, keine Datenbank nötig

## Kategorien

Jedes Gericht hat eine Klasse. Die Klasse steuert, wie oft und wann ein Gericht eingeplant werden darf.

| Klasse | Bedeutung | Regel |
|---:|---|---|
| 1 | Alltag | keine zusätzliche Begrenzung |
| 2 | etwas aufwendiger | maximal 2 Gerichte pro Woche |
| 3 | selten / aufwendig | maximal 1 Gericht pro Woche |
| 4 | Wochenendessen | nur Samstag oder Sonntag, maximal 1 Gericht pro Woche |

Dasselbe Gericht wird in einer Woche nicht doppelt eingeplant.

## Installation über HACS

Dieses Repository ist als **HACS Custom Repository** gedacht.

1. HACS öffnen.
2. Oben rechts das Drei-Punkte-Menü öffnen.
3. `Custom repositories` auswählen.
4. Repository eintragen:

   ```text
   https://github.com/ThomyieD/Essensplaner-HA
   ```

5. Kategorie `Integration` wählen.
6. Repository hinzufügen und `Essensplaner` installieren.
7. Home Assistant neu starten.
8. Unter `Einstellungen -> Geräte & Dienste -> Integration hinzufügen` den `Essensplaner` hinzufügen.

Beim ersten Start legt die Integration Beispieldaten an. Unter anderem ist `Schnitzel mit Pommes` als Wochenendgericht enthalten.

## Dashboard einrichten

Die Integration liefert die Dashboard-Karte selbst aus. Die Ressource muss einmal in Home Assistant eingetragen werden:

```yaml
url: /essen-planer/essen-planer-card.js?v=0.1.0
type: module
```

Danach drei Views im gewünschten Dashboard anlegen:

- `Essen`
- `Neues Gericht`
- `Gerichte bearbeiten`

Die fertigen View-Beispiele liegen in [`examples/lovelace-views.json`](examples/lovelace-views.json).

Die wichtigste Karte ist:

```yaml
type: custom:essen-planer-card
mode: plan
```

Für die beiden Unterseiten:

```yaml
type: custom:essen-planer-card
mode: new
```

```yaml
type: custom:essen-planer-card
mode: edit
```

## Daten

Die Daten liegen lokal in deinem Home-Assistant-Konfigurationsordner:

```text
/config/essen/gerichte.json
/config/essen/wochenplaene.json
```

Die Integration veröffentlicht zusätzlich aktuelle Kopien für die Dashboard-Karte:

```text
/config/www/essen-gerichte.json
/config/www/essen-wochenplaene.json
```

Beim Deaktivieren eines Gerichts wird es nicht gelöscht. Es bleibt in der Datei erhalten, wird aber nicht mehr für neue Pläne verwendet.

## Hinweise

- Wenn die Karte nach einem Update nicht neu geladen wird, die Version in der Ressource erhöhen, zum Beispiel `?v=0.1.1`.
- Wenn `custom:essen-planer-card` nicht gefunden wird, prüfen, ob die Ressource eingetragen ist und Home Assistant nach der Installation neu gestartet wurde.
- Das Repository ist aktuell für die Nutzung als HACS Custom Repository gedacht, nicht als offizieller HACS-Store-Eintrag.
