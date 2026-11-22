// node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { ulid, isoLokal, zusammenfuehren, wirksam, zeile, dateiPfad, offeneWachphase } from "../docs/format.js";

const ev = (id, erfasst, extra = {}) => ({ v: 1, id, geraet: "iphone", client: 1, zeit: erfasst, erfasst,
  typ: "kaffee", daten: {}, ersetzt: null, notiz: "", ...extra });

test("ulid passt zum Muster des Imports", () => {
  for (let i = 0; i < 50; i++) assert.match(ulid(), /^[A-Za-z0-9_-]{8,40}$/);
  assert.equal(ulid(0, new Uint8Array(16)).length, 26);
});

test("isoLokal hat Zeitzone und ist von Date.parse lesbar", () => {
  const d = new Date(2030, 0, 10, 7, 5, 9);
  const s = isoLokal(d);
  assert.match(s, /^2030-01-10T07:05:09[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(s), d.getTime());
});

test("zusammenfuehren: vorhandene Zeilen bleiben, neue hinten, keine Doppel", () => {
  const a = ev("AAAAAAAA1", "2030-01-10T08:00:00+01:00");
  const b = ev("BBBBBBBB1", "2030-01-10T09:00:00+01:00");
  const c = ev("CCCCCCCC1", "2030-01-10T07:00:00+01:00");
  const vorhanden = zeile(a) + "\n" + "{kaputt" ;           // ohne Schluss-Zeilenumbruch
  const r = zusammenfuehren(vorhanden, [b, a, c]);
  assert.equal(r.neu, 2);
  const zeilen = r.text.trimEnd().split("\n");
  assert.deepEqual(zeilen.slice(0, 2), [zeile(a), "{kaputt"]);
  assert.deepEqual(zeilen.slice(2).map((z) => JSON.parse(z).id), ["CCCCCCCC1", "BBBBBBBB1"]);
  assert.equal(zusammenfuehren(r.text, [a, b, c]).neu, 0);
  assert.ok(!("_sync" in JSON.parse(zeile({ ...a, _sync: 1 }))));
});

test("wirksam: Ersatz, Storno, mehrfacher Ersatz", () => {
  const a = ev("AAAAAAAA1", "2030-01-10T08:00:00+01:00");
  const b = ev("BBBBBBBB1", "2030-01-10T08:05:00+01:00", { ersetzt: a.id });
  const c = ev("CCCCCCCC1", "2030-01-10T08:10:00+01:00", { ersetzt: a.id });
  const s = ev("SSSSSSSS1", "2030-01-10T08:20:00+01:00", { typ: "storno", ersetzt: c.id });
  assert.deepEqual(wirksam([a, b, c]).map((e) => e.id), ["CCCCCCCC1"]);
  assert.deepEqual(wirksam([a, b, c, s]).map((e) => e.id), []);
  assert.deepEqual(wirksam([a, b]).map((e) => e.id), ["BBBBBBBB1"]);
});

test("dateiPfad nach Tag des Erfassens", () => {
  assert.equal(dateiPfad(ev("AAAAAAAA1", "2030-01-10T23:59:00+01:00", { zeit: "2030-01-09T22:00:00+01:00" })),
    "eingang/2030/2030-01-10_iphone.jsonl");
});

test("offene Wachphase nur ohne bis und jünger als 14 h", () => {
  const jetzt = new Date("2030-01-10T03:00:00+01:00");
  const w = ev("WWWWWWWW1", "2030-01-10T02:00:00+01:00", { typ: "wach" });
  assert.equal(offeneWachphase([w], jetzt).id, w.id);
  const zu = ev("WWWWWWWW2", "2030-01-10T02:30:00+01:00", { typ: "wach", zeit: w.zeit, ersetzt: w.id,
    daten: { bis: "2030-01-10T02:30:00+01:00" } });
  assert.equal(offeneWachphase([w, zu], jetzt), null);
  assert.equal(offeneWachphase([w], new Date("2030-01-10T17:00:00+01:00")), null);
});

// ---- 0.3: Tagesplan, Status, Vorbelegung
import { tagesplan, statusFuer, vorbelegung, letzteDosis, gehoertZu } from "../docs/format.js";

const konfig = {
  mittel: [
    { supplement_id: 502, name: "Supplement D", zeitpunkt: "morgens", detail: "zum Frühstück" },
    { supplement_id: 501, name: "Medikament A", zeitpunkt: "morgens" },
    { supplement_id: 503, name: "Supplement C", zeitpunkt: "abends" },
  ],
  medikamente: [
    { name: "Medikament A", supplement_id: 501, dosis_optionen: [5, 10], gaben: [
      { gabe: "morgens", label: "Morgens", von: "05:30", bis: "10:30", plan: "07:15", dosis_mg: 10 },
      { gabe: "mittags", label: "Mittags", von: "11:00", bis: "15:00", plan: "12:30", dosis_mg: 5 }] },
    { name: "Medikament B", supplement_id: null, dosis_optionen: [10, 20, 30], gaben: [] },
  ],
};

test("tagesplan: Medikamente je Gabe, Supplemente je Tageszeit, keine Doppel", () => {
  const p = tagesplan(konfig);
  assert.deepEqual(p.map((z) => [z.name, z.block, z.gabe]), [
    ["Medikament A", "morgens", "morgens"], ["Medikament A", "mittags", "mittags"],
    ["Medikament B", "weitere", null], ["Supplement D", "morgens", "morgens"], ["Supplement C", "abends", "abends"]]);
  assert.equal(p[0].medikament, true);
  assert.equal(p[3].medikament, false);
  assert.deepEqual(tagesplan(null), []);
});

test("statusFuer: passende Gabe am Tag, letzte Fassung zählt", () => {
  const [hcMorgen, hcMittag] = tagesplan(konfig);
  const e1 = ev("EEEEEEEE1", "2030-01-10T07:20:00+01:00", { typ: "einnahme",
    daten: { mittel: "Medikament A", supplement_id: 501, gabe: "morgens", status: "genommen", dosis_mg: 10 } });
  assert.equal(statusFuer(hcMorgen, [e1], "2030-01-10").id, e1.id);
  assert.equal(statusFuer(hcMittag, [e1], "2030-01-10"), null);
  assert.equal(statusFuer(hcMorgen, [e1], "2030-01-11"), null);
  const alt = ev("EEEEEEEE2", "2030-01-10T07:20:00+01:00", { typ: "einnahme", daten: { mittel: "Medikament A", status: "genommen" } });
  assert.equal(gehoertZu(alt, hcMorgen), false);                 // ohne gabe (0.2) nicht zugeordnet
  assert.equal(letzteDosis("Medikament A", 501, [e1], "morgens"), 10);
});

test("vorbelegung Supplement: im Fenster jetzt, danach Planzeit, davor jetzt", () => {
  const supp = tagesplan(konfig).find((z) => z.name === "Supplement D");
  assert.deepEqual(vorbelegung(supp, new Date(2030, 0, 10, 8, 0)), { art: "jetzt" });
  const v = vorbelegung(supp, new Date(2030, 0, 10, 21, 0));
  assert.equal(v.art, "plan");
  assert.equal(v.zeit.getHours() * 60 + v.zeit.getMinutes(), 7 * 60 + 30);
  assert.deepEqual(vorbelegung(supp, new Date(2030, 0, 10, 4, 0)), { art: "jetzt" });
});

test("vorbelegung Medikament: immer jetzt, auch nach dem Fenster (Gremium #1)", () => {
  const [medMorgen] = tagesplan(konfig);
  assert.deepEqual(vorbelegung(medMorgen, new Date(2030, 0, 10, 9, 42)), { art: "jetzt" });
  assert.deepEqual(vorbelegung(medMorgen, new Date(2030, 0, 10, 21, 0)), { art: "jetzt" });
});

test("letzteDosis je Gabe (Morgen 10 mg beeinflusst Mittag nicht)", () => {
  const m = ev("EEEEEEEE3", "2030-01-10T07:20:00+01:00", { typ: "einnahme",
    daten: { mittel: "Medikament A", supplement_id: 501, gabe: "morgens", status: "genommen", dosis_mg: 10 } });
  assert.equal(letzteDosis("Medikament A", 501, [m], "mittags"), null);
  assert.equal(letzteDosis("Medikament A", 501, [m], "morgens"), 10);
});

// ---- 0.3.1: Gremium 14.11.2026
import { dosisVorschlag, dosisAusserhalb, rueckgaengig, rueckstand } from "../docs/format.js";
import { readFileSync } from "node:fs";

test("dosisVorschlag: bei Abweichung Plan/letzte keine Vorwahl (Gremium #4)", () => {
  assert.equal(dosisVorschlag({ plan: 10, letzte: 10 }).wert, 10);
  assert.equal(dosisVorschlag({ plan: 10, letzte: null }).wert, 10);
  // ohne Plan-Dosis (Medikament ohne Gaben): nie still die letzte Dosis (Prüfer 14.11.)
  assert.equal(dosisVorschlag({ plan: null, letzte: 5 }).wert, null);
  assert.equal(dosisVorschlag({ plan: null, letzte: 5 }).letzte, 5);
  assert.equal(dosisVorschlag({}).wert, null);
  const steigerung = dosisVorschlag({ plan: 20, letzte: 10 });
  assert.equal(steigerung.wert, null);
  assert.equal(steigerung.abweichung, true);
  assert.deepEqual([steigerung.plan, steigerung.letzte], [20, 10]);
  assert.equal(dosisVorschlag({ alt: 15, plan: 20, letzte: 10 }).wert, 15);   // Ändern: bisherige Dosis
});

test("dosisAusserhalb: Optionen und Plan der Gabe gelten als vorgesehen", () => {
  const [medMorgen] = tagesplan(konfig);                 // Optionen 5, 10; Plan 10
  assert.equal(dosisAusserhalb(10, medMorgen), false);
  assert.equal(dosisAusserhalb(5, medMorgen), false);
  assert.equal(dosisAusserhalb(15, medMorgen), true);
  assert.equal(dosisAusserhalb(15, { dosis_optionen: [], dosis_mg: null }), false);  // nichts bekannt: nicht fragen
});

test("Rückgängig nach Ändern: A ändern zu B, Rückgängig, A wirksam (Gremium #2)", () => {
  const a = ev("AAAAAAAA2", "2030-01-10T08:00:00+01:00", { typ: "einnahme", zeit: "2030-01-10T07:55:00+01:00",
    daten: { mittel: "Medikament A", gabe: "morgens", status: "genommen", dosis_mg: 10 }, notiz: "zum Frühstück" });
  const b = ev("BBBBBBBB2", "2030-01-10T08:05:00+01:00", { typ: "einnahme", zeit: "2030-01-10T07:55:00+01:00",
    ersetzt: a.id, daten: { mittel: "Medikament A", gabe: "morgens", status: "genommen", dosis_mg: 20 } });
  const r = rueckgaengig(b, [a, b]);
  assert.equal(r.typ, "einnahme");
  assert.equal(r.ersetzt, b.id);
  const c = ev("CCCCCCCC2", "2030-01-10T08:06:00+01:00", { ...r });
  const w = wirksam([a, b, c]);
  assert.deepEqual(w.map((e) => e.id), [c.id]);
  assert.equal(w[0].daten.dosis_mg, 10);
  assert.equal(w[0].zeit, a.zeit);
  assert.equal(w[0].notiz, "zum Frühstück");
  r.daten.dosis_mg = 99;                                  // Kopie, nicht dasselbe Objekt
  assert.equal(a.daten.dosis_mg, 10);
});

test("Rückgängig beim ersten Erfassen storniert", () => {
  const a = ev("AAAAAAAA3", "2030-01-10T08:00:00+01:00");
  const r = rueckgaengig(a, [a]);
  assert.deepEqual([r.typ, r.ersetzt], ["storno", a.id]);
  const s = ev("SSSSSSSS3", "2030-01-10T08:01:00+01:00", { ...r });
  assert.deepEqual(wirksam([a, s]), []);
});

test("Wach beenden und Rückgängig: Wachphase läuft wieder", () => {
  const jetzt = new Date("2030-01-10T03:00:00+01:00");
  const w = ev("WWWWWWWW3", "2030-01-10T02:00:00+01:00", { typ: "wach" });
  const zu = ev("WWWWWWWW4", "2030-01-10T02:30:00+01:00", { typ: "wach", zeit: w.zeit, ersetzt: w.id,
    daten: { bis: "2030-01-10T02:30:00+01:00" } });
  const zurueck = ev("WWWWWWWW5", "2030-01-10T02:31:00+01:00", { ...rueckgaengig(zu, [w, zu]) });
  const offen = offeneWachphase([w, zu, zurueck], jetzt);
  assert.equal(offen.id, zurueck.id);
  assert.equal(offen.daten.bis, undefined);
});

test("Rückgängig ohne Vorfassung auf dem Gerät: Fehler statt Storno", () => {
  const b = ev("BBBBBBBB6", "2030-01-10T08:05:00+01:00", { ersetzt: "FEHLT00001" });
  assert.throws(() => rueckgaengig(b, [b]), /Vorfassung/);
});

test("rueckstand: Alarm ab 24 h nach dem ältesten nicht hochgeladenen Eintrag (Gremium #5)", () => {
  const jetzt = new Date("2030-01-11T09:00:00+01:00");
  const alt = { ...ev("AAAAAAAA7", "2030-01-10T08:00:00+01:00"), _sync: 0 };
  const neu = { ...ev("BBBBBBBB7", "2030-01-11T08:00:00+01:00"), _sync: 0 };
  const hoch = { ...ev("CCCCCCCC7", "2030-01-09T08:00:00+01:00"), _sync: 1 };
  assert.equal(rueckstand([hoch], jetzt), null);
  assert.equal(rueckstand([neu, hoch], jetzt).alarm, false);
  const r = rueckstand([alt, neu, hoch], jetzt);
  assert.deepEqual([r.anzahl, r.alarm, Math.round(r.stunden)], [2, true, 25]);
});

test("Versionen gleich: app.js, sw.js, package.json (Gremium #15)", () => {
  const lies = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");
  const app = lies("../docs/app.js").match(/const VERSION = "([^"]+)"/)[1];
  const sw = lies("../docs/sw.js").match(/const STAND = "hanna-([^"]+)"/)[1];
  const pkg = JSON.parse(lies("../package.json")).version;
  assert.deepEqual([sw, pkg], [app, app]);
});

// ------------------------------------------------------------ 0.4 Rückblick (22.11.2026)
import { logTag, tagPlus, rueckblickFuer, rueckblickKarten, offeneMedikamente, pruefeRueckblick, beschreibe } from "../docs/format.js";

const rb = (id, erfasst, typ, daten, extra = {}) => ({ v: 1, id, geraet: "iphone", client: 1, zeit: erfasst, erfasst,
  typ, daten, ersetzt: null, notiz: "", ...extra });

test("logTag: Tagesgrenze 04:00 (gleich wie logtag im Import)", () => {
  assert.equal(logTag(new Date(2030, 2, 6, 1, 30)), "2030-03-05");
  assert.equal(logTag(new Date(2030, 2, 6, 3, 59)), "2030-03-05");
  assert.equal(logTag(new Date(2030, 2, 6, 4, 0)), "2030-03-06");
  assert.equal(tagPlus("2030-03-01", -1), "2030-02-28");
});

test("rueckblickFuer: zuletzt erfasster gilt", () => {
  const a = rb("RNAAAAAA1", "2030-03-05T07:00:00+01:00", "rueckblick_nacht", { nacht: "2030-03-05", schlaf: 2 });
  const b = rb("RNBBBBBB1", "2030-03-05T09:00:00+01:00", "rueckblick_nacht", { nacht: "2030-03-05", schlaf: 4 });
  assert.equal(rueckblickFuer("nacht", "2030-03-05", [b, a]).id, b.id);
  assert.equal(rueckblickFuer("tag", "2030-03-05", [a, b]), null);
});

test("rueckblickKarten: morgens Nacht plus Nachtrag gestern, abends Tag plus fehlende Nacht", () => {
  const m = rueckblickKarten([], new Date(2030, 2, 6, 7, 40));
  assert.deepEqual(m.map((k) => [k.art, k.tag, k.haupt]), [["nacht", "2030-03-06", true], ["tag", "2030-03-05", false]]);
  const gestern = rb("RTAAAAAA1", "2030-03-05T21:00:00+01:00", "rueckblick_tag", { tag: "2030-03-05", energie: 3, fokus: 3, stimmung: 3 });
  assert.equal(rueckblickKarten([gestern], new Date(2030, 2, 6, 7, 40)).length, 1);
  const a = rueckblickKarten([], new Date(2030, 2, 6, 21, 15));
  assert.deepEqual(a.map((k) => [k.art, k.tag, k.haupt]), [["tag", "2030-03-06", true], ["nacht", "2030-03-06", false]]);
  // 01:30 nachts: Abendkarte für den Vortag
  assert.equal(rueckblickKarten([], new Date(2030, 2, 7, 1, 30))[0].tag, "2030-03-06");
});

test("offeneMedikamente: offene Gaben nach Fensterbeginn, Bedarf ohne Eintrag, nie Supplemente", () => {
  const plan = tagesplan(konfig);
  const tag = "2030-01-10";
  const morgens = rb("HCMORGEN1", "2030-01-10T07:10:00+01:00", "einnahme",
    { mittel: "Medikament A", supplement_id: 501, gabe: "morgens", status: "genommen", dosis_mg: 10 });
  const was = (l) => l.map((o) => [o.zeile.name, o.zeile.gabe, o.art]);
  assert.deepEqual(was(offeneMedikamente(plan, [morgens], tag, new Date(2030, 0, 10, 21, 0))),
    [["Medikament A", "mittags", "gabe"], ["Medikament B", null, "bedarf"]]);
  // vor Beginn des Mittagsfensters ist die Mittagsgabe nicht offen
  assert.deepEqual(was(offeneMedikamente(plan, [morgens], tag, new Date(2030, 0, 10, 9, 0))),
    [["Medikament B", null, "bedarf"]]);
  // nach Mitternacht für den Vortag: alle Gaben vorbei, auch ohne Morgengabe
  assert.deepEqual(was(offeneMedikamente(plan, [], tag, new Date(2030, 0, 11, 1, 0))),
    [["Medikament A", "morgens", "gabe"], ["Medikament A", "mittags", "gabe"], ["Medikament B", null, "bedarf"]]);
  // Bedarf um 00:30 eingenommen zählt noch zum Vortag (Tagesgrenze 04:00)
  const spaet = rb("MBSPAET01", "2030-01-11T00:30:00+01:00", "einnahme", { mittel: "Medikament B", status: "genommen", dosis_mg: 10 });
  assert.ok(!offeneMedikamente(plan, [morgens, spaet], tag, new Date(2030, 0, 11, 0, 40)).some((o) => o.art === "bedarf"));
  // Bedarf mit "heute nicht" (ausgelassen) ist erledigt
  const nicht = rb("MBNICHT01", "2030-01-10T21:05:00+01:00", "einnahme",
    { mittel: "Medikament B", status: "ausgelassen", grund: "heute nicht" });
  assert.ok(!offeneMedikamente(plan, [morgens, nicht], tag, new Date(2030, 0, 10, 21, 10)).some((o) => o.art === "bedarf"));
});

test("pruefeRueckblick: Pflichtskalen, Bereiche, Merkmale", () => {
  const j6 = new Date(2030, 2, 6, 21, 0);
  assert.ok(pruefeRueckblick("nacht", { nacht: "2030-03-06", schlaf: 1, merkmale: ["geschwitzt"], alkohol: 0 }, j6));
  assert.throws(() => pruefeRueckblick("nacht", { nacht: "2030-03-06" }, j6), /Schlafgefühl/);
  assert.throws(() => pruefeRueckblick("nacht", { nacht: "2030-03-06", schlaf: 3, alkohol: 4 }, j6), /Gläser/);
  assert.throws(() => pruefeRueckblick("tag", { tag: "2030-03-06", energie: 3 }, j6), /Fokus, Stimmung/);
  assert.throws(() => pruefeRueckblick("tag", { tag: "2030-03-06", energie: 3, fokus: 3, stimmung: 3, merkmale: ["geschwitzt"] }, j6), /Merkmal/);
  assert.throws(() => pruefeRueckblick("tag", { tag: "2030-03-06", energie: 3, fokus: 3, stimmung: 3, keine_nebenwirkungen: false }, j6), /Nebenwirkungen/);
  // Bezugstag: nicht in der Zukunft, höchstens 7 Tage alt (gleich wie der Import)
  const j = new Date(2030, 2, 10, 9, 0);
  assert.ok(pruefeRueckblick("nacht", { nacht: "2030-03-03", schlaf: 3 }, j));
  assert.throws(() => pruefeRueckblick("nacht", { nacht: "2030-03-02", schlaf: 3 }, j), /7 Tage/);
  assert.throws(() => pruefeRueckblick("tag", { tag: "2030-03-11", energie: 3, fokus: 3, stimmung: 3 }, j), /Zukunft/);
  assert.ok(pruefeRueckblick("tag", { tag: "2030-03-09", energie: 3, fokus: 3, stimmung: 3 }, new Date(2030, 2, 10, 1, 0)));
  assert.throws(() => pruefeRueckblick("tag", { tag: "2030-03-10", energie: 3, fokus: 3, stimmung: 3 }, new Date(2030, 2, 10, 1, 0)), /Zukunft/);
  assert.equal(beschreibe(rb("RNCCCCCC1", "2030-03-06T07:00:00+01:00", "rueckblick_nacht",
    { nacht: "2030-03-06", schlaf: 1, merkmale: ["geschwitzt"], alkohol: 3 })),
    "Letzte Nacht: Schlafgefühl 1, geschwitzt, Alkohol 3+ Gl.");
});
