// Hanna Erfassung 0.3: Checkliste nach Tageszeit, Blätter statt Sofort-Speichern
// bei Einnahmen, Befinden mit vier Skalen. Format: LOGFORMAT.md im Bereich Gesundheit.
// 0.3.1 (Gremium 14.11.2026): Medikamente mit Zeit "jetzt", keine Dosis-Vorwahl bei
// Abweichung vom Plan, Rückgängig nach Ändern stellt die Vorfassung her, Rückstand-Banner.
// 0.4 (22.11.2026, Hanna): Rückblick Nacht und Tag (Befindens-Log) mit offenen Medikamenten, Tagesgrenze 04:00.
// 0.4.1 (24.11.2026, Kai, Gremium #9): Stand des Plans sichtbar; Plan nicht vom Tag der Einnahme = keine
// Dosis-Vorwahl; Ändern ohne passende Planzeile behält mg und Gabe.

import {
  neuesEreignis, isoLokal, wirksam, offeneWachphase, beschreibe, zeile as logzeile,
  NEBENWIRKUNGEN, STAERKEN, BEFINDEN, GRUENDE, GERAET_MUSTER,
  tagesplan, statusFuer, gehoertZu, vorbelegung, letzteDosis, amTag, TAGESZEITEN,
  dosisVorschlag, dosisAusserhalb, rueckgaengig, rueckstand, planStand, uebernehmeBeimAendern, vorwahlGilt,
  TAG_SKALEN, SCHLAF_SKALA, NACHT_MERKMALE, TAG_MERKMALE, GLAESER,
  logTag, tagPlus, rueckblickKarten, offeneMedikamente, pruefeRueckblick,
} from "./format.js";
import { alleEreignisse, speichere, lies, schreibe } from "./speicher.js";
import { anmelden, abmelden, rueckkehrVerarbeiten, token, eingerichtet } from "./anmeldung.js";
import { hochladen, ladeKonfig } from "./abgleich.js";
import { TESTMODUS } from "./konfig.js";

const VERSION = "0.4.1";
const $ = (id) => document.getElementById(id);
const zustand = { alle: [], konfig: null, geraet: "iphone", tag: null, reiter: "heute", sync: { art: "" }, laeuft: false,
  entwurf: {}, offenKarte: null };

function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kinder.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const heute = () => isoLokal(new Date()).slice(0, 10);
const uhr = (iso) => iso.slice(11, 16);
const geschaetzt = (e) => !!e?.daten?.zeit_geschaetzt;
const zeitText = (e) => (geschaetzt(e) ? "~" : "") + uhr(e.zeit);

// ------------------------------------------------------------ Speichern

async function erfasse(typ, daten = {}, { zeit, ersetzt = null, notiz = "" } = {}) {
  const ev = neuesEreignis({ typ, daten, zeit, ersetzt, notiz, geraet: zustand.geraet });
  ev._sync = 0;
  await speichere(ev);
  zustand.alle.push(ev);
  zeichne();
  baldAbgleichen();
  return ev;
}
const storniere = (ev) => erfasse("storno", {}, { ersetzt: ev.id });

/** Die heute gültige Fassung eines Ereignisses (falls es inzwischen ersetzt wurde). */
function aktuelleFassung(ev) {
  let jetzt = ev;
  for (let i = 0; i < 50; i++) {
    const nf = wirksam(zustand.alle).find((e) => e.ersetzt === jetzt.id);
    if (!nf) break;
    jetzt = nf;
  }
  return jetzt;
}

/**
 * Rückgängig im Hinweis: erstes Erfassen wird storniert, eine Änderung
 * stellt die Vorfassung wieder her (format.js: rueckgaengig).
 */
async function macheRueckgaengig(ev) {
  const jetzt = aktuelleFassung(ev);
  // Inzwischen gelöscht (oder sonst nicht mehr gültig): nichts wiederbeleben
  if (!wirksam(zustand.alle).some((e) => e.id === jetzt.id)) throw new Error("Eintrag wurde inzwischen gelöscht.");
  const r = rueckgaengig(jetzt, zustand.alle);
  const neu = await erfasse(r.typ, r.daten, { zeit: r.zeit, ersetzt: r.ersetzt, notiz: r.notiz });
  toast(r.typ === "storno" ? "Rückgängig gemacht, Eintrag entfernt" : `Wiederhergestellt: ${zeitText(neu)} ${beschreibe(neu)}`);
}

let toastUhr = null;
function toast(text, { aendern = null, rueck = null, aendernText = "Ändern" } = {}) {
  $("toasttext").textContent = text;
  $("toast").hidden = false;
  $("toastaendern").hidden = !aendern;
  $("toastaendern").textContent = aendernText;
  $("toastaendern").onclick = () => { $("toast").hidden = true; aendern(); };
  $("toastrueck").hidden = !rueck;
  $("toastrueck").onclick = async () => {
    $("toast").hidden = true;
    try { await rueck(); } catch (f) { toast(`Nicht rückgängig gemacht: ${f.message}`); }
  };
  clearTimeout(toastUhr);
  toastUhr = setTimeout(() => { $("toast").hidden = true; }, 10000);
}
const toastFuer = (ev) => toast(`${zeitText(ev)} ${beschreibe(ev)}`, {
  aendern: () => bearbeite(aktuelleFassung(ev)),
  rueck: () => macheRueckgaengig(ev),
});

// ------------------------------------------------------------ Blatt

function oeffneBlatt({ titel, untertitel = "", inhalt = [], knoepfe = [] }) {
  $("toast").hidden = true;            // alter Hinweis passt nach einer Änderung im Blatt nicht mehr
  $("btitel").textContent = titel;
  $("buntertitel").textContent = untertitel;
  $("buntertitel").hidden = !untertitel;
  $("binhalt").replaceChildren(...inhalt);
  // Doppeltipp-Schutz: solange eine Aktion läuft, sind alle Knöpfe des Blatts gesperrt
  let beschaeftigt = false;
  const knopfListe = knoepfe.map((k) => el("button", {
    type: "button", class: k.klasse || "", onclick: async () => {
      if (beschaeftigt) return;
      beschaeftigt = true;
      knopfListe.forEach((b) => { b.disabled = true; });
      try { await k.aktion(); } catch (f) { fehler(f.message); }
      finally { beschaeftigt = false; knopfListe.forEach((b) => { b.disabled = false; }); }
    },
  }, k.text));
  $("bknoepfe").replaceChildren(...knopfListe);
  const d = $("blatt");
  if (!d.open) d.showModal();
}
function schliesseBlatt() { const d = $("blatt"); if (d.open) d.close(); }
function fehler(text) {
  let f = $("binhalt").querySelector(".fehlertext");
  if (!f) { f = el("p", { class: "fehlertext", role: "alert" }); $("binhalt").append(f); }
  f.textContent = text;
}
const feld = (titel, ...inhalt) => el("div", { class: "feld" }, titel ? el("span", { class: "titel" }, titel) : null, ...inhalt);

/** Auswahl-Chips: genau einer oder (abwaehlbar) keiner. */
function chips(optionen, { wert = null, abwaehlbar = false, klasse = "chips", beiWahl = null } = {}) {
  let aktuell = wert;
  const knoepfe = optionen.map(([v, text]) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(v === aktuell),
    onclick: () => {
      aktuell = abwaehlbar && aktuell === v ? null : v;
      knoepfe.forEach((b, i) => b.setAttribute("aria-pressed", String(optionen[i][0] === aktuell)));
      beiWahl?.(aktuell);
    },
  }, text));
  const setze = (w) => { aktuell = w; knoepfe.forEach((b, i) => b.setAttribute("aria-pressed", String(optionen[i][0] === aktuell))); };
  return { node: el("div", { class: klasse }, knoepfe), wert: () => aktuell, setze };
}

/**
 * Zeitwahl: Jetzt, vor 15/30/60 Minuten, Planzeit, Uhrzeit. Liefert die Zeit
 * mit Zeitzone und ob sie geschätzt ist. Beim Ändern bleibt eine unveränderte
 * Zeit samt Zeitzone und Merker erhalten.
 */
function zeitwahl({ vorgabe = { art: "jetzt" }, plan = null, alt = null } = {}) {
  const zuEingabe = (d) => isoLokal(d).slice(0, 16);
  const altHeute = !alt || isoLokal(new Date(alt.zeit)).slice(0, 10) === heute();
  const optionen = altHeute ? [["jetzt", "Jetzt"], [-15, "−15"], [-30, "−30"], [-60, "−60"]] : [];
  if (plan && altHeute) optionen.push(["plan", `Plan ${String(plan.getHours()).padStart(2, "0")}:${String(plan.getMinutes()).padStart(2, "0")}`]);
  optionen.push(["uhr", "Uhrzeit…"]);
  const start = alt ? "uhr" : vorgabe.art === "plan" && plan ? "plan" : "jetzt";
  const eingabe = el("input", { type: "datetime-local", "aria-label": "Uhrzeit",
    value: zuEingabe(alt ? new Date(alt.zeit) : vorgabe.zeit || new Date()) });
  const anzeige = el("div", { class: "zeitanzeige" });
  const c = chips(optionen, { wert: start, beiWahl: () => aktualisiere() });
  const wert = () => {
    const w = c.wert();
    if (w === "jetzt") return { zeit: isoLokal(new Date()), geschaetzt: false };
    if (typeof w === "number") return { zeit: isoLokal(new Date(Date.now() + w * 60e3)), geschaetzt: true };
    if (w === "plan") return { zeit: isoLokal(plan), geschaetzt: true };
    if (alt && eingabe.value.slice(0, 16) === zuEingabe(new Date(alt.zeit))) return { zeit: alt.zeit, geschaetzt: geschaetzt(alt) };
    if (!eingabe.value) throw new Error("Uhrzeit fehlt.");
    return { zeit: isoLokal(new Date(eingabe.value)), geschaetzt: true };
  };
  const aktualisiere = () => {
    eingabe.hidden = c.wert() !== "uhr";
    try {
      const w = wert();
      if (Date.parse(w.zeit) > Date.now() + 10 * 60e3) { anzeige.textContent = "Liegt in der Zukunft"; return; }
      const d = new Date(w.zeit);
      const tag = isoLokal(d).slice(0, 10) === heute() ? "heute" : d.toLocaleDateString("de-CH", { day: "numeric", month: "numeric" });
      anzeige.textContent = `${tag} ${uhr(isoLokal(d))}${w.geschaetzt ? " · geschätzt" : ""}`;
    } catch { anzeige.textContent = ""; }
  };
  eingabe.addEventListener("input", aktualisiere);
  aktualisiere();
  return {
    node: feld("Wann", c.node, eingabe, anzeige),
    wert: () => {
      const w = wert();
      if (Date.parse(w.zeit) > Date.now() + 10 * 60e3) throw new Error("Der Zeitpunkt liegt in der Zukunft.");
      return w;
    },
  };
}

const mitZeit = (daten, w) => (w.geschaetzt ? { ...daten, zeit_geschaetzt: true } : daten);
const notizFeld = (wert = "", titel = "Notiz") => {
  const t = el("textarea", { rows: 2, "aria-label": titel });
  t.value = wert;
  return { node: feld(titel, t), wert: () => t.value.trim() };
};

// ------------------------------------------------------------ Einnahme

const planZeile = (e) => tagesplan(zustand.konfig).find((z) => gehoertZu(e, z)) || null;
/** "24.11., 06:20" oder "unbekannt" (#9). */
const tagKurz = (tag) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;
const standText = (ps) => ps.tag ? `${tagKurz(ps.tag)}, ${ps.uhr}` : "unbekannt";

/**
 * Blatt für eine Einnahme. zeile = Zeile des Tagesplans (oder null für ein
 * anderes Mittel), alt = bestehendes Ereignis beim Ändern.
 */
function einnahmeBlatt(zeile, alt = null, zeitVorgabe = null) {
  const wirk = wirksam(zustand.alle);
  const d0 = alt?.daten || {};
  const inhalt = [];
  let nameEingabe = null, dosisText = null, dosis = null, dosisAndere = null, dosisFeld = null, mgEingabe = null;
  let vonHand = false, ausAlt = false;

  if (!zeile) {
    nameEingabe = el("input", { type: "text", "aria-label": "Mittel", autocomplete: "off", value: d0.mittel || "" });
    dosisText = el("input", { type: "text", "aria-label": "Dosis", value: d0.dosis || "", placeholder: "z. B. 2 Kapseln" });
    inhalt.push(feld("Mittel", nameEingabe), feld("Dosis (optional)", dosisText));
    // 0.4.1: Ändern ohne passende Planzeile (Plan inzwischen anders): mg bleibt als eigenes Feld änderbar,
    // die Gabe bleibt, solange das Mittel gleich bleibt (Prüfer 24.11.: sonst Freitext und mg im Widerspruch)
    if (alt && d0.dosis_mg != null) {
      mgEingabe = el("input", { type: "text", inputmode: "decimal", "aria-label": "Dosis in mg", value: String(d0.dosis_mg).replace(".", ",") });
      inhalt.push(feld("Dosis in mg (leer = keine)", mgEingabe));
    }
    if (alt && d0.gabe) inhalt.push(el("p", { class: "leise" }, `Gabe ${d0.gabe} bleibt erhalten, solange das Mittel gleich bleibt`));
  } else if (zeile.medikament) {
    // Gremium #4: weicht die letzte Dosis vom Plan ab, wird nichts vorgewählt.
    // #9 (0.4.1): ebenso, wenn der Plan nicht vom Tag der Einnahme stammt.
    const tagDerEinnahme = isoLokal((alt || zeitVorgabe) ? new Date((alt || zeitVorgabe).zeit) : new Date()).slice(0, 10);
    const ps = planStand(zustand.konfig, tagDerEinnahme);
    ausAlt = d0.status === "genommen" && d0.dosis_mg != null;
    const v = dosisVorschlag({ alt: d0.status === "genommen" ? d0.dosis_mg ?? null : null, plan: zeile.dosis_mg ?? null,
      letzte: letzteDosis(zeile.name, zeile.supplement_id, wirk, zeile.gabe), planAktuell: ps.aktuell });
    const optionen = [...new Set([...(zeile.dosis_optionen || []), v.plan, v.letzte, v.wert].filter((n) => n != null))]
      .sort((a, b) => a - b).map((n) => [n, `${n} mg`]);
    optionen.push(["andere", "andere"]);
    dosisAndere = el("input", { type: "text", inputmode: "decimal", "aria-label": "Dosis in mg", hidden: true });
    dosis = chips(optionen, { wert: v.wert, beiWahl: (w) => { vonHand = true; dosisAndere.hidden = w !== "andere"; } });
    const planText = v.veraltet ? (ps.tag ? `Plan vom ${standText(ps)}: ${v.plan} mg` : `Plan (Stand unbekannt): ${v.plan} mg`) : `Plan: ${v.plan} mg`;
    const vergleich = v.abweichung || v.veraltet ? el("div", { class: "dosisvergleich" },
      el("span", { class: v.veraltet ? "veraltet" : "" }, planText), v.letzte != null ? el("span", {}, `Zuletzt: ${v.letzte} mg`) : null)
      : v.wert == null && v.letzte != null ? el("div", { class: "dosisvergleich" }, el("span", {}, `Zuletzt: ${v.letzte} mg`)) : null;
    const titel = v.veraltet ? `Dosis: Plan ist nicht ${tagDerEinnahme === heute() ? "von heute" : `vom ${tagKurz(tagDerEinnahme)}`}, bitte wählen`
      : v.abweichung ? "Dosis: Plan und letzte Einnahme weichen ab, bitte wählen"
      : v.wert == null ? "Dosis: bitte wählen" : "Dosis";
    dosisFeld = feld(titel, vergleich, dosis.node, dosisAndere);
    inhalt.push(dosisFeld);
  }

  const plan = zeile?.plan ? amTag(heute(), zeile.plan) : null;
  const vb = zeile ? vorbelegung(zeile) : { art: "jetzt" };
  // zeitVorgabe (0.4): Nachtrag für einen früheren Tag aus dem Abendrückblick, Uhrzeit vorbelegt
  const zw = zeitwahl({ vorgabe: vb, plan: plan && plan <= new Date() ? plan : null, alt: alt || zeitVorgabe });
  const nz = notizFeld(alt?.notiz || "");
  inhalt.push(zw.node, nz.node);

  const sammle = (status, grund = null) => {
    const w = zw.wert();
    const daten = { status };
    if (zeile) {
      daten.mittel = zeile.name;
      if (zeile.supplement_id) daten.supplement_id = zeile.supplement_id;
      if (zeile.gabe) daten.gabe = zeile.gabe;
    } else {
      const name = nameEingabe.value.trim();
      if (!name) throw new Error("Welches Mittel?");
      daten.mittel = name;
      const bekannt = tagesplan(zustand.konfig).find((z) => z.name.toLowerCase() === name.toLowerCase());
      if (bekannt?.supplement_id) daten.supplement_id = bekannt.supplement_id;
      if (dosisText.value.trim()) daten.dosis = dosisText.value.trim();
      Object.assign(daten, uebernehmeBeimAendern(d0, name, status));
      if (mgEingabe && status === "genommen" && mgEingabe.value.trim()) {
        const mg = Number(mgEingabe.value.trim().replace(",", "."));
        if (!Number.isFinite(mg) || mg < 0.01 || mg > 5000) throw new Error("Dosis in mg angeben (0,01 bis 5000) oder leer lassen.");
        daten.dosis_mg = mg;
      }
    }
    // Gremium #10: ausgelassen trägt keine Dosis
    if (dosis && status === "genommen") {
      let mg = dosis.wert();
      if (mg === "andere") {
        const roh = dosisAndere.value.trim();
        mg = Number(roh.replace(",", "."));
        if (!roh || !Number.isFinite(mg) || mg < 0.01 || mg > 5000) throw new Error("Dosis in mg angeben (0,01 bis 5000).");
      }
      if (mg == null) throw new Error("Welche Dosis? Bitte wählen.");
      // #9 (Prüfer 24.11.): eine Vorwahl gilt nur für den Tag, dessen Plan sie trägt. Zeit im Blatt auf
      // einen anderen Tag gestellt oder Blatt über Mitternacht offen: neu wählen lassen.
      const tagGespeichert = isoLokal(new Date(w.zeit)).slice(0, 10);
      if (!vorwahlGilt({ vonHand, ausAlt, planAktuell: planStand(zustand.konfig, tagGespeichert).aktuell })) {
        dosis.setze(null);
        throw new Error(`Der Plan ist nicht ${tagGespeichert === heute() ? "von heute" : `vom ${tagKurz(tagGespeichert)}`}, bitte Dosis wählen.`);
      }
      daten.dosis_mg = mg;
    }
    if (grund) daten.grund = grund;
    return { daten: mitZeit(daten, w), zeit: w.zeit, notiz: nz.wert() };
  };
  const speichern = async (status, grund = null) => {
    const s = sammle(status, grund);
    if (zeile?.medikament && s.daten.dosis_mg != null && dosisAusserhalb(s.daten.dosis_mg, zeile)) {
      const vorgesehen = [...new Set([...(zeile.dosis_optionen || []), zeile.dosis_mg].filter((n) => n != null))]
        .sort((a, b) => a - b).map((n) => `${n} mg`).join(", ");
      if (!confirm(`${s.daten.dosis_mg} mg ist keine vorgesehene Dosis (${vorgesehen}). Trotzdem speichern?`)) return;
    }
    const gespeichert = await erfasse("einnahme", s.daten, { zeit: s.zeit, notiz: s.notiz, ersetzt: alt?.id || null });
    schliesseBlatt();
    toastFuer(gespeichert);
  };

  const titel = zeile ? zeile.name : alt ? "Einnahme ändern" : "Anderes Mittel";
  const untertitel = zeile ? [zeile.label, zeile.block !== "weitere" ? TAGESZEITEN[zeile.block]?.label : null]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : "";
  const hauptKnoepfe = [
    { text: "Genommen", klasse: "haupt", aktion: () => speichern("genommen") },
    { text: "Ausgelassen", aktion: () => grundSchritt() },
    ...(alt ? [{ text: "Löschen", klasse: "warn", aktion: async () => { await storniere(alt); schliesseBlatt(); } }] : []),
    { text: "Abbrechen", klasse: "leicht" + (alt ? "" : " voll"), aktion: schliesseBlatt },
  ];
  const grundSchritt = () => {
    sammle("ausgelassen");                       // früh prüfen (Name, Zeit)
    const g = chips(GRUENDE.map((x) => [x, x]), { wert: d0.status === "ausgelassen" ? d0.grund ?? null : null, abwaehlbar: true });
    oeffneBlatt({ titel, untertitel: "Ausgelassen: warum?", inhalt: [...inhalt.filter((n) => n !== dosisFeld), feld("Grund", g.node)], knoepfe: [
      { text: "Ausgelassen speichern", klasse: "haupt", aktion: () => speichern("ausgelassen", g.wert()) },
      { text: "Zurück", aktion: () => oeffneBlatt({ titel, untertitel, inhalt, knoepfe: hauptKnoepfe }) },
    ] });
  };
  oeffneBlatt({ titel, untertitel, inhalt, knoepfe: hauptKnoepfe });
}

function sammelBlatt(block, zeilen) {
  const haken = zeilen.map((z) => ({ z, box: el("input", { type: "checkbox", checked: true, "aria-label": z.name }) }));
  const liste = el("div", {}, haken.map(({ z, box }) => el("label", { class: "auswahl" }, box, z.name)));
  const plan = amTag(heute(), TAGESZEITEN[block].plan);
  const zw = zeitwahl({ vorgabe: vorbelegung(zeilen[0]), plan: plan <= new Date() ? plan : null });
  oeffneBlatt({ titel: `${TAGESZEITEN[block].label}: Supplemente`, untertitel: "Abgewählte bleiben offen", inhalt: [feld("Genommen", liste), zw.node],
    knoepfe: [
      { text: "Genommen speichern", klasse: "haupt", aktion: async () => {
        const w = zw.wert();
        const gewaehlt = haken.filter((h) => h.box.checked).map((h) => h.z);
        if (!gewaehlt.length) throw new Error("Nichts ausgewählt.");
        const neu = [];
        for (const h of haken.filter((x) => x.box.checked)) {
          neu.push(await erfasse("einnahme", mitZeit({ mittel: h.z.name, supplement_id: h.z.supplement_id, gabe: h.z.gabe, status: "genommen" }, w), { zeit: w.zeit }));
          h.box.checked = false;               // schon gespeichert: bei einem Fehler nicht doppelt
        }
        schliesseBlatt();
        toast(`${neu.length} Supplemente abgehakt`, { rueck: async () => { for (const e of neu) await storniere(aktuelleFassung(e)); } });
      } },
      { text: "Abbrechen", klasse: "leicht", aktion: schliesseBlatt },
    ] });
}

// ------------------------------------------------------------ Weitere Blätter

function befindenBlatt(alt = null) {
  const d0 = alt?.daten || {};
  const skalen = BEFINDEN.map(([k, name, links, rechts]) => {
    const c = chips([1, 2, 3, 4, 5].map((n) => [n, String(n)]), { wert: d0[k] ?? null, abwaehlbar: true, klasse: "skala" });
    c.node.setAttribute("role", "group");
    c.node.setAttribute("aria-label", `${name}, 1 ${links} bis 5 ${rechts}`);
    return { k, node: feld(name, c.node, el("div", { class: "anker" }, el("span", {}, links), el("span", {}, rechts))), wert: c.wert };
  });
  const zw = zeitwahl({ alt });
  const nz = notizFeld(alt?.notiz || "");
  oeffneBlatt({ titel: "Wie geht es dir gerade?", untertitel: "5 ist jeweils gut. Leer lassen geht.",
    inhalt: [...skalen.map((s) => s.node), zw.node, nz.node], knoepfe: [
      { text: "Speichern", klasse: "haupt" + (alt ? "" : " voll"), aktion: async () => {
        const daten = {};
        for (const s of skalen) if (s.wert() != null) daten[s.k] = s.wert();
        if (!Object.keys(daten).length) throw new Error("Mindestens eine Skala wählen.");
        const w = zw.wert();
        const gespeichert = await erfasse("wirkung", mitZeit(daten, w), { zeit: w.zeit, notiz: nz.wert(), ersetzt: alt?.id || null });
        schliesseBlatt();
        toastFuer(gespeichert);
      } },
      ...(alt ? [{ text: "Löschen", klasse: "warn", aktion: async () => { await storniere(alt); schliesseBlatt(); } }] : []),
      { text: "Abbrechen", klasse: "leicht voll", aktion: schliesseBlatt },
    ] });
}

function nebenBlatt(art, alt = null) {
  const d0 = alt?.daten || { art };
  const text = el("input", { type: "text", "aria-label": "Welche Nebenwirkung", value: d0.text || "", hidden: d0.art !== "freitext" });
  const artWahl = chips([...NEBENWIRKUNGEN, ["freitext", "Andere"]], { wert: d0.art,
    beiWahl: (w) => { text.hidden = w !== "freitext"; } });
  const st = chips(STAERKEN, { wert: d0.staerke ?? null, abwaehlbar: true });
  const zw = zeitwahl({ alt });
  const nz = notizFeld(alt?.notiz || "");
  oeffneBlatt({ titel: "Nebenwirkung", inhalt: [feld("Was", artWahl.node, text), feld("Stärke", st.node), zw.node, nz.node], knoepfe: [
    { text: "Speichern", klasse: "haupt" + (alt ? "" : " voll"), aktion: async () => {
      const a = artWahl.wert();
      if (!a) throw new Error("Was für eine Nebenwirkung?");
      const daten = { art: a };
      if (a === "freitext") { if (!text.value.trim()) throw new Error("Kurz beschreiben."); daten.text = text.value.trim(); }
      if (st.wert() != null) daten.staerke = st.wert();
      const w = zw.wert();
      const gespeichert = await erfasse("nebenwirkung", mitZeit(daten, w), { zeit: w.zeit, notiz: nz.wert(), ersetzt: alt?.id || null });
      schliesseBlatt();
      toastFuer(gespeichert);
    } },
    ...(alt ? [{ text: "Löschen", klasse: "warn", aktion: async () => { await storniere(alt); schliesseBlatt(); } }] : []),
    { text: "Abbrechen", klasse: "leicht voll", aktion: schliesseBlatt },
  ] });
}

function zahlFeld(titel, wert) {
  const i = el("input", { type: "text", inputmode: "numeric", "aria-label": titel, value: wert ?? "" });
  return { node: feld(titel, i), wert: () => i.value.trim() };
}
function ganz(text, name, lo, hi) {
  if (text === "") return undefined;
  const n = Number(text.replace(",", "."));
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${name}: ${lo} bis ${hi}`);
  return n;
}

/** Blatt für die übrigen Typen (Blutdruck, Notiz, Essen und Trinken, Wachphase). */
function allgemeinBlatt(typ, alt = null) {
  const d0 = alt?.daten || {};
  const inhalt = [];
  let lesen;
  const titel = { blutdruck: "Blutdruck und Puls", notiz: "Notiz", mahlzeit: "Mahlzeit", kaffee: "Kaffee", alkohol: "Alkohol", wach: "Wachphase" }[typ] || typ;
  if (typ === "blutdruck") {
    const s = zahlFeld("Systolisch", d0.sys), di = zahlFeld("Diastolisch", d0.dia), p = zahlFeld("Puls", d0.puls);
    inhalt.push(s.node, di.node, p.node);
    lesen = () => {
      const sys = ganz(s.wert(), "Systolisch", 60, 260), dia = ganz(di.wert(), "Diastolisch", 30, 160), puls = ganz(p.wert(), "Puls", 25, 220);
      if ((sys === undefined) !== (dia === undefined)) throw new Error("Systolisch und diastolisch zusammen angeben.");
      const d = {};
      if (sys !== undefined) { if (dia >= sys) throw new Error("Diastolisch muss kleiner sein."); d.sys = sys; d.dia = dia; }
      if (puls !== undefined) d.puls = puls;
      if (!Object.keys(d).length) throw new Error("Blutdruck oder Puls angeben.");
      return d;
    };
  } else if (typ === "mahlzeit") {
    const r = chips([[true, "Richtige Mahlzeit"], [false, "Snack"]], { wert: d0.richtig ?? true });
    const art = el("input", { type: "text", "aria-label": "Was", value: d0.art || "" });
    inhalt.push(feld("Art", r.node), feld("Was (optional)", art));
    lesen = () => ({ richtig: r.wert() !== false, ...(art.value.trim() ? { art: art.value.trim() } : {}) });
  } else if (typ === "kaffee" || typ === "alkohol") {
    const m = el("input", { type: "text", inputmode: "decimal", "aria-label": "Menge", value: d0.menge ?? "" });
    inhalt.push(feld(typ === "kaffee" ? "Tassen (optional)" : "Gläser (optional)", m));
    lesen = () => {
      if (!m.value.trim()) return {};
      const n = Number(m.value.replace(",", "."));
      if (!Number.isFinite(n) || n < 0.01 || n > 50) throw new Error("Menge: 0,01 bis 50");
      return { menge: n };
    };
  } else if (typ === "wach") {
    const bisAlt = d0.bis ? isoLokal(new Date(d0.bis)).slice(0, 16) : "";
    const bis = el("input", { type: "datetime-local", "aria-label": "Wach bis", value: bisAlt });
    const grund = el("input", { type: "text", "aria-label": "Grund", value: d0.grund || "" });
    inhalt.push(feld("Wach bis (leer = läuft noch)", bis), feld("Grund (optional)", grund));
    lesen = (w) => {
      const d = {};
      if (bis.value) {
        d.bis = d0.bis && bis.value.slice(0, 16) === bisAlt ? d0.bis : isoLokal(new Date(bis.value));
        if (Date.parse(d.bis) < Date.parse(w.zeit)) throw new Error("„Bis“ liegt vor dem Beginn.");
      }
      if (grund.value.trim()) d.grund = grund.value.trim();
      return d;
    };
  } else {
    lesen = () => ({});
  }
  const zw = zeitwahl({ alt });
  const nz = notizFeld(alt?.notiz || "", typ === "notiz" ? "Text" : "Notiz");
  inhalt.push(zw.node, nz.node);
  oeffneBlatt({ titel, inhalt, knoepfe: [
    { text: "Speichern", klasse: "haupt" + (alt ? "" : " voll"), aktion: async () => {
      const w = zw.wert();
      const daten = lesen(w);
      if (typ === "notiz" && !nz.wert()) throw new Error("Text fehlt.");
      const gespeichert = await erfasse(typ, mitZeit(daten, w), { zeit: w.zeit, notiz: nz.wert(), ersetzt: alt?.id || null });
      schliesseBlatt();
      toastFuer(gespeichert);
    } },
    ...(alt ? [{ text: "Löschen", klasse: "warn", aktion: async () => { await storniere(alt); schliesseBlatt(); } }] : []),
    { text: "Abbrechen", klasse: "leicht voll", aktion: schliesseBlatt },
  ] });
}

function bearbeite(e) {
  if (e.typ === "rueckblick_nacht") return rueckblickBlatt("nacht", e.daten.nacht, e);
  if (e.typ === "rueckblick_tag") return rueckblickBlatt("tag", e.daten.tag, e);
  if (e.typ === "einnahme") return einnahmeBlatt(planZeile(e), e);
  if (e.typ === "wirkung") return befindenBlatt(e);
  if (e.typ === "nebenwirkung") return nebenBlatt(e.daten.art, e);
  return allgemeinBlatt(e.typ, e);
}

/** Sperre gegen Doppeltipps bei Ein-Tipp-Knöpfen (Wach, Essen und Trinken). */
let einTippLaeuft = false;
async function einmal(fn) {
  if (einTippLaeuft) return;
  einTippLaeuft = true;
  try { await fn(); }
  catch (f) { toast(`Nicht gespeichert: ${f.message}`); }
  finally { setTimeout(() => { einTippLaeuft = false; }, 400); }
}

/** Ein Tipp speichert (Essen und Trinken), Hinweis mit "Zeit ändern" und "Rückgängig". */
async function schnell(typ, daten) {
  if (einTippLaeuft) return;
  einTippLaeuft = true;
  let ev;
  try { ev = await erfasse(typ, daten); }
  catch (f) { toast(`Nicht gespeichert: ${f.message}`); return; }
  finally { setTimeout(() => { einTippLaeuft = false; }, 400); }
  toast(`${zeitText(ev)} ${beschreibe(ev)}`, { aendernText: "Zeit ändern",
    aendern: () => bearbeite(aktuelleFassung(ev)), rueck: () => macheRueckgaengig(ev) });
}


// ------------------------------------------------------------ Rückblick (0.4, Befindens-Log)

const tagText = (tag) => tag === heute() ? "heute" : tag === tagPlus(heute(), -1) ? "gestern"
  : new Date(`${tag}T12:00:00`).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" });

/** Mehrfachauswahl-Chips (an/aus je Chip). */
function mehrfach(optionen, { wert = [], beiWahl = null } = {}) {
  const an = new Set(wert);
  const knoepfe = optionen.map(([v, text]) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(an.has(v)),
    onclick: (ev) => {
      if (an.has(v)) an.delete(v); else an.add(v);
      ev.currentTarget.setAttribute("aria-pressed", String(an.has(v)));
      beiWahl?.(optionen.map(([x]) => x).filter((x) => an.has(x)));
    },
  }, text));
  return { node: el("div", { class: "chips" }, knoepfe), wert: () => optionen.map(([x]) => x).filter((x) => an.has(x)) };
}

function skalaFeld([k, name, links, rechts], wert, beiWahl) {
  const c = chips([1, 2, 3, 4, 5].map((n) => [n, String(n)]), { wert, klasse: "skala", beiWahl });
  c.node.setAttribute("role", "group");
  c.node.setAttribute("aria-label", `${name}, 1 ${links}, 3 wie meist, 5 ${rechts}`);
  return { k, wert: c.wert, node: feld(name, c.node,
    el("div", { class: "anker" }, el("span", {}, `1 ${links}`), el("span", {}, "3 wie meist"), el("span", {}, `5 ${rechts}`))) };
}

/** Gab es für die Nacht auf "tag" schon ein Alkohol-Ereignis (Vortag ab 12:00 bis 06:00, Ortszeit)? */
function alkoholErfasst(tag, wirk) {
  const von = `${tagPlus(tag, -1)}T12:00`, bis = `${tag}T06:00`;
  return wirk.some((e) => e.typ === "alkohol" && e.zeit.slice(0, 16) >= von && e.zeit.slice(0, 16) < bis);
}

/**
 * Felder eines Rückblicks. start = { daten, notiz }; merke(daten, notiz) hält
 * einen Entwurf fest, damit das Neuzeichnen von "Heute" keine Wahl verliert.
 */
function rueckblickFelder(art, tag, start = {}, merke = null) {
  const d0 = start.daten || {};
  const stand = { daten: { ...d0 }, notiz: start.notiz || "" };
  const neu = () => merke?.({ ...stand.daten }, stand.notiz);
  const setze = (k) => (w) => { if (w == null) delete stand.daten[k]; else stand.daten[k] = w; neu(); };
  const nodes = [];
  const wirk = wirksam(zustand.alle);
  if (art === "nacht") {
    nodes.push(skalaFeld(SCHLAF_SKALA, d0.schlaf ?? null, setze("schlaf")).node);
    nodes.push(feld("Was war? (optional)", mehrfach(NACHT_MERKMALE, { wert: d0.merkmale || [], beiWahl: setze("merkmale") }).node));
    if (d0.alkohol != null || !alkoholErfasst(tag, wirk)) {
      nodes.push(feld("Gestern Abend Alkohol? (optional)", chips(GLAESER, { wert: d0.alkohol ?? null, abwaehlbar: true, beiWahl: setze("alkohol") }).node));
    } else {
      nodes.push(el("p", { class: "leise" }, "Alkohol am Vorabend ist schon erfasst."));
    }
  } else {
    for (const sk of TAG_SKALEN) nodes.push(skalaFeld(sk, d0[sk[0]] ?? null, setze(sk[0])).node);
    nodes.push(feld("Besonderes heute (optional)", mehrfach(TAG_MERKMALE, { wert: d0.merkmale || [], beiWahl: setze("merkmale") }).node));
    const nw = wirk.filter((e) => e.typ === "nebenwirkung" && logTag(new Date(e.zeit)) === tag).length;
    if (nw) {
      delete stand.daten.keine_nebenwirkungen;
      nodes.push(el("p", { class: "leise" }, `Nebenwirkungen an diesem Tag: ${nw} erfasst.`));
    } else {
      nodes.push(feld("Nebenwirkungen", chips([[true, "heute keine"]], { wert: d0.keine_nebenwirkungen ? true : null,
        abwaehlbar: true, beiWahl: setze("keine_nebenwirkungen") }).node));
    }
  }
  const t = el("input", { type: "text", "aria-label": "Eine Zeile (optional)",
    placeholder: art === "nacht" ? "Eine Zeile, z. B. stark geschwitzt um 3 Uhr" : "Eine Zeile (optional)" });
  t.value = stand.notiz;
  t.addEventListener("input", () => { stand.notiz = t.value; neu(); });
  nodes.push(feld("", t));
  return {
    nodes,
    wert: () => {
      const daten = { [art]: tag };
      for (const [k, v] of Object.entries(stand.daten)) {
        if (k === art || v == null || v === false || (Array.isArray(v) && !v.length)) continue;
        daten[k] = v;
      }
      pruefeRueckblick(art, daten);
      return { daten, notiz: stand.notiz.trim() };
    },
  };
}

async function speichereRueckblick(art, f, alt = null) {
  const { daten, notiz } = f.wert();
  return erfasse(art === "nacht" ? "rueckblick_nacht" : "rueckblick_tag", daten, { notiz, ersetzt: alt?.id || null });
}

/** Ändern eines gespeicherten Rückblicks im Blatt. */
function rueckblickBlatt(art, tag, alt) {
  const f = rueckblickFelder(art, tag, { daten: alt.daten, notiz: alt.notiz });
  oeffneBlatt({ titel: art === "nacht" ? `Nacht auf ${tagText(tag)}` : `Tag: ${tagText(tag)}`, untertitel: "5 ist jeweils gut, 3 wie meist.",
    inhalt: f.nodes, knoepfe: [
      { text: "Speichern", klasse: "haupt", aktion: async () => { const ev = await speichereRueckblick(art, f, alt); schliesseBlatt(); toastFuer(ev); } },
      { text: "Löschen", klasse: "warn", aktion: async () => { await storniere(alt); schliesseBlatt(); } },
      { text: "Abbrechen", klasse: "leicht voll", aktion: schliesseBlatt },
    ] });
}

/** Ein Tipp für eine offene Medikamentengabe: ausgelassen bzw. bei Bedarf "heute nicht". */
async function medikamentNicht(o, tag) {
  const z = o.zeile;
  const imTag = tag === heute();
  let zeit, daten;
  if (o.art === "gabe") {
    const plan = amTag(tag, z.plan || z.von || "12:00");
    zeit = isoLokal(imTag && plan > new Date() ? new Date() : plan);
    daten = { mittel: z.name, gabe: z.gabe, status: "ausgelassen", zeit_geschaetzt: true };
  } else {
    zeit = isoLokal(imTag ? new Date() : amTag(tag, "23:59"));
    daten = { mittel: z.name, status: "ausgelassen", grund: "heute nicht" };
    if (!imTag) daten.zeit_geschaetzt = true;
  }
  if (z.supplement_id) daten.supplement_id = z.supplement_id;
  toastFuer(await erfasse("einnahme", daten, { zeit }));
}

function rueckblickKarte(k, wirk) {
  const key = `${k.art}|${k.tag}`;
  const titel = k.art === "nacht" ? (k.tag === heute() ? "Letzte Nacht" : `Nacht auf ${tagText(k.tag)}`)
    : (k.tag === heute() ? "Wie war der Tag?" : `Tag: ${tagText(k.tag)}`);
  if (k.ev) {
    const zeile = el("button", { type: "button", class: "zeile genommen rb-fertig", onclick: () => bearbeite(k.ev) },
      el("span", { class: "kreis", "aria-hidden": "true" }, "✓"),
      el("span", { class: "was" }, el("span", { class: "name" }, titel), el("small", {}, beschreibe(k.ev))),
      el("span", { class: "rechts" }, "ändern"));
    const offen = k.art === "tag" ? offeneBlock(k.tag, wirk) : [];
    return offen.length ? el("div", { class: "karte rueckblick" }, zeile, ...offen) : zeile;
  }
  if (!k.haupt && zustand.offenKarte !== key) {
    return el("button", { type: "button", class: "zeile rb-nachtrag", onclick: () => { zustand.offenKarte = key; zeichne(); } },
      el("span", { class: "kreis", "aria-hidden": "true" }, ""),
      el("span", { class: "was" }, el("span", { class: "name" }, `${titel}: noch nicht bewertet`)),
      el("span", { class: "rechts" }, "nachtragen"));
  }
  const entwurf = zustand.entwurf[key] || {};
  const f = rueckblickFelder(k.art, k.tag, entwurf, (daten, notiz) => { zustand.entwurf[key] = { daten, notiz }; });
  const meldung = el("p", { class: "fehlertext", role: "alert", hidden: true });
  let laeuft = false;
  const knopf = el("button", { type: "button", class: "speichern", onclick: async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      const ev = await speichereRueckblick(k.art, f);
      delete zustand.entwurf[key];
      if (zustand.offenKarte === key) zustand.offenKarte = null;
      zeichne();
      toastFuer(ev);
    } catch (fe) { meldung.hidden = false; meldung.textContent = fe.message; }
    finally { laeuft = false; }
  } }, "Speichern");
  const teile = [el("h3", {}, titel), ...f.nodes, knopf, meldung];
  if (k.art === "tag") teile.push(...offeneBlock(k.tag, wirk));
  return el("div", { class: "karte rueckblick" }, teile);
}

/** "Noch offen" am Abend: nur Medikamente (Gaben nach Fensterbeginn, bei Bedarf ohne Eintrag). */
function offeneBlock(tag, wirk) {
  const offen = offeneMedikamente(tagesplan(zustand.konfig), wirk, tag);
  if (!offen.length) return [];
  return [el("h4", {}, "Noch offen"), ...offen.map((o) => el("div", { class: "offenzeile" },
    el("span", { class: "was" }, o.zeile.name, el("small", {}, o.art === "gabe" ? o.zeile.label : "bei Bedarf")),
    el("span", { class: "chips" },
      el("button", { type: "button", class: "chip", onclick: () => einnahmeBlatt(o.zeile, null, tag === heute() ? null
        : { zeit: isoLokal(amTag(tag, o.zeile.plan || "20:00")), daten: { zeit_geschaetzt: true } }) }, "Genommen"),
      el("button", { type: "button", class: "chip", onclick: () => einmal(() => medikamentNicht(o, tag)) },
        o.art === "gabe" ? "Ausgelassen" : "Heute nicht"))))];
}

function zeichneRueckblick(wirk) {
  // Tippt jemand gerade in die Zeile der Karte, nicht neu aufbauen (Fokus und Tastatur blieben sonst nicht)
  const box = $("rueckblick");
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  box.replaceChildren(...rueckblickKarten(wirk).map((k) => rueckblickKarte(k, wirk)));
}

// ------------------------------------------------------------ Zeichnen

function zeichneHeute(wirk) {
  zeichneRueckblick(wirk);
  const plan = tagesplan(zustand.konfig);
  const tag = heute();
  $("planleer").hidden = plan.length > 0;
  // #9 (0.4.1): Stand des Plans immer sichtbar, markiert, wenn er nicht von heute ist
  const ps = planStand(zustand.konfig, tag);
  // Prüfer 24.11.: markiert nur, wenn es Medikamente mit Plan-Dosis gibt; sonst ändert der alte Stand nichts
  const betroffen = plan.some((z) => z.medikament && z.dosis_mg != null);
  const standSatz = ps.tag ? `Plan vom ${standText(ps)}` : "Stand des Plans unbekannt";
  $("planstand").hidden = !zustand.konfig;
  $("planstand").className = ps.aktuell || !betroffen ? "leise planstand" : "planstand veraltet";
  $("planstand").textContent = ps.aktuell || !betroffen ? standSatz
    : `${standSatz}, nicht von heute. Dosen der Medikamente werden nicht vorgewählt. Abgleichen holt den neuen Plan, sobald der Laptop ihn erzeugt hat.`;
  const bloecke = [];
  let faellig = 0;
  const jetztHHMM = uhr(isoLokal(new Date()));
  for (const block of ["morgens", "mittags", "abends"]) {
    const zeilen = plan.filter((z) => z.block === block);
    if (!zeilen.length) continue;
    const mitStatus = zeilen.map((z) => ({ z, s: statusFuer(z, wirk, tag) }));
    const erledigt = mitStatus.filter((x) => x.s).length;
    faellig += mitStatus.filter((x) => !x.s && x.z.von && x.z.von <= jetztHHMM).length;
    const offeneSupps = mitStatus.filter((x) => !x.s && !x.z.medikament).map((x) => x.z);
    bloecke.push(el("div", { class: "block" },
      el("div", { class: "blockkopf" }, el("h2", {}, TAGESZEITEN[block].label), el("span", { class: "leise" }, `${erledigt} von ${zeilen.length}`)),
      el("div", { class: "karte" }, mitStatus.map(({ z, s }) => {
        const st = s ? s.daten.status : "";
        const rechts = s ? (st === "ausgelassen" ? "ausgelassen" : zeitText(s)) : (z.medikament && z.dosis_mg != null ? `${z.dosis_mg} mg${ps.aktuell ? "" : " (alter Plan)"}` : "");
        const klein = [z.medikament ? z.label : null, s?.daten?.dosis_mg != null ? `${s.daten.dosis_mg} mg` : null].filter(Boolean).join(" · ");
        return el("button", { type: "button", class: `zeile ${st}`, onclick: () => einnahmeBlatt(z, s ? aktuelleFassung(s) : null),
          "aria-label": `${z.name}${klein ? `, ${klein}` : ""}${s ? `, ${st} ${uhr(s.zeit)}` : ", offen"}` },
        el("span", { class: "kreis", "aria-hidden": "true" }, st === "genommen" ? "✓" : st === "ausgelassen" ? "–" : ""),
        el("span", { class: "was" }, el("span", { class: "name" }, z.name), klein ? el("small", {}, klein) : null),
        el("span", { class: "rechts" }, rechts));
      })),
      offeneSupps.length >= 2 ? el("button", { type: "button", class: "chip sammel", onclick: () => sammelBlatt(block, offeneSupps) },
        `Offene Supplemente abhaken (${offeneSupps.length})`) : null));
  }
  $("plan").replaceChildren(...bloecke);
  const weitere = plan.filter((z) => z.block === "weitere");
  $("weitere").replaceChildren(
    ...weitere.map((z) => {
      const heuteGenommen = wirk.filter((e) => e.zeit.slice(0, 10) === tag && gehoertZu(e, z) && e.daten.status === "genommen");
      return el("button", { type: "button", class: "knopf", onclick: () => einnahmeBlatt(z) }, z.name,
        el("small", { class: "leise" }, heuteGenommen.length
          ? `heute ${heuteGenommen.map((e) => `${zeitText(e)}${e.daten.dosis_mg != null ? ` ${e.daten.dosis_mg} mg` : ""}`).join(", ")}` : "bei Bedarf"));
    }),
    el("button", { type: "button", class: "knopf neben", onclick: () => einnahmeBlatt(null) }, "Anderes Mittel…"));
  $("offenzahl").hidden = !faellig;
  $("offenzahl").textContent = faellig;
}

function zeichneNacht() {
  const offen = offeneWachphase(zustand.alle);
  $("wachbanner").hidden = !offen;
  if (offen) $("wachtext").textContent = `Wach seit ${uhr(offen.zeit)}`;
  $("wachknopf").textContent = offen ? "Wieder schlafen" : "Wach";
  const grenze = Date.now() - 14 * 3600e3;
  const phasen = wirksam(zustand.alle).filter((e) => e.typ === "wach" && Date.parse(e.zeit) >= grenze);
  $("nachtliste").replaceChildren(...(phasen.length ? phasen.map((e) => el("li", {},
    el("button", { type: "button", onclick: () => bearbeite(e) }, el("span", { class: "zeit" }, zeitText(e)), el("span", {}, beschreibe(e)))))
    : [el("li", { class: "leer" }, "Keine Wachphase in den letzten 14 Stunden.")]));
}

function zeichneVerlauf(wirk) {
  const tag = zustand.tag || heute();
  $("tagtitel").textContent = tag === heute() ? "Heute" : new Date(`${tag}T12:00:00`).toLocaleDateString("de-CH",
    { weekday: "long", day: "numeric", month: "long" });
  $("tagvor").disabled = tag >= heute();
  const liste = wirk.filter((e) => e.zeit.slice(0, 10) === tag);
  $("liste").replaceChildren(...(liste.length ? liste.map((e) => el("li", {},
    el("button", { type: "button", onclick: () => bearbeite(e) },
      el("span", { class: "zeit" }, zeitText(e)), el("span", {}, beschreibe(e)),
      e._sync ? null : el("span", { class: "offen" }, "nicht hochgeladen")))) : [el("li", { class: "leer" }, "Nichts erfasst.")]));
  $("geraetknopf").textContent = `Gerät: ${zustand.geraet}`;
}

function zeichne() {
  const wirk = wirksam(zustand.alle);
  zeichneHeute(wirk);
  zeichneNacht();
  zeichneVerlauf(wirk);
  const nOffen = zustand.alle.filter((e) => !e._sync).length;
  const s = $("sync");
  if (zustand.laeuft) { s.textContent = "Lädt hoch…"; s.className = "chip"; }
  else if (zustand.sync.art === "fehler") { s.textContent = `${nOffen} offen · Fehler`; s.className = "chip fehler"; }
  else if (zustand.sync.art === "anmelden") { s.textContent = `${nOffen} offen · anmelden`; s.className = "chip offen"; }
  else if (nOffen) { s.textContent = `${nOffen} offen`; s.className = "chip offen"; }
  else { s.textContent = zustand.sync.text ? `✓ ${zustand.sync.text}` : "✓"; s.className = "chip ok"; }
  $("hinweis").hidden = !zustand.sync.meldung;
  $("hinweis").textContent = zustand.sync.meldung || "";
  // Gremium #5: Rückstand ab 24 h sichtbar, auf jedem Reiter
  const r = rueckstand(zustand.alle);
  $("rueckstand").hidden = !r?.alarm;
  if (r?.alarm) {
    const seit = r.stunden < 48 ? `${Math.floor(r.stunden)} Stunden` : `${Math.floor(r.stunden / 24)} Tagen`;
    const text = `${r.anzahl} ${r.anzahl === 1 ? "Eintrag" : "Einträge"} seit ${seit} nicht hochgeladen. ` +
      `${r.anzahl === 1 ? "Er liegt" : "Sie liegen"} nur auf diesem Gerät. Hochladen oder im Verlauf „Offene sichern“.`;
    if ($("rueckstandtext").textContent !== text) $("rueckstandtext").textContent = text;   // nicht jede Minute neu vorlesen
  }
}

/** Ergebnis von navigator.storage.persist() im Verlauf anzeigen (Gremium #5). */
async function speicherSchutz() {
  let text = "Speicher: Schutz unbekannt", ok = false;
  try {
    if (navigator.storage?.persist) {
      ok = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
      text = ok ? "Speicher: dauerhaft" : "Speicher: nicht dauerhaft, das System kann ihn räumen";
    } else text = "Speicher: Schutz nicht verfügbar";
  } catch { /* bleibt unbekannt */ }
  $("speicher").textContent = text;
  $("speicher").className = ok ? "leise" : "leise warntext";
}

const TITEL = { heute: "Heute", erfassen: "Erfassen", nacht: "Nacht", verlauf: "Verlauf" };
function zeigeReiter(name) {
  zustand.reiter = name;
  for (const r of Object.keys(TITEL)) $(`reiter-${r}`).hidden = r !== name;
  document.querySelectorAll(".reiterleiste button").forEach((b) => {
    if (b.dataset.reiter === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $("kopftitel").textContent = TITEL[name];
  scrollTo(0, 0);
}

// ------------------------------------------------------------ Abgleich

let baldUhr = null;
function baldAbgleichen() { clearTimeout(baldUhr); baldUhr = setTimeout(abgleichen, 1500); }

async function abgleichen() {
  if (zustand.laeuft) return;
  if (!eingerichtet()) {
    zustand.sync = { art: "anmelden", meldung: "Hochladen ist noch nicht eingerichtet. Erfassen geht trotzdem, alles bleibt auf dem Gerät." };
    return zeichne();
  }
  if (!navigator.onLine) { zustand.sync = { art: "", meldung: "" }; return zeichne(); }
  zustand.laeuft = true;
  let tok = null;
  try { tok = await token(); } catch { tok = null; }
  if (!tok) {
    zustand.laeuft = false;
    zustand.sync = { art: "anmelden", meldung: "" }; $("konto").textContent = "Anmelden"; return zeichne();
  }
  zeichne();
  try {
    await hochladen(tok);
    const k = await ladeKonfig(tok).catch(() => null);
    if (k) zustand.konfig = k;
    const gespeichert = await alleEreignisse();
    const ids = new Set(gespeichert.map((e) => e.id));
    zustand.alle = [...gespeichert, ...zustand.alle.filter((e) => !ids.has(e.id))];
    zustand.sync = { art: "ok", text: new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) };
    $("konto").textContent = "Abmelden";
  } catch (f) {
    zustand.sync = f instanceof TypeError
      ? { art: "", meldung: "Keine Verbindung zu OneDrive. Alles bleibt auf dem Gerät und wird später hochgeladen." }
      : { art: "fehler", meldung: f.message };
  } finally {
    zustand.laeuft = false;
    zeichne();
  }
}

// ------------------------------------------------------------ Start

function verdrahten() {
  document.querySelectorAll(".reiterleiste button").forEach((b) => b.addEventListener("click", () => zeigeReiter(b.dataset.reiter)));
  $("neben").replaceChildren(
    ...NEBENWIRKUNGEN.map(([k, t]) => el("button", { type: "button", class: "knopf", onclick: () => nebenBlatt(k) }, t)),
    el("button", { type: "button", class: "knopf neben", onclick: () => nebenBlatt("freitext") }, "Andere…"));
  const aktionen = {
    befinden: () => befindenBlatt(),
    mahlzeit: () => schnell("mahlzeit", { richtig: true }),
    snack: () => schnell("mahlzeit", { richtig: false }),
    kaffee: () => schnell("kaffee", {}),
    alkohol: () => schnell("alkohol", { menge: 1 }),
    blutdruck: () => allgemeinBlatt("blutdruck"),
    notiz: () => allgemeinBlatt("notiz"),
  };
  document.querySelectorAll("[data-aktion]").forEach((b) => b.addEventListener("click", aktionen[b.dataset.aktion]));
  $("wachknopf").onclick = () => einmal(async () => {
    const w = offeneWachphase(zustand.alle);
    if (w) toastFuer(await erfasse("wach", { ...w.daten, bis: isoLokal(new Date()) }, { zeit: w.zeit, ersetzt: w.id, notiz: w.notiz }));
    else toastFuer(await erfasse("wach", {}));
  });
  // Blatt: Tipp ausserhalb schliesst ohne zu speichern
  $("blatt").addEventListener("click", (e) => {
    if (e.target !== $("blatt")) return;
    const r = $("blatt").getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) schliesseBlatt();
  });
  $("bform").addEventListener("submit", (e) => e.preventDefault());

  const anmeldenUndAbgleichen = () => anmelden().then(abgleichen).catch((f) => alert(f.message));
  $("sync").onclick = () => (zustand.sync.art === "anmelden" && eingerichtet() ? anmeldenUndAbgleichen() : abgleichen());
  $("rueckstandknopf").onclick = () => $("sync").onclick();
  $("konto").onclick = async () => {
    if ((await lies("token"))) { await abmelden(); $("konto").textContent = "Anmelden"; zustand.sync = { art: "anmelden" }; zeichne(); }
    else anmeldenUndAbgleichen();
  };
  $("geraetknopf").onclick = async () => {
    const n = (prompt("Gerätename (Kleinbuchstaben, Ziffern, Bindestrich):", zustand.geraet) || "").trim();
    if (!n) return;
    if (!GERAET_MUSTER.test(n)) return alert("Nur Kleinbuchstaben, Ziffern und Bindestrich.");
    zustand.geraet = n; await schreibe("geraet", n); zeichne();
  };
  $("export").onclick = async () => {
    // Ablage am Laptop in erfassung/eingang/sicherung/ (eigener Unterordner, damit
    // sie keine Tagesdatei überschreibt); der Import überspringt schon bekannte ids.
    const offen = zustand.alle.filter((e) => !e._sync);
    if (!offen.length) return alert("Nichts offen, alles ist hochgeladen.");
    const name = `${heute()}_${zustand.geraet}.jsonl`;
    const datei = new File([offen.map(logzeile).join("\n") + "\n"], name, { type: "application/x-ndjson" });
    if (navigator.canShare?.({ files: [datei] })) {
      try { await navigator.share({ files: [datei], title: name }); } catch { /* abgebrochen */ }
    } else {
      const a = el("a", { href: URL.createObjectURL(datei), download: name });
      document.body.append(a); a.click(); a.remove();
    }
  };
  const schiebe = (delta) => {
    const d = new Date(`${zustand.tag || heute()}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const t = isoLokal(d).slice(0, 10);
    zustand.tag = t >= heute() ? null : t;
    zeichne();
  };
  $("tagzurueck").onclick = () => schiebe(-1);
  $("tagvor").onclick = () => schiebe(1);
}

async function start() {
  $("version").textContent = `v${VERSION}${TESTMODUS ? " · Testmodus" : ""}`;
  verdrahten();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  speicherSchutz();
  zustand.geraet = (await lies("geraet")) || "iphone";
  zustand.konfig = (await lies("konfig")) || null;
  zustand.alle = await alleEreignisse();
  try { await rueckkehrVerarbeiten(); } catch (f) { zustand.sync = { art: "fehler", meldung: f.message }; }
  $("konto").textContent = (await lies("token")) ? "Abmelden" : "Anmelden";
  zeigeReiter("heute");
  zeichne();
  abgleichen();
  addEventListener("online", abgleichen);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { zeichne(); abgleichen(); } });
  setInterval(() => { if (document.visibilityState === "visible" && !$("blatt").open) zeichne(); }, 60e3);
}

start();
