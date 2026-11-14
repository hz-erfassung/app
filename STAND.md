# Hanna Erfassung: Stand

PWA zum Erfassen von Einnahmen, Wachphasen, Nebenwirkungen, Fokus, Essen und Trinken, Blutdruck und Notizen am iPhone. Offline, Upload ins Business-OneDrive über Microsoft Graph. Auftrag: `AI_Projekte/bereiche/gesundheit/handoff/2026-11-14_Hanna_Auftrag-Kai_Hanna-App.md`; Format: `AI_Projekte/bereiche/gesundheit/erfassung/LOGFORMAT.md`. Etappe 1b, 14.11.2026.

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
| `test/format.test.mjs` | `npm test` |

## Prüfen

```
cd C:\AI_Lokal\hanna-erfassung
npm test
py dev_server.py --wurzel %TEMP%\hanna_test_onedrive --port 8790
```

Vorschau in Claude Code: `hanna-erfassung` in `AI_Projekte/.claude/launch.json`.

Durchgespielt am 14.11. (Testmodus, Browser 375 px): Mittel aus `konfig.json` laden, Einnahme, Wachphase starten und beenden, Fokus, Nebenwirkung mit Rückgängig, Kaffee, Blutdruck-Dialog, Ändern über die Tagesliste, Server aus (App lädt aus dem Service Worker, Erfassen geht, „offen“), Server an (nachgeladen). Die hochgeladene Datei lief durch `erfassung_import.py` auf einer Kopie von `hanna.db`: 8 Zeilen, 0 ungültig, Einnahme und Aufwachzeit richtig abgeleitet.

## Offen vor dem Betrieb

1. **GitHub:** öffentliches Repo `hz-erfassung/app` (Adresse `https://hz-erfassung.github.io/app/`), Pages aus `main` / `docs`. Freigabe nötig (Veröffentlichung). **Eigene Herkunft:** alle Projektseiten unter `https://<konto>.github.io/` teilen sich Speicher und IndexedDB, also auch Token und Einträge. Deshalb in einer eigenen, kostenlosen GitHub-Organisation nur für diese App (dann `https://<organisation>.github.io/`), nicht unter dem persönlichen Konto. Der Autor der Commits ist lokal auf die noreply-Adresse gesetzt.
2. **Entra (eigener Tenant):** App-Registrierung „Hanna Erfassung“, Plattform *Single-page application*, Umleitung genau die Pages-Adresse mit Schrägstrich am Ende, delegiert `Files.ReadWrite`, `offline_access`, `openid`. Client-ID in `docs/konfig.js` eintragen, `STAND` in `sw.js` erhöhen.
3. **Erster echter Lauf:** am iPhone in Safari öffnen, „Zum Home-Bildschirm“, anmelden, eine Testeingabe, am Laptop `py erfassung_import.py` (Probelauf), dann `--schreiben`.

## Bekannte Grenzen

- Entra gibt einer SPA ein Refresh-Token für höchstens 24 Stunden. Zum Hochladen braucht es danach eine neue Anmeldung (ein Tipp, Microsoft-Seite). Erfassen geht immer ohne.
- Graph legt fehlende Ordner beim Hochladen per Pfad an; im echten OneDrive noch nicht gesehen. Gelesen wird über `@microsoft.graph.downloadUrl` (der Testserver spielt die Weiterleitung von `:/content` nach).
- Nicht hochgeladene Einträge liegen nur auf dem Gerät. Vor dem Löschen oder Neuinstallieren muss „✓“ stehen. Notweg: „Offene sichern“ gibt eine Datei im Logformat weiter; am Laptop nach `erfassung/eingang/sicherung/` legen, der Import überspringt bekannte Einträge.
- `Files.ReadWrite` erlaubt der App das ganze OneDrive. Enger geht es nur mit einem anderen Ablageort (App-Ordner), dann müsste der Import dort lesen.
- Die Mittel-Knöpfe schreiben keine Dosis: die Protokolldosis passt nicht immer zur einzelnen Gabe (ein Mittel mit zwei Gaben am Tag). Dosis bei Bedarf über „Ändern“.
- Protokollanzeige und Tageszusammenfassung in der App: Etappe 2.
