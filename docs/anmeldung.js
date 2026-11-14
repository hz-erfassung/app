// Anmeldung bei Microsoft (Entra): Autorisierungscode
// mit PKCE, ohne fremde Bibliothek. Token liegen nur in IndexedDB des Geräts.
// Ein Refresh-Token einer SPA gilt bei Entra höchstens 24 Stunden; danach
// meldet man sich neu an. Das Erfassen geht ohne Anmeldung immer.

import { KONFIG, TESTMODUS, redirectUri } from "./konfig.js";
import { lies, schreibe, loesche } from "./speicher.js";

const AUTH = () => `https://login.microsoftonline.com/${KONFIG.tenant}/oauth2/v2.0`;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const zufall = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const eingerichtet = () => TESTMODUS || !!KONFIG.clientId;

export async function anmelden() {
  if (TESTMODUS) { await schreibe("token", { access: "test", exp: Date.now() + 3600e3 }); return; }
  if (!KONFIG.clientId) throw new Error("Anmeldung noch nicht eingerichtet (clientId fehlt).");
  const verifier = zufall(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = zufall(16);
  sessionStorage.setItem("pkce", JSON.stringify({ verifier, state }));
  const u = new URL(`${AUTH()}/authorize`);
  u.search = new URLSearchParams({
    client_id: KONFIG.clientId, response_type: "code", redirect_uri: redirectUri(),
    response_mode: "query", scope: KONFIG.scope, state,
    code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  location.assign(u.href);
}

async function tokenAnfrage(params) {
  const r = await fetch(`${AUTH()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: KONFIG.clientId, scope: KONFIG.scope, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Anmeldung fehlgeschlagen (${r.status})`);
  const t = { access: j.access_token, refresh: j.refresh_token || null, exp: Date.now() + (j.expires_in || 0) * 1000 };
  await schreibe("token", t);
  return t;
}

/** Nach der Rückkehr von Microsoft: Code gegen Token tauschen. */
export async function rueckkehrVerarbeiten() {
  const q = new URLSearchParams(location.search);
  if (!q.has("code") && !q.has("error")) return false;
  const gemerkt = JSON.parse(sessionStorage.getItem("pkce") || "null");
  sessionStorage.removeItem("pkce");
  history.replaceState(null, "", location.pathname);   // Code nicht in der Adresse lassen
  if (q.has("error")) throw new Error(q.get("error_description") || q.get("error"));
  if (!gemerkt || gemerkt.state !== q.get("state")) throw new Error("Anmeldung abgelehnt: state passt nicht.");
  await tokenAnfrage({ grant_type: "authorization_code", code: q.get("code"),
    redirect_uri: redirectUri(), code_verifier: gemerkt.verifier });
  return true;
}

/** Gültiges Access-Token oder null (dann: neu anmelden). */
export async function token() {
  const t = await lies("token");
  if (!t) return null;
  if (t.access && t.exp - 60e3 > Date.now()) return t.access;
  if (TESTMODUS || !t.refresh) return null;
  try {
    return (await tokenAnfrage({ grant_type: "refresh_token", refresh_token: t.refresh })).access;
  } catch (f) {
    // Netzfehler (TypeError): Token behalten, später erneut. Nur eine echte
    // Ablehnung von Microsoft (abgelaufen, widerrufen) löscht es.
    if (f instanceof TypeError) throw f;
    await loesche("token");
    return null;
  }
}

export const abmelden = () => loesche("token");
