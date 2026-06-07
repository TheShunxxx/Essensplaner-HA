# Kategorien und Planlogik

Der Essensplaner nutzt das Feld `klasse`, um einfache Regeln für die automatische Planung abzubilden.

| Klasse | Bedeutung | Regel |
|---:|---|---|
| 1 | Alltag | keine zusätzliche Begrenzung |
| 2 | etwas aufwendiger | maximal 2 Gerichte pro Woche |
| 3 | selten / aufwendig | maximal 1 Gericht pro Woche |
| 4 | Wochenendessen | nur Samstag oder Sonntag, maximal 1 Gericht pro Woche |

Zusätzlich gilt für alle Klassen: dasselbe Gericht wird innerhalb einer Woche nicht doppelt eingeplant.

## Beispiel

`Schnitzel mit Pommes` ist in den Beispieldaten Klasse 4. Der Generator darf es deshalb nur am Samstag oder Sonntag auswählen.

## Ablauf beim Erstellen eines Plans

1. Es wird ein leerer Plan für Montag bis Sonntag erzeugt.
2. Für jeden Tag wird die aktive Gerichtsliste zufällig gemischt.
3. Das erste Gericht, das alle Regeln erfüllt, wird gesetzt.
4. Bereits gesetzte Tage beeinflussen die Auswahl für die nächsten Tage.

Wenn zu wenige aktive Gerichte vorhanden sind, kann der Generator keinen vollständigen Plan füllen. In der Praxis sollte man deshalb deutlich mehr aktive Gerichte haben als sieben.
