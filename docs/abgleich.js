// Abgleich mit OneDrive über Microsoft Graph. Je Tag und Gerät eine Datei,
// die nur dieses Gerät schreibt. Vor dem Schreiben wird der Stand im OneDrive
// gelesen und vereinigt; geschrieben wird nur mit passendem eTag.
//
// Lesen über @microsoft.graph.downloadUrl aus den Metadaten, nicht über
// :/content: das antwortet mit einer Weiterleitung, die im Browser nicht
// zuverlässig durchgeht. Die downloadUrl ist kurzlebig und braucht keinen
// Authorization-Kopf.

import { KONFIG } from "./konfig.js";
import { dateiPfad, zusammenfuehren } from "./format.js";
import { alleEreignisse, markiereSynchron, schreibe } from "./speicher.js";

const pfadUrl = (rel) => `${KONFIG.graph}/me/drive/root:/` +
  `${KONFIG.basis}/${rel}`.split("/").map(encodeURIComponent).join("/");

export class GraphFehler extends Error {
  constructor(status, text) { super(`OneDrive ${status}: ${text}`); this.status = status; }
}

async function graph(tok, url, init = {}) {
  const r = await fetch(url, { cache: "no-store", ...init,
    headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  if (!r.ok) throw new GraphFehler(r.status, (await r.text()).slice(0, 200));
  return r;
}

/** Metadaten oder null, wenn die Datei nicht existiert. Nur hier gilt 404 als "fehlt". */
async function metadaten(tok, rel) {
  try {
    return await (await graph(tok, pfadUrl(rel))).json();
  } catch (f) {
    if (f instanceof GraphFehler && f.status === 404) return null;
    throw f;
  }
}

async function inhalt(meta) {
  const url = meta["@microsoft.graph.downloadUrl"];
  if (!url) throw new GraphFehler(0, "keine downloadUrl in den Metadaten");
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new GraphFehler(r.status, "Inhalt nicht lesbar");
  return r;
}

async function ladeDatei(tok, rel) {
  const meta = await metadaten(tok, rel);
  if (!meta) return { text: "", etag: null };
  return { text: await (await inhalt(meta)).text(), etag: meta.eTag };
}

async function schreibeDatei(tok, rel, text, etag) {
  const url = pfadUrl(rel) + ":/content" + (etag ? "" : "?@microsoft.graph.conflictBehavior=fail");
  const headers = { "Content-Type": "text/plain; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  // Jeder Fehler, auch 404, wirft: _sync wird nur nach erfolgreichem Schreiben gesetzt.
  return graph(tok, url, { method: "PUT", headers, body: text });
}

/** Lädt offene Ereignisse hoch. Gibt die Zahl der hochgeladenen zurück. */
export async function hochladen(tok) {
  const offen = (await alleEreignisse()).filter((e) => !e._sync);
  const gruppen = new Map();
  for (const e of offen) {
    const p = dateiPfad(e);
    if (!gruppen.has(p)) gruppen.set(p, []);
    gruppen.get(p).push(e);
  }
  let zahl = 0;
  for (const [rel, liste] of gruppen) {
    for (let versuch = 1; ; versuch++) {
      const { text, etag } = await ladeDatei(tok, rel);
      const z = zusammenfuehren(text, liste);
      try {
        if (z.neu) await schreibeDatei(tok, rel, z.text, etag);
        zahl += z.neu;
        break;
      } catch (f) {
        // 409/412: Datei hat sich zwischen Lesen und Schreiben geändert. Neu lesen.
        if (!(f instanceof GraphFehler) || ![409, 412].includes(f.status) || versuch >= 3) throw f;
      }
    }
    await markiereSynchron(liste.map((e) => e.id));
  }
  return zahl;
}

/** Holt konfig.json (Mittel aus dem aktiven Protokoll), falls vorhanden. */
export async function ladeKonfig(tok) {
  const meta = await metadaten(tok, "konfig.json");
  if (!meta) return null;
  const k = await (await inhalt(meta)).json();
  if (k && k.v === 1 && Array.isArray(k.mittel)) { await schreibe("konfig", k); return k; }
  return null;
}
