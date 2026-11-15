# Hanna Erfassung: Stand

PWA zum Erfassen von Einnahmen, Wachphasen, Nebenwirkungen, Fokus, Essen und Trinken, Blutdruck und Notizen am iPhone. Offline, Upload ins Business-OneDrive über Microsoft Graph. Auftrag: `AI_Projekte/bereiche/gesundheit/handoff/2026-11-14_Hanna_Auftrag-Kai_Hanna-App.md`; Format: `AI_Projekte/bereiche/gesundheit/erfassung/LOGFORMAT.md`. Fassung 0.3.1 (Reparatur nach Gremium, Handoff `2026-11-14_Gremium_Auftrag-Kai_Hanna-0.3.1.md`), 14.11.2026.

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

## Bedienung (0.3)

- Reiter unten: **Heute** (Checkliste nach Tageszeit), **Erfassen** (Befinden, Nebenwirkung, Essen und Trinken, Blutdruck, Notiz), **Nacht** (Wach / Wieder schlafen), **Verlauf** (Tagesliste, Konto, Gerät, Sicherung).
- Einnahmen speichern nur im Blatt: Genommen oder Ausgelassen mit Grund (ohne Dosis). Medikamente mit Dosis je Gabe und Dosisknöpfen. **Dosis-Vorbelegung (Entscheid Christian 14.11., ersetzt die frühere Vorbelegung mit der letzten Dosis):** Plan, wenn letzte Dosis gleich oder unbekannt; weichen Plan und letzte Dosis ab, oder hat das Medikament keine Plan-Dosis (keine Gaben), wird nichts vorgewählt und beide Werte stehen gleich gross da; gespeichert wird erst nach einer Wahl. Eine Dosis ausserhalb `dosis_optionen` und Plan fragt vor dem Speichern nach.
- Zeit: Medikamente immer „Jetzt“ vorbelegt, die Planzeit bleibt als Chip. Supplemente im Zeitfenster „jetzt“, sonst Planzeit, als geschätzt markiert (`~`).
- Rückgängig im Hinweis: beim ersten Erfassen ein Storno, nach einer Änderung (auch „Wieder schlafen“) kommt die Vorfassung als neue Zeile zurück. Ist der Eintrag inzwischen gelöscht, macht Rückgängig nichts.
- Banner auf jedem Reiter, sobald der älteste nicht hochgeladene Eintrag 24 h alt ist. Im Verlauf steht, ob der Browser den Speicher dauerhaft hält (`navigator.storage.persist()`).
- Sammelknopf je Tageszeit nur für Supplemente. Befinden mit vier Skalen, alle 5 = gut. Essen und Trinken mit einem Tipp, danach „Zeit ändern“ oder „Rückgängig“.
- Doppeltipps speichern nur einmal; ein Tipp in den Rand des Blatts verwirft nichts.
- Medikamente und ihre Gaben kommen aus `konfig.json` (im OneDrive, erzeugt aus `gaben.json` und dem Protokoll); im Code stehen keine Namen.

Durchgespielt 0.3.1 am 14.11. (Testmodus, 375 px): Medikament nach dem Zeitfenster (Jetzt vorgewählt, Plan als Chip), Dosis am Steigerungstag ohne Vorwahl mit Plan/Zuletzt, Speichern ohne Wahl abgewiesen, 15 mg mit Rückfrage, 20 → 10 → 5 → Rückgängig = 10, Ausgelassen ohne `dosis_mg`, Wach beenden und Rückgängig, Bedarfsmedikament ohne Vorwahl, Löschen nach Ändern und dann Rückgängig = nichts, Rückstand-Banner offline. 10 hochgeladene Zeilen bestehen `pruefe_zeile`. Prüfer (unabhängig): 1 hoch, 3 mittel behoben bzw. ausgelagert (siehe Offen).

Durchgespielt 0.3.0 am 14.11. (Testmodus, Browser 375 px): Checkliste, Planzeit, Sammelblatt mit Abwahl, Dosis je Gabe, Ausgelassen mit Grund, Befinden mit Pflichtprüfung, Nebenwirkung mit Stärke, Kaffee mit Zeit ändern, Blutdruck-Prüfung, Wachphase, Doppeltipps, Abgleich. 15 hochgeladene Zeilen bestehen die Prüfung von `erfassung_import.py`; ein Lauf auf einer Kopie von `hanna.db` leitete richtig ab.

## Betrieb

- **Adresse:** `https://hz-erfassung.github.io/app/`, Repo `hz-erfassung/app` (öffentlich, eigene Organisation, damit die App eine eigene Herkunft und damit eigenen Speicher hat). Pages aus `main` / `docs`. Commits unter der noreply-Adresse.
- **Entra:** App-Registrierung „Hanna Erfassung“ (SPA, ein Mandant), Umleitung `https://hz-erfassung.github.io/app/`, delegiert `Files.ReadWrite`, `offline_access`, `openid`. Client-ID steht in `docs/konfig.js`. Microsoft nimmt die Anmeldeanfrage an (geprüft bis zur Anmeldeseite).
- **Neue Fassung veröffentlichen:** `STAND` in `docs/sw.js` und `VERSION` in `docs/app.js` hochzählen, `npm test`, committen, `git push`. Pages braucht rund eine Minute.

## Offen

Erster echter Lauf mit 0.3.1 am 15.11. erfolgreich (Christian): GitHub-Organisation gehärtet (ein Owner, 2FA, Ruleset gegen Löschen und Force Push auf `main`, nur Repo `app`), Zustimmungsdialog geprüft, Erfassen und Import laufen.


1. **Aus der Prüfung 0.3.1, nicht im Auftrag:** veraltete `konfig.json` wirkt still weiter (#9; Plan im Gerät alt = Vorwahl der alten Dosis möglich), Ändern einer Einnahme ohne passende Planzeile verliert `dosis_mg` und `gabe`, Zusammenfassung zeigt eine per Rückgängig wiederhergestellte Einnahme als „(korrigiert)“, gemeinsame Testfälle JS/Python (#15).

## Bekannte Grenzen

- Entra gibt einer SPA ein Refresh-Token für höchstens 24 Stunden. Zum Hochladen braucht es danach eine neue Anmeldung (ein Tipp, Microsoft-Seite). Erfassen geht immer ohne.
- Graph legt fehlende Ordner beim Hochladen per Pfad an; im echten OneDrive noch nicht gesehen. Gelesen wird über `@microsoft.graph.downloadUrl` (der Testserver spielt die Weiterleitung von `:/content` nach).
- Nicht hochgeladene Einträge liegen nur auf dem Gerät. Vor dem Löschen oder Neuinstallieren muss „✓“ stehen. Notweg: „Offene sichern“ gibt eine Datei im Logformat weiter; am Laptop nach `erfassung/eingang/sicherung/` legen, der Import überspringt bekannte Einträge.
- `Files.ReadWrite` erlaubt der App das ganze OneDrive. Enger geht es nur mit einem anderen Ablageort (App-Ordner), dann müsste der Import dort lesen.
- Supplemente tragen keine Dosis; Medikamente schon (je Gabe).
- Einnahmen aus 0.2.x (ohne `gabe`) zählen in „Heute“ nicht als erledigt; für den Import gültig.
- Nach jedem Abgleich wird „Heute“ neu gezeichnet; ein Tipp genau in diesem Augenblick kann verloren gehen (Eingaben im Blatt nie).
- Etappe B: Abendrückblick, Morgenkarte „Letzte Nacht“, Gaben-Tabelle in `hanna.db`, Tagesgrenze 04:00. Etappe C: Nachtmodus, Wochenübersicht.
