// Hanna Erfassung: Ereignisse mit einem Tipp erfassen, offline speichern,
// später nach OneDrive hochladen. Format: LOGFORMAT.md im Bereich Gesundheit.

import { neuesEreignis, isoLokal, wirksam, offeneWachphase, beschreibe, zeile, NEBENWIRKUNGEN, GERAET_MUSTER } from "./format.js";
import { alleEreignisse, speichere, lies, schreibe } from "./speicher.js";
import { anmelden, abmelden, rueckkehrVerarbeiten, token, eingerichtet } from "./anmeldung.js";
import { hochladen, ladeKonfig } from "./abgleich.js";
import { TESTMODUS } from "./konfig.js";

const VERSION = "0.2.1";
const $ = (id) => document.getElementById(id);

const zustand = { alle: [], konfig: null, geraet: "iphone", tag: null, sync: { art: "", text: "" }, laeuft: false };

function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kinder.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

const heute = () => isoLokal(new Date()).slice(0, 10);
const uhr = (iso) => iso.slice(11, 16);

// ------------------------------------------------------------ Erfassen

async function erfasse(typ, daten = {}, { zeit, ersetzt = null, notiz = "", leise = false } = {}) {
  const ev = neuesEreignis({ typ, daten, zeit, ersetzt, notiz, geraet: zustand.geraet });
  ev._sync = 0;
  await speichere(ev);
  zustand.alle.push(ev);
  zeichne();
  if (!leise) toast(ev);
  bald_abgleichen();
  return ev;
}

const storniere = (ev) => erfasse("storno", {}, { ersetzt: ev.id, leise: true });

let toastUhr = null;
function toast(ev) {
  $("toasttext").textContent = `${uhr(ev.zeit)} ${beschreibe(ev)}`;
  $("toast").hidden = false;
  $("toastrueck").onclick = async () => { $("toast").hidden = true; await storniere(aktuelleFassung(ev)); };
  $("toastaendern").onclick = () => { $("toast").hidden = true; oeffneDialog(ev.typ, aktuelleFassung(ev)); };
  // Einnahme ausgelassen: zweiter Tipp direkt im Hinweis statt über den Dialog
  const ausl = ev.typ === "einnahme" && ev.daten.status === "genommen";
  $("toastausgelassen").hidden = !ausl;
  $("toastausgelassen").onclick = async () => {
    $("toast").hidden = true;
    const a = aktuelleFassung(ev);
    await erfasse("einnahme", { ...a.daten, status: "ausgelassen" }, { zeit: a.zeit, ersetzt: a.id, notiz: a.notiz });
  };
  clearTimeout(toastUhr);
  toastUhr = setTimeout(() => { $("toast").hidden = true; }, 6000);
}

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

// ------------------------------------------------------------ Dialog

const FELDER = {
  einnahme: [["mittel", "Mittel", "text"], ["dosis", "Dosis", "text"],
    ["status", "Status", "select", [["genommen", "genommen"], ["ausgelassen", "ausgelassen"]]], ["grund", "Grund", "text"]],
  wach: [["bis", "Wach bis (leer = läuft noch)", "datetime-local"], ["grund", "Grund", "text"]],
  nebenwirkung: [["art", "Art", "select", [...NEBENWIRKUNGEN, ["freitext", "Andere (Text)"]]], ["text", "Text bei „Andere“", "text"],
    ["staerke", "Stärke", "select", [["", "–"], ["1", "1 leicht"], ["2", "2 mittel"], ["3", "3 stark"]]]],
  wirkung: [["fokus", "Fokus", "select", [1, 2, 3, 4, 5].map((n) => [String(n), `${n}`])]],
  mahlzeit: [["richtig", "Richtige Mahlzeit", "select", [["true", "ja"], ["false", "nein, Snack"]]], ["art", "Was", "text"]],
  kaffee: [["menge", "Menge (Tassen)", "number"]],
  alkohol: [["menge", "Menge (Gläser)", "number"]],
  blutdruck: [["sys", "Systolisch", "number"], ["dia", "Diastolisch", "number"], ["puls", "Puls", "number"]],
  notiz: [],
};
const TITEL = { einnahme: "Einnahme", wach: "Wachphase", nebenwirkung: "Nebenwirkung", wirkung: "Fokus",
  mahlzeit: "Mahlzeit", kaffee: "Kaffee", alkohol: "Alkohol", blutdruck: "Blutdruck und Puls", notiz: "Notiz" };

const zuEingabe = (iso) => { const d = new Date(iso); return isoLokal(d).slice(0, 16); };
const ausEingabe = (v) => isoLokal(new Date(v));

function oeffneDialog(typ, alt = null, vorgabe = {}) {
  const daten = { ...(alt ? alt.daten : {}), ...vorgabe };
  $("dtitel").textContent = (alt ? "Ändern: " : "Neu: ") + TITEL[typ];
  const f = $("dfelder");
  f.replaceChildren();
  f.append(el("label", { for: "f_zeit" }, "Zeitpunkt"),
    el("input", { id: "f_zeit", type: "datetime-local", required: true,
      value: zuEingabe(alt ? alt.zeit : isoLokal(new Date())) }));
  for (const [k, label, art, optionen] of FELDER[typ]) {
    f.append(el("label", { for: `f_${k}` }, label));
    let wert = daten[k];
    if (art === "datetime-local" && wert) wert = zuEingabe(wert);
    if (art === "select") {
      f.append(el("select", { id: `f_${k}` }, optionen.map(([v, t]) =>
        el("option", { value: v, selected: String(wert ?? "") === v }, t))));
    } else {
      // Zahlen als Text mit Dezimaltastatur: type=number verschluckt in Safari "0,5"
      f.append(el("input", { id: `f_${k}`, type: art === "number" ? "text" : art, value: wert ?? "",
        inputmode: art === "number" ? "decimal" : undefined }));
    }
  }
  f.append(el("label", { for: "f_notiz" }, typ === "notiz" ? "Text" : "Notiz"),
    el("textarea", { id: "f_notiz", rows: 2 }, alt ? alt.notiz || "" : ""));
  $("dloeschen").hidden = !alt;
  $("dloeschen").onclick = async () => { $("dialog").close(); await storniere(alt); };
  $("dabbrechen").onclick = () => $("dialog").close();
  $("formular").onsubmit = async (ereignis) => {
    ereignis.preventDefault();
    try {
      const { daten: neu, zeit, notiz } = leseDialog(typ, alt);
      $("dialog").close();
      await erfasse(typ, neu, { zeit, notiz, ersetzt: alt ? alt.id : null });
    } catch (fehler) { alert(fehler.message); }
  };
  $("dialog").showModal();
}

// Unveränderte Zeiten behalten ihren ursprünglichen Text samt Zeitzone. Sonst
// würde z. B. 02:30+01:00 aus der doppelten Stunde der Winterzeit-Umstellung
// beim Ändern still zu 02:30+02:00.
const zeitAus = (eingabe, alt) => (alt && eingabe === zuEingabe(alt) ? alt : ausEingabe(eingabe));

function leseDialog(typ, altEv = null) {
  const w = (k) => { const e = $(`f_${k}`); return e ? e.value.trim() : ""; };
  const zahl = (k, lo, hi, ganz = true) => {
    if (w(k) === "") return undefined;
    const n = Number(w(k).replace(",", "."));
    if (!Number.isFinite(n) || n < lo || n > hi || (ganz && !Number.isInteger(n))) throw new Error(`${k}: ${lo} bis ${hi}`);
    return n;
  };
  if (!w("zeit")) throw new Error("Zeitpunkt fehlt");
  const zeit = zeitAus(w("zeit"), altEv?.zeit);
  if (Date.parse(zeit) > Date.now() + 10 * 60e3) throw new Error("Zeitpunkt liegt in der Zukunft");
  const notiz = w("notiz");
  const d = {};
  switch (typ) {
    case "einnahme": {
      if (!w("mittel")) throw new Error("Mittel fehlt");
      d.mittel = w("mittel");
      const m = (zustand.konfig?.mittel || []).find((x) => x.name.toLowerCase() === d.mittel.toLowerCase());
      if (m) d.supplement_id = m.supplement_id;
      if (w("dosis")) d.dosis = w("dosis");
      d.status = w("status");
      if (w("grund")) d.grund = w("grund");
      break;
    }
    case "wach":
      if (w("bis")) {
        d.bis = zeitAus(w("bis"), altEv?.daten?.bis);
        if (Date.parse(d.bis) < Date.parse(zeit)) throw new Error("„bis“ liegt vor dem Beginn");
      }
      if (w("grund")) d.grund = w("grund");
      break;
    case "nebenwirkung":
      d.art = w("art");
      if (d.art === "freitext") { if (!w("text")) throw new Error("Text fehlt"); d.text = w("text"); }
      if (w("staerke")) d.staerke = Number(w("staerke"));
      break;
    case "wirkung": d.fokus = Number(w("fokus")); break;
    case "mahlzeit": d.richtig = w("richtig") === "true"; if (w("art")) d.art = w("art"); break;
    case "kaffee": case "alkohol": { const m = zahl("menge", 0.01, 50, false); if (m !== undefined) d.menge = m; break; }
    case "blutdruck": {
      const sys = zahl("sys", 60, 260), dia = zahl("dia", 30, 160), puls = zahl("puls", 25, 220);
      if ((sys === undefined) !== (dia === undefined)) throw new Error("Systolisch und diastolisch zusammen angeben");
      if (sys !== undefined) { if (dia >= sys) throw new Error("Diastolisch muss kleiner sein"); d.sys = sys; d.dia = dia; }
      if (puls !== undefined) d.puls = puls;
      if (sys === undefined && puls === undefined) throw new Error("Blutdruck oder Puls angeben");
      break;
    }
    case "notiz": if (!notiz) throw new Error("Text fehlt"); break;
  }
  return { daten: d, zeit, notiz };
}

// ------------------------------------------------------------ Zeichnen

function zeichne() {
  // Mittel aus dem aktiven Protokoll
  const mittel = zustand.konfig?.mittel || [];
  $("mittel").replaceChildren(...mittel.map((m) => el("button", {
    type: "button", class: "knopf",
    onclick: () => erfasse("einnahme", { mittel: m.name, supplement_id: m.supplement_id, status: "genommen" }),
  }, m.name, el("small", {}, [m.zeitpunkt, m.detail].filter(Boolean).join(" · ")))));
  $("mittelleer").hidden = mittel.length > 0;

  // Wachphase
  const offen = offeneWachphase(zustand.alle);
  $("wachbanner").hidden = !offen;
  $("wach").hidden = !!offen;
  if (offen) $("wachtext").textContent = `Wach seit ${uhr(offen.zeit)}`;

  // Tag
  const tag = zustand.tag || heute();
  $("tagtitel").textContent = tag === heute() ? "Heute" : new Date(`${tag}T12:00:00`).toLocaleDateString("de-CH",
    { weekday: "long", day: "numeric", month: "long" });
  $("tagvor").disabled = tag >= heute();
  const liste = wirksam(zustand.alle).filter((e) => e.zeit.slice(0, 10) === tag);
  $("liste").replaceChildren(...(liste.length ? liste.map((e) => el("li", {
    onclick: () => oeffneDialog(e.typ, e),
  }, el("span", { class: "zeit" }, uhr(e.zeit)), el("span", {}, beschreibe(e)),
  e._sync ? null : el("span", { class: "offen" }, "nicht hochgeladen"))) : [el("li", { class: "leise" }, "Nichts erfasst.")]));

  // Abgleich
  const nOffen = zustand.alle.filter((e) => !e._sync).length;
  const s = $("sync");
  if (zustand.laeuft) { s.textContent = "Lädt hoch…"; s.className = "chip"; }
  else if (zustand.sync.art === "fehler") { s.textContent = `${nOffen} offen · Fehler`; s.className = "chip fehler"; }
  else if (zustand.sync.art === "anmelden") { s.textContent = `${nOffen} offen · anmelden`; s.className = "chip offen"; }
  else if (nOffen) { s.textContent = `${nOffen} offen`; s.className = "chip offen"; }
  else { s.textContent = zustand.sync.text ? `✓ ${zustand.sync.text}` : "✓"; s.className = "chip ok"; }
  $("hinweis").hidden = !zustand.sync.meldung;
  $("hinweis").textContent = zustand.sync.meldung || "";
  $("geraetknopf").textContent = `Gerät: ${zustand.geraet}`;
}

// ------------------------------------------------------------ Abgleich

let baldUhr = null;
function bald_abgleichen() { clearTimeout(baldUhr); baldUhr = setTimeout(abgleichen, 1500); }

async function abgleichen() {
  if (zustand.laeuft) return;
  if (!eingerichtet()) {
    zustand.sync = { art: "anmelden", meldung: "Hochladen ist noch nicht eingerichtet. Erfassen geht trotzdem, alles bleibt auf dem Gerät." };
    return zeichne();
  }
  if (!navigator.onLine) { zustand.sync = { art: "", meldung: "" }; return zeichne(); }
  zustand.laeuft = true;                     // Sperre vor dem ersten await
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
    // Aus dem Speicher neu lesen, aber nichts verlieren, was während des Abgleichs dazukam
    const gespeichert = await alleEreignisse();
    const ids = new Set(gespeichert.map((e) => e.id));
    zustand.alle = [...gespeichert, ...zustand.alle.filter((e) => !ids.has(e.id))];
    zustand.sync = { art: "ok", text: new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) };
    $("konto").textContent = "Abmelden";
  } catch (f) {
    // fetch wirft TypeError, wenn keine Verbindung besteht: kein Fehler, nur später.
    zustand.sync = f instanceof TypeError
      ? { art: "", meldung: "Keine Verbindung zu OneDrive. Alles bleibt auf dem Gerät und wird später hochgeladen." }
      : { art: "fehler", meldung: f.message };
  } finally {
    zustand.laeuft = false;
    zeichne();
  }
}

// ------------------------------------------------------------ Start

function knoepfeVerdrahten() {
  $("fokus").replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
    el("button", { type: "button", class: "knopf zahl", onclick: () => erfasse("wirkung", { fokus: n }) }, n)));
  $("neben").replaceChildren(
    ...NEBENWIRKUNGEN.map(([k, t]) => el("button", { type: "button", class: "knopf", onclick: () => erfasse("nebenwirkung", { art: k }) }, t)),
    el("button", { type: "button", class: "knopf neben", onclick: () => oeffneDialog("nebenwirkung", null, { art: "freitext" }) }, "Andere…"));
  const aktionen = {
    "mahlzeit": () => erfasse("mahlzeit", { richtig: true }),
    "snack": () => erfasse("mahlzeit", { richtig: false }),
    "kaffee": () => erfasse("kaffee", {}),
    "alkohol": () => erfasse("alkohol", { menge: 1 }),
    "blutdruck": () => oeffneDialog("blutdruck"),
    "notiz": () => oeffneDialog("notiz"),
    "anderes-mittel": () => oeffneDialog("einnahme", null, { status: "genommen" }),
  };
  document.querySelectorAll("[data-aktion]").forEach((b) => b.addEventListener("click", aktionen[b.dataset.aktion]));
  $("wach").onclick = () => erfasse("wach", {});
  $("wachende").onclick = async () => {
    const w = offeneWachphase(zustand.alle);
    if (w) await erfasse("wach", { ...w.daten, bis: isoLokal(new Date()) }, { zeit: w.zeit, ersetzt: w.id, notiz: w.notiz });
  };
  // Im echten Betrieb verlässt anmelden() die Seite (Microsoft); im Testmodus
  // kehrt es zurück, dann gleich abgleichen.
  const anmeldenUndAbgleichen = () => anmelden().then(abgleichen).catch((f) => alert(f.message));
  $("sync").onclick = () => (zustand.sync.art === "anmelden" && eingerichtet() ? anmeldenUndAbgleichen() : abgleichen());
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
  const schiebe = (delta) => {
    const d = new Date(`${zustand.tag || heute()}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const t = isoLokal(d).slice(0, 10);
    zustand.tag = t >= heute() ? null : t;
    zeichne();
  };
  $("export").onclick = async () => {
    // Sicherung der nicht hochgeladenen Einträge im Logformat (eine Zeile je Ereignis).
    // Ablage am Laptop in erfassung/eingang/sicherung/ (eigener Unterordner, damit
    // sie keine Tagesdatei überschreibt); der Import überspringt schon bekannte ids.
    const offen = zustand.alle.filter((e) => !e._sync);
    if (!offen.length) return alert("Nichts offen, alles ist hochgeladen.");
    const name = `${heute()}_${zustand.geraet}.jsonl`;
    const datei = new File([offen.map(zeile).join("\n") + "\n"], name, { type: "application/x-ndjson" });
    if (navigator.canShare?.({ files: [datei] })) {
      try { await navigator.share({ files: [datei], title: name }); } catch { /* abgebrochen */ }
    } else {
      const a = el("a", { href: URL.createObjectURL(datei), download: name });
      document.body.append(a); a.click(); a.remove();
    }
  };
  $("tagzurueck").onclick = () => schiebe(-1);
  $("tagvor").onclick = () => schiebe(1);
}

async function start() {
  $("version").textContent = `v${VERSION}${TESTMODUS ? " · Testmodus" : ""}`;
  knoepfeVerdrahten();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  zustand.geraet = (await lies("geraet")) || "iphone";
  zustand.konfig = (await lies("konfig")) || null;
  zustand.alle = await alleEreignisse();
  try { await rueckkehrVerarbeiten(); } catch (f) { zustand.sync = { art: "fehler", meldung: f.message }; }
  $("konto").textContent = (await lies("token")) ? "Abmelden" : "Anmelden";
  zeichne();
  abgleichen();
  addEventListener("online", abgleichen);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { zeichne(); abgleichen(); } });
}

start();
