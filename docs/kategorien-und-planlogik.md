# Kategorien und Planlogik

Der Essensplaner verwendet das Feld `klasse`, um Gerichte nach Aufwand und
Planungsregeln zu unterscheiden. Die Klassen sind bewusst einfach gehalten,
damit man beim Anlegen eines Gerichts schnell entscheiden kann, wie oft es in
einer Woche vorkommen darf.

## Klassen

| Klasse | Kurzname in der UI | Gedanke | Generator-Regel |
|---:|---|---|---|
| 1 | Beliebig oft | normales Alltagsessen | keine Klassenbegrenzung |
| 2 | Max. 2x Woche | mittlerer Aufwand | hoechstens 2 Gerichte dieser Klasse pro Woche |
| 3 | Max. 1x Woche | eher aufwaendig oder selten | hoechstens 1 Gericht dieser Klasse pro Woche |
| 4 | Nur am WE | Wochenendessen | nur Samstag/Sonntag und hoechstens 1 Gericht dieser Klasse pro Woche |

Unabhaengig von der Klasse gilt: dasselbe Gericht wird in derselben Woche nicht
doppelt eingeplant.

## Beispiel

In den Beispieldaten ist `Schnitzel mit Pommes` als Klasse 4 angelegt:

```json
{ "id": 12, "name": "Schnitzel mit Pommes", "klasse": 4, "active": true }
```

Beim Erstellen eines Wochenplans prueft der Generator deshalb:

1. Ist der aktuelle Tag Samstag oder Sonntag?
2. Wurde in dieser Woche schon ein Klasse-4-Gericht verwendet?
3. Wurde genau dieses Gericht schon in dieser Woche verwendet?

Nur wenn alle Pruefungen passen, darf `Schnitzel mit Pommes` in den Plan.

## Algorithmus in Kurzform

Die Logik sitzt an zwei Stellen:

- `custom_components/essen/__init__.py` fuer die Integration-Services.
- `config/essen/essen_cli.py` fuer die von der Lovelace-Card genutzten `shell_command`-Aufrufe.

Die zentrale Pruefung heisst in beiden Dateien sinngemaess `dish_allowed`.

Beim Erstellen eines Plans:

1. Ein leerer Plan fuer Montag bis Sonntag wird erzeugt.
2. Fuer jeden Tag wird die aktive Gerichtsliste zufaellig gemischt.
3. Das erste Gericht, das alle Regeln erfuellt, wird gesetzt.
4. Bereits gesetzte Tage beeinflussen die Regeln fuer die naechsten Tage.

Beim Neu-Wuerfeln eines Tages:

1. Der konkrete Tag wird zuerst geleert.
2. Danach wird nur fuer diesen Tag ein neues erlaubtes Gericht gesucht.
3. Die restlichen Tage bleiben unveraendert.

## Warum Klasse statt Kategorie-Namen?

Die erste Version kam aus einem Excel/VBA-Planer mit numerischen Klassen. Das
ist beibehalten worden, weil es in der Bedienung schnell ist und die Regeln
stabil bleiben, auch wenn man die angezeigten Texte spaeter anpasst.

Wer sprechendere Namen moechte, kann die UI-Texte in `essen-planer-card.js`
anpassen. Das Datenmodell braucht dafuer keine Migration, solange `klasse` eine
Zahl von 1 bis 4 bleibt.

## Grenzen

- Der Generator garantiert keine perfekte Verteilung, sondern waehlt zufaellig
  aus den aktuell erlaubten Gerichten.
- Wenn zu wenige aktive Gerichte vorhanden sind, kann der Generator keinen
  vollstaendigen Plan erzeugen.
- Klasse 4 bedeutet in dieser Vorlage Samstag/Sonntag. Freitag zaehlt nicht als
  Wochenende.
