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

### Wenn HACS noch nicht installiert ist

Wenn HACS nicht in der Seitenleiste erscheint, muss HACS zuerst eingerichtet werden.

Bei Home Assistant OS oder Home Assistant Supervised geht das über die Oberfläche:

1. Die offizielle HACS-Anleitung öffnen: <https://hacs.dev/docs/use/download/download/>
2. Dort den My-Home-Assistant-Link zum Hinzufügen des HACS-Add-on-Repositorys verwenden.
3. Das Add-on `Get HACS` installieren und starten.
4. In den Logs des Add-ons den angezeigten Schritten folgen.
5. Home Assistant neu starten.
6. Unter `Einstellungen -> Geräte & Dienste -> Integration hinzufügen` nach `HACS` suchen und HACS einrichten.
7. Bei GitHub anmelden und den angezeigten Gerätecode bestätigen.

Falls HACS danach noch nicht sichtbar ist, den Browser-Cache leeren oder die Seite hart neu laden.

Bei Home Assistant Container oder Home Assistant Core wird HACS nicht über ein Add-on installiert. Dafür die Container/Core-Anleitung auf der HACS-Seite verwenden.

### Essensplaner installieren

1. HACS öffnen.
2. Oben rechts das Drei-Punkte-Menü öffnen.
3. `Custom repositories` auswählen.
4. Repository eintragen:

   ```text
   https://github.com/ThomyieD/Essensplaner-HA
   ```

5. Kategorie `Integration` wählen.
6. Repository hinzufügen.
7. Den Essensplaner in der HACS Übersicht auswählen und dort den Essensplaner installieren/herunterladen.
8. Home Assistant neu starten.
9. Unter `Einstellungen -> Geräte & Dienste -> Integration hinzufügen` den `Essensplaner` hinzufügen.

Beim ersten Start legt die Integration Beispieldaten an.

## Dashboard einrichten

### Ressource eintragen

Der Essensplaner nutzt eine eigene Dashboard-Karte. Home Assistant muss diese
Karte einmal als **Ressource** laden, sonst kennt das Dashboard
`custom:essen-planer-card` nicht.

1. In Home Assistant `Einstellungen -> Dashboards` öffnen.
2. Oben rechts das Drei-Punkte-Menü öffnen.
3. `Ressourcen` auswählen.
4. `Ressource hinzufügen` auswählen.
5. Diese Werte eintragen:

   | Feld | Wert |
   |---|---|
   | URL | `/local/essen-planer-card.js?v=0.1.3` |
   | Ressourcentyp | `JavaScript-Modul` |

   In das URL-Feld wirklich nur den Pfad eintragen, also ohne `URL:` davor.
   Die Zahl hinter `?v=` ist nur für den Browser-Cache. Wenn diese URL schon
   einmal verwendet wurde und die Karte nicht lädt, einfach eine neue Zahl
   nehmen, zum Beispiel `?v=0.1.4`.

6. Speichern.
7. Den Browser oder die Home-Assistant-App einmal neu laden.

Wenn `Ressourcen` nicht sichtbar ist, im eigenen Benutzerprofil den
`Erweiterten Modus` aktivieren und danach erneut unter `Einstellungen -> Dashboards`
nachsehen.

### Views anlegen

Der Essensplaner braucht drei Dashboard-Views. Die Pfade müssen genau so heißen,
weil die Buttons in der Karte zwischen diesen Seiten wechseln:

| View | Pfad | Aufgabe |
|---|---|---|
| `Essen` | `essen` | Wochenplan anzeigen und bearbeiten |
| `Neues Gericht` | `essen-neu` | neues Gericht hinzufügen |
| `Gerichte bearbeiten` | `essen-bearbeiten` | vorhandene Gerichte ändern oder deaktivieren |

Am einfachsten ist der Weg über den YAML-Editor des Dashboards:

1. Das gewünschte Dashboard öffnen.
2. Dashboard bearbeiten.
3. Oben rechts das Drei-Punkte-Menü öffnen.
4. `Rohkonfigurationseditor` öffnen.
5. Den folgenden Block in die `views:`-Liste einfügen.

Wenn dein Dashboard noch leer ist, kann der Block komplett übernommen werden.
Wenn es schon andere Views gibt, nur die drei Einträge unterhalb von `views:`
in die vorhandene `views:`-Liste kopieren. Dabei auf die Einrückungen achten.

```yaml
views:
  - title: Essen
    path: essen
    icon: mdi:silverware-fork-knife
    type: panel
    cards:
      - type: custom:essen-planer-card
        mode: plan
  - title: Neues Gericht
    path: essen-neu
    icon: mdi:plus-box-outline
    type: panel
    subview: true
    cards:
      - type: custom:essen-planer-card
        mode: new
  - title: Gerichte bearbeiten
    path: essen-bearbeiten
    icon: mdi:playlist-edit
    type: panel
    subview: true
    cards:
      - type: custom:essen-planer-card
        mode: edit
```

`subview: true` sorgt dafür, dass `Neues Gericht` und `Gerichte bearbeiten`
nicht als eigene Reiter oben im Dashboard auftauchen. Sie werden nur über die
Buttons im Essensplaner geöffnet.

Die fertigen View-Beispiele liegen zusätzlich in
[`examples/lovelace-views.json`](examples/lovelace-views.json).

### Danach testen

Nach dem Speichern der Views:

1. Den Bearbeitungsmodus des Dashboards verlassen.
2. Browser oder Home-Assistant-App neu laden.
3. Den Tab `Essen` öffnen.

Wenn dort `Konfigurationsfehler` oder `Custom element doesn't exist:
essen-planer-card` steht, ist meistens die Dashboard-Ressource noch nicht
geladen. Dann diese Punkte prüfen:

- Wurde die Integration nach der HACS-Installation wirklich unter
  `Einstellungen -> Geräte & Dienste -> Integration hinzufügen -> Essensplaner`
  hinzugefügt?
- Ist die Ressource unter `Einstellungen -> Dashboards -> Ressourcen`
  eingetragen und als `JavaScript-Modul` gespeichert?

  | Feld | Wert |
  |---|---|
  | URL | `/local/essen-planer-card.js?v=0.1.4` |
  | Ressourcentyp | `JavaScript-Modul` |

  Im URL-Feld darf nicht `URL:` oder `Typ:` stehen.
  Der Wert hinter `?v=` muss nicht zur Integrationsversion passen. Er muss nur
  neu sein, wenn der Browser oder die Home-Assistant-App noch eine alte Datei
  im Cache hat.

  Alte Einträge mit anderen Versionen oder mit `/essen-planer/essen-planer-card.js`
  sollten entfernt werden.

- Lässt sich diese Adresse im Browser öffnen?

  ```text
  https://DEIN-HOME-ASSISTANT-IP:PORT/local/essen-planer-card.js?v=0.1.3
  ```

  Wenn dort JavaScript-Code erscheint, ist die Datei erreichbar. Dann die
  Home-Assistant-Seite neu laden.

  Wenn dort `404` oder `Not found` erscheint, ist die Integration noch nicht
  geladen oder Home Assistant wurde nach der Installation noch nicht neu
  gestartet.

- Wenn die Adresse zuerst `404` geliefert hat und nach dem Einrichten der
  Integration erst später funktioniert, den Wert hinter `?v=` erhöhen. Beispiel:

  `/local/essen-planer-card.js?v=0.1.4`

  Danach speichern und die Home-Assistant-Seite hart neu laden.

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
/config/www/essen-planer-card.js
```

Beim Deaktivieren eines Gerichts wird es nicht gelöscht. Es bleibt in der Datei erhalten, wird aber nicht mehr für neue Pläne verwendet.

## Hinweise

- Wenn die Karte nach einem Update nicht neu geladen wird, die Version in der Ressource erhöhen, zum Beispiel `?v=0.1.4`.
- Wenn `custom:essen-planer-card` nicht gefunden wird, prüfen, ob die Ressource eingetragen ist und Home Assistant nach der Installation neu gestartet wurde.
- Das Repository ist aktuell für die Nutzung als HACS Custom Repository gedacht, nicht als offizieller HACS-Store-Eintrag.
