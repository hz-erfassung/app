// Logformat Version 1. Massgeblich: AI_Projekte/bereiche/gesundheit/erfassung/LOGFORMAT.md
// Reine Funktionen ohne Browser-Abhängigkeit, damit sie unter node testbar sind.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(jetzt = Date.now(), zufall = null) {
  let t = jetzt, zeit = "";
  for (let i = 0; i < 10; i++) { zeit = CROCKFORD[t % 32] + zeit; t = Math.floor(t / 32); }
  const r = zufall || globalThis.crypto.getRandomValues(new Uint8Array(16));
  let rest = "";
  for (let i = 0; i < 16; i++) rest += CROCKFORD[r[i] % 32];
  return zeit + rest;
}

const p2 = (n) => String(n).padStart(2, "0");

/** Ortszeit mit Zeitzone, z. B. 2026-11-18T07:10:00+01:00 */
export function isoLokal(d) {
  const off = -d.getTimezoneOffset();
  const v = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` +
    `${v}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

export const GERAET_MUSTER = /^[a-z0-9-]{1,30}$/;

export function neuesEreignis({ typ, daten = {}, zeit, ersetzt = null, notiz = "", geraet, jetzt = new Date() }) {
  if (!GERAET_MUSTER.test(geraet)) throw new Error(`Gerätename ungültig: ${geraet}`);
  const erfasst = isoLokal(jetzt);
  return {
    v: 1, id: ulid(jetzt.getTime()), geraet, client: 1,
    zeit: zeit || erfasst, erfasst, typ, daten, ersetzt, notiz: notiz || "",
  };
}

/** Eine Logzeile, Feldreihenfolge fest. Lokale Hilfsfelder (_…) fallen weg. */
export function zeile(ev) {
  const { v, id, geraet, client, zeit, erfasst, typ, daten, ersetzt, notiz } = ev;
  return JSON.stringify({ v, id, geraet, client, zeit, erfasst, typ, daten, ersetzt, notiz });
}

/** Datei je Tag des Erfassens und Gerät: eingang/JJJJ/JJJJ-MM-TT_<geraet>.jsonl */
export function dateiPfad(ev) {
  const tag = ev.erfasst.slice(0, 10);
  return `eingang/${tag.slice(0, 4)}/${tag}_${ev.geraet}.jsonl`;
}

/**
 * Vorhandenen Dateiinhalt und lokale Ereignisse vereinigen. Vorhandene Zeilen
 * bleiben unverändert (auch unlesbare), neue werden hinten angehängt, sortiert
 * nach erfasst. Nur das Gerät schreibt seine Datei; die Vereinigung schützt
 * trotzdem, falls der lokale Speicher einmal leer war.
 */
export function zusammenfuehren(vorhanden, ereignisse) {
  const ids = new Set();
  for (const z of (vorhanden || "").split("\n")) {
    if (!z.trim()) continue;
    try { const o = JSON.parse(z); if (o && typeof o.id === "string") ids.add(o.id); } catch { /* bleibt stehen */ }
  }
  const neu = ereignisse.filter((e) => !ids.has(e.id))
    .sort((a, b) => (a.erfasst < b.erfasst ? -1 : a.erfasst > b.erfasst ? 1 : a.id < b.id ? -1 : 1));
  let text = vorhanden || "";
  if (text && !text.endsWith("\n")) text += "\n";
  for (const e of neu) text += zeile(e) + "\n";
  return { text, neu: neu.length };
}

const zeitpunkt = (iso) => Date.parse(iso);

/**
 * Wirksame Ereignisse, gleiche Regel wie erfassung_import.py: Stornos und
 * ersetzte Ereignisse fallen weg; ersetzen mehrere dasselbe Ziel, gilt das
 * zuletzt erfasste.
 */
export function wirksam(alle) {
  const ids = new Set(alle.map((e) => e.id));
  const ersetzer = new Map();
  for (const e of alle) {
    if (e.ersetzt && ids.has(e.ersetzt)) {
      if (!ersetzer.has(e.ersetzt)) ersetzer.set(e.ersetzt, []);
      ersetzer.get(e.ersetzt).push(e);
    }
  }
  const raus = new Set(ersetzer.keys());
  for (const liste of ersetzer.values()) {
    liste.sort((a, b) => zeitpunkt(a.erfasst) - zeitpunkt(b.erfasst) || (a.id < b.id ? -1 : 1));
    liste.slice(0, -1).forEach((e) => raus.add(e.id));
  }
  return alle.filter((e) => e.typ !== "storno" && !raus.has(e.id))
    .sort((a, b) => zeitpunkt(a.zeit) - zeitpunkt(b.zeit));
}

/** Offene Wachphase: wirksames wach-Ereignis ohne bis, höchstens 14 h alt. */
export function offeneWachphase(alle, jetzt = new Date()) {
  const w = wirksam(alle).filter((e) => e.typ === "wach" && !e.daten.bis &&
    jetzt.getTime() - zeitpunkt(e.zeit) < 14 * 3600e3);
  return w.length ? w[w.length - 1] : null;
}

export const NEBENWIRKUNGEN = [
  ["kopfschmerz", "Kopfschmerz"], ["herzklopfen", "Herzklopfen"], ["unruhe", "Unruhe"],
  ["magen", "Magen"], ["reizbarkeit", "Reizbarkeit"],
];

export function beschreibe(e) {
  const d = e.daten || {};
  let s;
  switch (e.typ) {
    case "einnahme":
      s = (d.mittel || `Mittel ${d.supplement_id}`) + (d.dosis ? ` ${d.dosis}` : "") +
        (d.status === "ausgelassen" ? " · ausgelassen" : "") + (d.grund ? ` (${d.grund})` : "");
      break;
    case "wach": s = "Wach" + (d.bis ? ` bis ${d.bis.slice(11, 16)}` : " (läuft)") + (d.grund ? ` · ${d.grund}` : ""); break;
    case "nebenwirkung": {
      const n = NEBENWIRKUNGEN.find(([k]) => k === d.art);
      s = (d.art === "freitext" ? d.text : n ? n[1] : d.art) + (d.staerke ? ` · Stärke ${d.staerke}` : "");
      break;
    }
    case "wirkung": s = `Fokus ${d.fokus}/5`; break;
    case "mahlzeit": s = d.richtig ? "Mahlzeit" : "Snack (keine richtige Mahlzeit)"; break;
    case "kaffee": s = "Kaffee" + (d.menge ? ` ×${d.menge}` : ""); break;
    case "alkohol": s = "Alkohol" + (d.menge ? ` ${d.menge} Gl.` : ""); break;
    case "blutdruck": s = "Blutdruck " + [d.sys != null ? `${d.sys}/${d.dia}` : null, d.puls != null ? `Puls ${d.puls}` : null]
      .filter(Boolean).join(", "); break;
    case "notiz": s = "Notiz"; break;
    default: s = e.typ;
  }
  return e.notiz ? `${s} · ${e.notiz}` : s;
}
