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
    case "rueckblick_nacht": {
      const m = (d.merkmale || []).map((k) => NACHT_MERKMALE.find(([x]) => x === k)?.[1] || k);
      s = `Letzte Nacht: Schlafgefühl ${d.schlaf}` + (m.length ? `, ${m.join(", ")}` : "") +
        (d.alkohol == null ? "" : d.alkohol === 0 ? ", kein Alkohol" : `, Alkohol ${d.alkohol}${d.alkohol === 3 ? "+" : ""} Gl.`);
      break;
    }
    case "rueckblick_tag": {
      const m = (d.merkmale || []).map((k) => TAG_MERKMALE.find(([x]) => x === k)?.[1] || k);
      s = `Tag: Energie ${d.energie}, Fokus ${d.fokus}, Stimmung ${d.stimmung}` + (m.length ? `, ${m.join(", ")}` : "") +
        (d.keine_nebenwirkungen ? ", keine Nebenwirkungen" : "");
      break;
    }
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
 * Medikamente immer "jetzt" (0.3.1, Gremium #1): eine vorbelegte Planzeit
 * verfälscht Abstand der Gaben und Wirkdauer. Der Plan bleibt als Chip wählbar.
 */
export function vorbelegung(zeile, jetzt = new Date()) {
  const t = hhmm(jetzt);
  if (zeile?.medikament) return { art: "jetzt" };
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

// ------------------------------------------------------------ 0.3.1 (Gremium 14.11.2026)

/**
 * Dosis-Vorbelegung eines Medikaments (#4). Beim Ändern die bisherige Dosis.
 * Sonst: Plan und letzte Dosis gleich oder nur eins bekannt = dieser Wert.
 * Weichen sie ab (z. B. am Tag einer Steigerung), wird nichts vorgewählt;
 * gespeichert wird erst nach einer Wahl.
 * Ohne Plan-Dosis (Medikament ohne Gaben, z. B. bei Bedarf oder in der
 * Titration) wird ebenfalls nichts vorgewählt: sonst speichert ein Tipp am
 * Steigerungstag still die alte Dosis (Prüfer 14.11.). "Zuletzt" wird gezeigt.
 */
export function dosisVorschlag({ alt = null, plan = null, letzte = null, planAktuell = true } = {}) {
  if (alt != null) return { wert: alt, abweichung: false, veraltet: false, plan, letzte };
  if (plan == null) return { wert: null, abweichung: false, veraltet: false, plan, letzte };
  // #9 (0.4.1, Entscheid Christian 24.11.): Plan nicht vom Tag der Einnahme = nie vorwählen
  if (!planAktuell) return { wert: null, abweichung: false, veraltet: true, plan, letzte };
  if (letzte == null || letzte === plan) return { wert: plan, abweichung: false, veraltet: false, plan, letzte };
  return { wert: null, abweichung: true, veraltet: false, plan, letzte };
}

/**
 * Stand des Plans (#9, 0.4.1). konfig.json trägt nur die Gaben, die am Tag
 * ihrer Erzeugung gelten (gueltige_gaben in gaben_pflege.py, Datum je Zeile).
 * Für einen anderen Kalendertag kann die Plan-Dosis falsch sein, etwa an einem
 * Steigerungstag. Grenze Kalendertag (Entscheid Christian 24.11.2026).
 * Liefert { tag, uhr, aktuell }; aktuell nur, wenn der Plan am Tag `tag`
 * (Ortszeit, JJJJ-MM-TT) erzeugt wurde. Ohne lesbares "erzeugt" nie aktuell.
 */
export function planStand(konfig, tag) {
  const ms = Date.parse(konfig?.erzeugt || "");
  if (!Number.isFinite(ms)) return { tag: null, uhr: null, aktuell: false };
  const lokal = isoLokal(new Date(ms));
  return { tag: lokal.slice(0, 10), uhr: lokal.slice(11, 16), aktuell: lokal.slice(0, 10) === tag };
}

/**
 * Ändern einer Einnahme ohne passende Planzeile (0.4.1, Prüfung 0.3.1): Das
 * Blatt "anderes Mittel" kennt keine Gabe. Bleibt das Mittel gleich, geht die
 * Gabe der Vorfassung mit, statt still zu verschwinden; umbenannt geht nichts
 * mit. Die mg-Dosis trägt das Blatt als eigenes, änderbares Feld (Prüfer
 * 24.11.: still übernommen stünde sie im Widerspruch zu einer neuen Freitext-Dosis).
 */
export function uebernehmeBeimAendern(alt, neuerName, status) {
  if (!alt?.mittel || norm(alt.mittel) !== norm(neuerName)) return {};
  return alt.gabe ? { gabe: alt.gabe } : {};
}

/**
 * Darf eine Dosis gespeichert werden, die im Blatt steht (#9, Prüfer 24.11.)?
 * Ja, wenn sie von Hand gewählt wurde, aus der Vorfassung stammt (Ändern) oder
 * der Plan vom Tag der gespeicherten Zeit ist. Sonst war es eine Vorwahl aus
 * einem Plan für einen anderen Tag (Zeit verstellt, Blatt über Mitternacht).
 */
export function vorwahlGilt({ vonHand = false, ausAlt = false, planAktuell = false } = {}) {
  return !!(vonHand || ausAlt || planAktuell);
}

/** Liegt eine Dosis ausserhalb der vorgesehenen (dosis_optionen und Plan der Gabe)? */
export function dosisAusserhalb(mg, zeile) {
  const erlaubt = [...(zeile?.dosis_optionen || []), zeile?.dosis_mg].filter((n) => n != null);
  return erlaubt.length > 0 && !erlaubt.includes(mg);
}

/**
 * Was "Rückgängig" für ein Ereignis schreibt (#2). ev = die gültige Fassung.
 * - Erstes Erfassen (kein ersetzt): Storno, das Ereignis fällt weg.
 * - Nach einer Änderung: die Vorfassung kommt als neue Zeile zurück, mit
 *   ersetzt auf die Änderung. Wirksam ist danach wieder der Inhalt der
 *   Vorfassung. Ein Storno würde die ganze Kette löschen.
 * Kein neuer Regelteil: wirksam() hier und setze_gueltigkeit() im Import
 * werten die Kette A <- B <- C schon so aus (C gilt). Beide gleich halten.
 */
export function rueckgaengig(ev, alle) {
  if (!ev.ersetzt) return { typ: "storno", daten: {}, ersetzt: ev.id, notiz: "" };
  const vor = alle.find((e) => e.id === ev.ersetzt);
  if (!vor || vor.typ === "storno") throw new Error("Vorfassung nicht auf dem Gerät, bitte von Hand ändern.");
  return { typ: vor.typ, daten: JSON.parse(JSON.stringify(vor.daten || {})), zeit: vor.zeit,
    notiz: vor.notiz || "", ersetzt: ev.id };
}

/**
 * Rückstand beim Hochladen (#5): Zahl der nicht hochgeladenen Einträge und
 * Alter des ältesten (nach erfasst). alarm ab 24 Stunden.
 */
export function rueckstand(alle, jetzt = new Date()) {
  const offen = alle.filter((e) => !e._sync);
  if (!offen.length) return null;
  const aeltestes = Math.min(...offen.map((e) => Date.parse(e.erfasst)));
  const stunden = (jetzt.getTime() - aeltestes) / 3600e3;
  return { anzahl: offen.length, aeltestes: new Date(aeltestes), stunden, alarm: stunden >= 24 };
}

// ------------------------------------------------------------ 0.4 Rückblick (Befindens-Log, 22.11.2026)

/** Skalen des Abendrückblicks: Schlüssel, Name, Anker 1, Anker 5. 3 = wie meist. */
export const TAG_SKALEN = [
  ["energie", "Energie", "leer", "viel"],
  ["fokus", "Fokus", "zerstreut", "voll da"],
  ["stimmung", "Stimmung", "gedrückt", "gut"],
];
export const SCHLAF_SKALA = ["schlaf", "Schlafgefühl", "wie gerädert", "erholt"];
export const NACHT_MERKMALE = [["geschwitzt", "geschwitzt"], ["herzklopfen", "Herzklopfen"], ["unruhig", "unruhig, viel wach"]];
export const TAG_MERKMALE = [["krank", "krank"], ["reise", "Reise"], ["stress", "Stress"], ["training", "hartes Training"]];
export const GLAESER = [[0, "nein"], [1, "1"], [2, "2"], [3, "3+ Gläser"]];
const TAGESGRENZE_H = 4;

/** Tag mit Tagesgrenze 04:00: 01:30 am 23. gehört zum 22. Gleiche Regel wie logtag() im Import. */
export function logTag(jetzt = new Date()) {
  const d = new Date(jetzt);
  if (d.getHours() < TAGESGRENZE_H) d.setDate(d.getDate() - 1);
  return isoLokal(d).slice(0, 10);
}

/** Datum JJJJ-MM-TT um n Tage verschoben. */
export function tagPlus(tag, n) {
  const [y, m, d] = tag.split("-").map(Number);
  return isoLokal(new Date(y, m - 1, d + n, 12)).slice(0, 10);
}

/** Gültiger Rückblick für einen Bezugstag (zuletzt erfasst), oder null. art = "nacht" | "tag". */
export function rueckblickFuer(art, tag, wirksameEreignisse) {
  const typ = art === "nacht" ? "rueckblick_nacht" : "rueckblick_tag";
  const t = wirksameEreignisse.filter((e) => e.typ === typ && e.daten?.[art] === tag);
  if (!t.length) return null;
  return t.sort((a, b) => Date.parse(a.erfasst) - Date.parse(b.erfasst) || (a.id < b.id ? -1 : 1))[t.length - 1];
}

/**
 * Welche Rückblick-Karten "Heute" zeigt. Tag (Tagesgrenze 04:00) = T.
 * 04:00 bis 17:59: Morgenkarte für die Nacht auf T; fehlt der Abendrückblick
 * für T−1, eine Nachtrag-Zeile. 18:00 bis 03:59: Abendkarte für T; fehlt der
 * Morgenrückblick für T, eine Nachtrag-Zeile.
 */
export function rueckblickKarten(wirksameEreignisse, jetzt = new Date()) {
  const T = logTag(jetzt);
  const h = jetzt.getHours();
  const morgen = h >= TAGESGRENZE_H && h < 18;
  const karten = [];
  const karte = (art, tag) => ({ art, tag, ev: rueckblickFuer(art, tag, wirksameEreignisse) });
  if (morgen) {
    karten.push({ ...karte("nacht", T), haupt: true });
    const gestern = karte("tag", tagPlus(T, -1));
    if (!gestern.ev) karten.push({ ...gestern, haupt: false });
  } else {
    karten.push({ ...karte("tag", T), haupt: true });
    const nacht = karte("nacht", T);
    if (!nacht.ev) karten.push({ ...nacht, haupt: false });
  }
  return karten;
}

/**
 * Offene Medikamente für den Abendrückblick (nur Medikamente, nie Supplemente).
 * - Gaben mit Zeitfenster, deren Beginn vorbei ist und für die es am Tag nichts gibt.
 * - Medikamente bei Bedarf ohne Eintrag am Tag (genommen oder nicht genommen).
 * tag = Tag des Rückblicks; liegt er vor dem Kalendertag von jetzt (nach Mitternacht),
 * gelten alle Gaben als vorbei.
 */
export function offeneMedikamente(plan, wirksameEreignisse, tag, jetzt = new Date()) {
  const vorbei = tag < isoLokal(jetzt).slice(0, 10);
  const t = hhmm(jetzt);
  const out = [];
  for (const z of plan.filter((x) => x.medikament)) {
    if (z.block === "weitere") {
      // Tagesgrenze 04:00 wie die Karte: eine Einnahme um 00:30 zählt noch zum Vortag
      const any = wirksameEreignisse.some((e) => e.typ === "einnahme" && logTag(new Date(e.zeit)) === tag &&
        ((z.supplement_id && e.daten?.supplement_id === z.supplement_id) || norm(e.daten?.mittel) === norm(z.name)));
      if (!any) out.push({ zeile: z, art: "bedarf" });
    } else if (!statusFuer(z, wirksameEreignisse, tag) && (vorbei || (z.von && z.von <= t))) {
      out.push({ zeile: z, art: "gabe" });
    }
  }
  return out;
}

/**
 * Daten eines Rückblicks prüfen, bevor er gespeichert wird. Gleiche Regeln wie
 * pruefe_zeile im Import: Bezugstag nicht nach dem Tag von jetzt (Tagesgrenze
 * 04:00) und höchstens 7 Tage davor, Skalen 1 bis 5, Gläser 0 bis 3,
 * keine_nebenwirkungen nur true, Merkmale aus der festen Liste.
 */
export function pruefeRueckblick(art, daten, jetzt = new Date()) {
  const skala = (k) => Number.isInteger(daten[k]) && daten[k] >= 1 && daten[k] <= 5;
  const T = logTag(jetzt), bezug = daten[art];
  if (typeof bezug !== "string" || bezug > T) throw new Error("Dieser Tag liegt in der Zukunft.");
  if (bezug < tagPlus(T, -7)) throw new Error("Älter als 7 Tage, nicht mehr änderbar.");
  if (daten.keine_nebenwirkungen != null && daten.keine_nebenwirkungen !== true) throw new Error("Nebenwirkungen: nur „heute keine“.");
  if (art === "nacht") {
    if (!skala("schlaf")) throw new Error("Schlafgefühl fehlt noch.");
    if (daten.alkohol != null && !(Number.isInteger(daten.alkohol) && daten.alkohol >= 0 && daten.alkohol <= 3)) throw new Error("Gläser: 0 bis 3.");
  } else {
    const fehlt = TAG_SKALEN.filter(([k]) => !skala(k)).map(([, n]) => n);
    if (fehlt.length) throw new Error(`Noch wählen: ${fehlt.join(", ")}.`);
  }
  const erlaubt = new Set((art === "nacht" ? NACHT_MERKMALE : TAG_MERKMALE).map(([k]) => k));
  if (daten.merkmale && daten.merkmale.some((m) => !erlaubt.has(m))) throw new Error("Merkmal unbekannt.");
  return true;
}
