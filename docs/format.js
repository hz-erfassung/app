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

// Angeboten werden seit 0.3 nur diese; "unruhe" steckt in der Skala "ruhe".
export const NEBENWIRKUNGEN = [
  ["kopfschmerz", "Kopfschmerz"], ["herzklopfen", "Herzklopfen"],
  ["magen", "Magen"], ["reizbarkeit", "Reizbarkeit"],
];
const NW_NAMEN = Object.fromEntries([...NEBENWIRKUNGEN, ["unruhe", "Unruhe"]]);
export const STAERKEN = [[1, "leicht"], [2, "mittel"], [3, "stark"]];

// Befinden "jetzt", alle Skalen 5 = gut
export const BEFINDEN = [
  ["fokus", "Fokus", "zerstreut", "voll da"],
  ["energie", "Energie", "leer", "viel"],
  ["stimmung", "Stimmung", "gedrückt", "gut"],
  ["ruhe", "Innere Ruhe", "getrieben", "ruhig"],
];

export const GRUENDE = ["vergessen", "keine Mahlzeit", "bewusst", "Nebenwirkung"];

export function beschreibe(e) {
  const d = e.daten || {};
  let s;
  switch (e.typ) {
    case "einnahme":
      s = (d.mittel || `Mittel ${d.supplement_id}`) +
        (d.dosis_mg != null ? ` ${d.dosis_mg} mg` : d.dosis ? ` ${d.dosis}` : "") +
        (d.status === "ausgelassen" ? " · ausgelassen" : "") + (d.grund ? ` (${d.grund})` : "");
      break;
    case "wach": s = "Wach" + (d.bis ? ` bis ${d.bis.slice(11, 16)}` : " (läuft)") + (d.grund ? ` · ${d.grund}` : ""); break;
    case "nebenwirkung": {
      s = (d.art === "freitext" ? d.text : NW_NAMEN[d.art] || d.art) +
        (d.staerke ? ` · ${STAERKEN.find(([n]) => n === d.staerke)?.[1] || d.staerke}` : "");
      break;
    }
    case "wirkung":
      s = BEFINDEN.filter(([k]) => d[k] != null).map(([k, name]) => `${name} ${d[k]}`).join(", ");
      break;
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

// ------------------------------------------------------------ Tagesplan (0.3)

/** Zeitfenster je Tageszeit für Supplemente (von, bis, plan). */
export const TAGESZEITEN = {
  morgens: { label: "Morgens", von: "05:00", bis: "11:00", plan: "07:30" },
  mittags: { label: "Mittags", von: "11:00", bis: "15:00", plan: "12:30" },
  abends: { label: "Abends", von: "17:00", bis: "23:30", plan: "19:00" },
};
const blockAus = (hhmm) => (hhmm < "11:00" ? "morgens" : hhmm < "16:00" ? "mittags" : "abends");
const norm = (s) => (s || "").normalize("NFC").trim().toLowerCase();

/**
 * Tagesplan aus konfig.json: eine Zeile je Gabe. Medikamente mit Gaben aus
 * "medikamente" (gaben.json), Supplemente aus "mittel" (Protokoll), Gabe =
 * Tageszeit. Medikamente ohne Gaben landen in "weitere".
 */
export function tagesplan(konfig) {
  if (!konfig) return [];
  const meds = konfig.medikamente || [];
  const istMed = (m) => meds.some((x) => (x.supplement_id && x.supplement_id === m.supplement_id) || norm(x.name) === norm(m.name));
  const zeilen = [];
  for (const m of meds) {
    const basis = { name: m.name, supplement_id: m.supplement_id || null, medikament: true, dosis_optionen: m.dosis_optionen || [] };
    if (!m.gaben?.length) { zeilen.push({ ...basis, key: `${norm(m.name)}|`, block: "weitere", gabe: null, label: "bei Bedarf" }); continue; }
    for (const g of m.gaben) {
      // Gabe ohne Zeiten: nicht raten, sondern unter "weitere"
      const block = g.plan || g.von ? blockAus(g.plan || g.von) : "weitere";
      zeilen.push({ ...basis, key: `${norm(m.name)}|${g.gabe}`, block, gabe: g.gabe,
        label: g.label || g.gabe, von: g.von, bis: g.bis, plan: g.plan, dosis_mg: g.dosis_mg ?? null });
    }
  }
  const gesehen = new Set(zeilen.map((z) => z.key));
  for (const m of konfig.mittel || []) {
    if (istMed(m)) continue;
    const zp = norm(m.zeitpunkt);
    if (!["morgens", "mittags", "abends", "nuechtern"].includes(zp)) {
      // z. B. "bei Bedarf": keine feste Tageszeit, nicht im Sammelblatt
      const key = `${norm(m.name)}|`;
      if (!gesehen.has(key)) { gesehen.add(key); zeilen.push({ name: m.name, supplement_id: m.supplement_id, medikament: false,
        dosis_optionen: [], key, block: "weitere", gabe: null, label: m.zeitpunkt || "bei Bedarf" }); }
      continue;
    }
    const block = zp === "nuechtern" ? "morgens" : zp;
    const t = TAGESZEITEN[block];
    const key = `${norm(m.name)}|${block}`;
    if (gesehen.has(key)) continue;          // dasselbe Mittel zweimal im Block: eine Zeile
    gesehen.add(key);
    zeilen.push({ name: m.name, supplement_id: m.supplement_id, medikament: false, dosis_optionen: [],
      key, block, gabe: block, label: m.detail || t.label, von: t.von, bis: t.bis, plan: t.plan });
  }
  return zeilen;
}

/** Passt eine Einnahme zu einer Zeile des Tagesplans? */
export function gehoertZu(ev, zeile) {
  if (ev.typ !== "einnahme") return false;
  const d = ev.daten || {};
  const gleichesMittel = (zeile.supplement_id && d.supplement_id === zeile.supplement_id) || norm(d.mittel) === norm(zeile.name);
  return gleichesMittel && (d.gabe || null) === (zeile.gabe || null);
}

/** Letzte wirksame Einnahme einer Zeile an einem Tag (Ortsdatum von zeit), oder null. */
export function statusFuer(zeile, wirksameEreignisse, tag) {
  const treffer = wirksameEreignisse.filter((e) => e.zeit.slice(0, 10) === tag && gehoertZu(e, zeile));
  if (!treffer.length) return null;
  return treffer.sort((a, b) => Date.parse(a.erfasst) - Date.parse(b.erfasst))[treffer.length - 1];
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Ortszeit eines Tages zu einer Uhrzeit "HH:MM" als Date. */
export function amTag(tag, uhr) {
  const [y, m, d] = tag.split("-").map(Number);
  const [h, mi] = uhr.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi, 0);
}

/**
 * Vorbelegung der Zeit beim Abhaken: im Zeitfenster "jetzt", sonst die
 * Planzeit (wenn sie heute schon vorbei ist), markiert als geschätzt.
 */
export function vorbelegung(zeile, jetzt = new Date()) {
  const t = hhmm(jetzt);
  if (!zeile?.plan || !zeile.von || !zeile.bis || (t >= zeile.von && t <= zeile.bis)) return { art: "jetzt" };
  const tag = isoLokal(jetzt).slice(0, 10);
  const plan = amTag(tag, zeile.plan);
  return plan <= jetzt ? { art: "plan", zeit: plan } : { art: "jetzt" };
}

/** Zuletzt genommene Dosis eines Medikaments (mg) über alle Tage, oder null. */
// Je Gabe: Morgen- und Mittagsdosis eines Mittels können verschieden sein.
export function letzteDosis(name, supplementId, wirksameEreignisse, gabe = null) {
  const t = wirksameEreignisse.filter((e) => e.typ === "einnahme" && e.daten?.status === "genommen" &&
    e.daten?.dosis_mg != null && (e.daten.gabe || null) === (gabe || null) &&
    ((supplementId && e.daten.supplement_id === supplementId) || norm(e.daten.mittel) === norm(name)));
  if (!t.length) return null;
  return t.sort((a, b) => Date.parse(a.zeit) - Date.parse(b.zeit))[t.length - 1].daten.dosis_mg;
}
