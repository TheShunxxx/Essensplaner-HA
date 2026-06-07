# Entwicklungsnotizen und offene Ideen

Diese Notizen beschreiben, warum die Vorlage so aufgebaut ist.

## Ursprung

Der Essensplaner ersetzt einen Excel/VBA-Planer. Die Kernfunktionen wurden
uebernommen:

- Gerichtskatalog mit ID, Name, Klasse und Aktivstatus.
- Wochenplan fuer eine Kalenderwoche.
- Zufallsauswahl mit Klassenregeln.
- einzelne Tage neu wuerfeln.
- manuelle Tagesauswahl.
- neue Gerichte hinzufuegen.
- Gerichte bearbeiten.
- Gerichte deaktivieren statt entfernen.

## Warum JSON statt Datenbank?

Fuer diesen Anwendungsfall reichen zwei Dateien:

- `gerichte.json`
- `wochenplaene.json`

Das macht Backup, Debugging und Teilen einfacher. Eine Datenbank waere erst
sinnvoll, wenn mehrere Benutzer gleichzeitig sehr viel schreiben oder wenn
Statistiken/Historien komplexer werden.

## Warum Custom Integration plus CLI?

Die Integration stellt Home-Assistant-Sensoren und Services bereit. Die
Lovelace-Card nutzt in dieser Version trotzdem `shell_command.*`, weil das auf
Tablets sehr robust war und die JSON-Fallbackdateien sofort aktualisiert.

Die CLI ist bewusst fast identisch zur Integrationslogik aufgebaut:

- gleiche Tagesreihenfolge.
- gleiche Klassenregeln.
- gleiche JSON-Struktur.
- gleiche Kommandos fuer Erstellen, Neu-Wuerfeln, Setzen, Leeren, Hinzufuegen,
  Aktualisieren und Deaktivieren.

## Umgesetzte UI-Verbesserungen

- Planansicht in einer eigenen Custom Card statt vieler einzelner Standardkarten.
- Direkter Wechsel zwischen Wochenplan, neuem Gericht und Bearbeiten-Ansicht.
- Dropdown fuer `Diese Woche` und `Naechste Woche`.
- Eingabefelder mit deaktivierter Autokorrektur, damit iOS/iPadOS nicht stoert.
- Suchbare Gerichtsliste fuer Tagesauswahl.
- Suchbare Bearbeiten-Liste.
- Freitext pro Tag, wenn ein Gericht nicht im Katalog stehen soll.
- Nach Aktionen werden die Fallback-JSON-Dateien neu geladen, damit die UI ohne
  Browser-Reload aktuell bleibt.

## Bekannte Grenzen

- Keine Mehrbenutzer-Sperre ausser einfacher Dateischreiblogik.
- Kein HACS-Paket.
- Keine Einkaufsliste.
- Keine automatische Rezeptverwaltung.
- Kein Kalenderexport.
- Keine Historienauswertung.

## Ideen fuer spaeter

- HACS-faehige Struktur bauen.
- Kategorien in `configuration.yaml` konfigurierbar machen.
- Einkaufsliste aus Wochenplan erzeugen.
- Wochenplan als Kalender-Entity ausgeben.
- Historie und Favoriten/Statistiken anzeigen.
- Gewichtete Zufallsauswahl, damit bestimmte Gerichte haeufiger/seltener kommen.
- Ausschlusslisten pro Wochentag.
- Import aus CSV/Excel.
