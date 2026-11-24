# Hanna Erfassung: Stand

PWA zum Erfassen von Einnahmen, Wachphasen, Nebenwirkungen, Fokus, Essen und Trinken, Blutdruck und Notizen am iPhone. Offline, Upload ins Business-OneDrive über Microsoft Graph. Auftrag: `AI_Projekte/bereiche/gesundheit/handoff/2026-11-14_Hanna_Auftrag-Kai_Hanna-App.md`; Format: `AI_Projekte/bereiche/gesundheit/erfassung/LOGFORMAT.md`. Fassung 0.4.1 (Stand des Plans und Dosis-Vorwahl, Kai, 24.11.2026; Vorgänger 0.4.0 Befindens-Log, 22.11.2026).

## Aufbau

| Datei | Inhalt |
|---|---|
| `docs/` | die App, so wie GitHub Pages sie ausliefert (kein Build-Schritt) |
| `docs/format.js` | Logformat, ULID, Ortszeit mit Zeitzone, Vereinigen von Dateien, wirksame Ereignisse (gleiche Regel wie der Import) |
| `docs/speicher.js` | IndexedDB auf dem Gerät: Ereignisse, Token, Konfiguration |
| `docs/anmeldung.js` | Anmeldung bei Entra (Code-Flow mit PKCE, ohne Bibliothek) |
| `docs/abgleich.js` | Upload: je Tag des Erfassens und Gerät eine Datei; lesen, vereinigen, schreiben mit eTag |
| `docs/konfig.js` | Tenant, Client-ID, Ordner im OneDrive. **Keine Gesundheitsdaten im Code**; die Mittel kommen zur Laufzeit aus `konfig.json` im OneDrive (erzeugt von `generate_views.py`) |
| `docs/sw.js` | Service Worker, App offline. **Bei jeder Änderung `STAND` hochzählen**, sonst sieht das Handy die alte Fassung |
| `dev_server.py` | lokaler Test: liefert `docs/` aus und spielt OneDrive nach (nur `--wurzel`). Auf localhost Testmodus ohne Anmeldung |
| `test/format.test.mjs` | `npm test` (prüft auch, dass `VERSION`, `STAND` und `package.json` gleich sind) |

## Prüfen

```
cd C:\AI_Lokal\hanna-erfassung
npm test
py dev_server.py --wurzel %TEMP%\hanna_test_onedrive --port 8790
```

Vorschau in Claude Code: `hanna-erfassung` in `AI_Projekte/.claude/launch.json`.

## Bedienung 0.4: Rückblick (Befindens-Log, 22.11.2026)

- Oben im Reiter **Heute**, Tagesgrenze 04:00: von 04:00 bis 17:59 die Karte **Letzte Nacht** (Schlafgefühl 1 bis 5 Pflicht; optional geschwitzt, Herzklopfen, unruhig, Gläser am Vorabend 0 bis 3+, nur wenn noch kein Alkohol erfasst ist; eine Zeile). Ab 18:00 bis 03:59 **Wie war der Tag?** (Energie, Fokus, Stimmung 1 bis 5 Pflicht; optional krank, Reise, Stress, hartes Training; „heute keine“ Nebenwirkungen, ausgeblendet wenn es an dem Tag schon eine gibt). Anker: 1 und 5 als Extrem, **3 = wie meist**.
- Fehlt der Rückblick des Vortags (morgens) bzw. der Nacht (abends), steht eine Zeile „noch nicht bewertet · nachtragen“. Gespeichert: eine Zeile mit ✓ und „ändern“ (Blatt, mit Löschen).
- Unter der Abendkarte **Noch offen**, nur Medikamente: Gaben nach Fensterbeginn ohne Eintrag (Genommen öffnet das Einnahme-Blatt, Ausgelassen speichert mit Planzeit, geschätzt) und Medikamente bei Bedarf ohne Eintrag (Heute nicht = `ausgelassen`, Grund „heute nicht“). Supplemente erscheinen dort nie.
- „Genommen“ unter „Noch offen“ nach Mitternacht (Karte des Vortags) belegt die Uhrzeit mit der Planzeit des Vortags vor (geschätzt), damit die Einnahme nicht auf den neuen Kalendertag fällt. Bedarf-Einnahmen bis 03:59 zählen in der Karte zum Vortag; der Import bucht Einnahmen weiter nach Kalendertag.
- Die Wahl in einer offenen Karte steht in `zustand.entwurf` und übersteht das Neuzeichnen (Abgleich, Minutentakt). Während in die Zeile getippt wird, zeichnet die Karte nicht neu.
- Logformat: `rueckblick_nacht`, `rueckblick_tag` (LOGFORMAT.md). Die Regeln `logTag`, `rueckblickKarten`, `offeneMedikamente`, `pruefeRueckblick` liegen in `format.js` mit Tests.
- Bewusst nicht: direkte Adressen `#morgen`/`#abend` für einen iOS-Kurzbefehl. Ein Kurzbefehl öffnet die Adresse in Safari, und Safari hat einen anderen Speicher als die App auf dem Home-Bildschirm; Einträge lägen dann am falschen Ort. Erinnerung stattdessen über einen Kalendertermin um 21:00 (Entscheid Christian 22.11.).

## Bedienung 0.4.1: Stand des Plans (Gremium #9, 24.11.2026)

- „Heute“ zeigt über der Checkliste „Plan vom TT.MM., HH:MM“ (Feld `erzeugt` in `konfig.json`). Ist der Plan nicht vom heutigen Kalendertag (Entscheid Christian 24.11.: Grenze Kalendertag, nicht 24 h) und gibt es Medikamente mit Plan-Dosis, ist der Hinweis orange umrandet, und die Zeilen zeigen „(alter Plan)“. Ohne lesbares `erzeugt` gilt der Plan nie als aktuell.
- Dosis-Vorwahl nur, wenn der Plan vom Tag der Einnahme ist (`planStand`, `dosisVorschlag` mit `planAktuell`). Sonst „Plan vom …“ und „Zuletzt …“ ohne Vorwahl. Beim Speichern wird nachgeprüft: Wurde die Zeit auf einen anderen Tag gestellt oder stand das Blatt über Mitternacht offen, gilt eine nicht von Hand gewählte Dosis nicht (`vorwahlGilt`), die Wahl wird geleert. Beim Ändern bleibt die bisherige Dosis.
- Jeden Morgen bis zum ersten Tageslauf (ab 06:05, Laptop am Netz) und zum Abgleich ist der Plan „nicht von heute“: dann wird nichts vorgewählt. So gewollt.
- Ändern ohne passende Planzeile (Gabe inzwischen weg): Blatt „anderes Mittel“ mit eigenem Feld „Dosis in mg“ (vorbelegt, leer = keine); die Gabe bleibt, solange das Mittel gleich bleibt.
- Import: Eine per Rückgängig wiederhergestellte Einnahme (Inhalt gleich der ersten Fassung der Kette) zeigt die Zusammenfassung nicht mehr als „(korrigiert)“ (`_wie_ursprung` in `erfassung_import.py`).

Durchgespielt 0.4.1 am 24.11. (Testmodus, 375 px): Plan vom 22.11. orange markiert, „(alter Plan)“ an den Zeilen, Dosis-Blatt ohne Vorwahl, Speichern ohne Wahl abgewiesen; Gegenprobe Plan von heute: 10 mg vorgewählt, leise Zeile. Offene Gabe mit Vorwahl, Zeit auf gestern gestellt: abgewiesen („Der Plan ist nicht vom 23.11., bitte Dosis wählen.“), Wahl geleert, Handwahl 5 mg gespeichert. Ändern mit weggefallener Gabe: mg-Feld 10, auf 7,5 geändert, Gabe erhalten. Alle 10 hochgeladenen Zeilen bestehen `pruefe_zeile`. Tests: PWA 28, Import 36. Prüfer (unabhängig, schlank): 0 kritisch, 2 wichtig, 4 klein, alle behoben.

Durchgespielt 0.4.0 am 22.11. (Testmodus, 375 px): Speichern ohne Werte abgewiesen („Noch wählen: …“), Wahl bleibt nach Neuzeichnen stehen, Bedarf „Heute nicht“, Gabe „Ausgelassen“ (~12:30), Abendkarte gespeichert, Nacht nachgetragen mit Merkmal, Gläsern und Zeile, Ändern im Blatt (Energie 2 → 3, ersetzt). Hochgeladene Zeilen bestehen `pruefe_zeile`; Probelauf des Imports auf einer Kopie der echten `hanna.db` schreibt sie nach `befinden_tag`.

## Bedienung (0.3)

- Reiter unten: **Heute** (Checkliste nach Tageszeit), **Erfassen** (Befinden, Nebenwirkung, Essen und Trinken, Blutdruck, Notiz), **Nacht** (Wach / Wieder schlafen), **Verlauf** (Tagesliste, Konto, Gerät, Sicherung).
- Einnahmen speichern nur im Blatt: Genommen oder Ausgelassen mit Grund (ohne Dosis). Medikamente mit Dosis je Gabe und Dosisknöpfen. **Dosis-Vorbelegung (Entscheid Christian 14.11., ersetzt die frühere Vorbelegung mit der letzten Dosis):** Plan, wenn letzte Dosis gleich oder unbekannt; weichen Plan und letzte Dosis ab, oder hat das Medikament keine Plan-Dosis (keine Gaben), wird nichts vorgewählt und beide Werte stehen gleich gross da; gespeichert wird erst nach einer Wahl. Eine Dosis ausserhalb `dosis_optionen` und Plan fragt vor dem Speichern nach.
- Zeit: Medikamente immer „Jetzt“ vorbelegt, die Planzeit bleibt als Chip. Supplemente im Zeitfenster „jetzt“, sonst Planzeit, als geschätzt markiert (`~`).
- Rückgängig im Hinweis: beim ersten Erfassen ein Storno, nach einer Änderung (auch „Wieder schlafen“) kommt die Vorfassung als neue Zeile zurück. Ist der Eintrag inzwischen gelöscht, macht Rückgängig nichts.
- Banner auf jedem Reiter, sobald der älteste nicht hochgeladene Eintrag 24 h alt ist. Im Verlauf steht, ob der Browser den Speicher dauerhaft hält (`navigator.storage.persist()`).
- Sammelknopf je Tageszeit nur für Supplemente. Befinden mit vier Skalen, alle 5 = gut. Essen und Trinken mit einem Tipp, danach „Zeit ändern“ oder „Rückgängig“.
- Doppeltipps speichern nur einmal; ein Tipp in den Rand des Blatts verwirft nichts.
- Medikamente und ihre Gaben kommen aus `konfig.json` (im OneDrive, erzeugt aus der Tabelle `medikament_gaben` in `hanna.db` und dem Protokoll; bis 22.11.2026 aus `gaben.json`); im Code stehen keine Namen.

Durchgespielt 0.3.1 am 14.11. (Testmodus, 375 px): Medikament nach dem Zeitfenster (Jetzt vorgewählt, Plan als Chip), Dosis am Steigerungstag ohne Vorwahl mit Plan/Zuletzt, Speichern ohne Wahl abgewiesen, 15 mg mit Rückfrage, 20 → 10 → 5 → Rückgängig = 10, Ausgelassen ohne `dosis_mg`, Wach beenden und Rückgängig, Bedarfsmedikament ohne Vorwahl, Löschen nach Ändern und dann Rückgängig = nichts, Rückstand-Banner offline. 10 hochgeladene Zeilen bestehen `pruefe_zeile`. Prüfer (unabhängig): 1 hoch, 3 mittel behoben bzw. ausgelagert (siehe Offen).

Durchgespielt 0.3.0 am 14.11. (Testmodus, Browser 375 px): Checkliste, Planzeit, Sammelblatt mit Abwahl, Dosis je Gabe, Ausgelassen mit Grund, Befinden mit Pflichtprüfung, Nebenwirkung mit Stärke, Kaffee mit Zeit ändern, Blutdruck-Prüfung, Wachphase, Doppeltipps, Abgleich. 15 hochgeladene Zeilen bestehen die Prüfung von `erfassung_import.py`; ein Lauf auf einer Kopie von `hanna.db` leitete richtig ab.

## Betrieb

- **Adresse:** `https://hz-erfassung.github.io/app/`, Repo `hz-erfassung/app` (öffentlich, eigene Organisation, damit die App eine eigene Herkunft und damit eigenen Speicher hat). Pages aus `main` / `docs`. Commits unter der noreply-Adresse.
- **Entra:** App-Registrierung „Hanna Erfassung“ (SPA, ein Mandant), Umleitung `https://hz-erfassung.github.io/app/`, delegiert `Files.ReadWrite`, `offline_access`, `openid`. Client-ID steht in `docs/konfig.js`. Microsoft nimmt die Anmeldeanfrage an (geprüft bis zur Anmeldeseite).
- **Neue Fassung veröffentlichen:** `STAND` in `docs/sw.js` und `VERSION` in `docs/app.js` hochzählen, `npm test`, committen, `git push`. Pages braucht rund eine Minute.

## Offen

Erster echter Lauf mit 0.3.1 am 15.11. erfolgreich (Christian): GitHub-Organisation gehärtet (ein Owner, 2FA, Ruleset gegen Löschen und Force Push auf `main`, nur Repo `app`), Zustimmungsdialog geprüft, Erfassen und Import laufen.


1. **Aus der Prüfung 0.3.1:** gemeinsame Testfälle JS/Python (#15). Die übrigen Punkte (#9, Ändern ohne Planzeile, „korrigiert“) sind mit 0.4.1 erledigt.

## Bekannte Grenzen

- Entra gibt einer SPA ein Refresh-Token für höchstens 24 Stunden. Zum Hochladen braucht es danach eine neue Anmeldung (ein Tipp, Microsoft-Seite). Erfassen geht immer ohne.
- Graph legt fehlende Ordner beim Hochladen per Pfad an; im echten OneDrive noch nicht gesehen. Gelesen wird über `@microsoft.graph.downloadUrl` (der Testserver spielt die Weiterleitung von `:/content` nach).
- Nicht hochgeladene Einträge liegen nur auf dem Gerät. Vor dem Löschen oder Neuinstallieren muss „✓“ stehen. Notweg: „Offene sichern“ gibt eine Datei im Logformat weiter; am Laptop nach `erfassung/eingang/sicherung/` legen, der Import überspringt bekannte Einträge.
- `Files.ReadWrite` erlaubt der App das ganze OneDrive. Enger geht es nur mit einem anderen Ablageort (App-Ordner), dann müsste der Import dort lesen.
- Supplemente tragen keine Dosis; Medikamente schon (je Gabe).
- Einnahmen aus 0.2.x (ohne `gabe`) zählen in „Heute“ nicht als erledigt; für den Import gültig.
- Nach jedem Abgleich wird „Heute“ neu gezeichnet; ein Tipp genau in diesem Augenblick kann verloren gehen (Eingaben im Blatt nie).
- Etappe B fertig (23.11.2026): Rückblicke und Tagesgrenze in 0.4.0; Gaben-Tabelle `medikament_gaben` und Ableitung je Gabe (`tageslog_gaben`) nur am Laptop (Import, `gaben_pflege.py`), die App blieb dafür unverändert; Sammelknopf seit 0.3.0. Etappe C: Nachtmodus, Wochenübersicht.
