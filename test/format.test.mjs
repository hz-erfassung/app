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

test("vorbelegung: im Fenster jetzt, danach Planzeit, davor jetzt", () => {
  const [hcMorgen] = tagesplan(konfig);
  assert.deepEqual(vorbelegung(hcMorgen, new Date(2030, 0, 10, 8, 0)), { art: "jetzt" });
  const v = vorbelegung(hcMorgen, new Date(2030, 0, 10, 21, 0));
  assert.equal(v.art, "plan");
  assert.equal(v.zeit.getHours() * 60 + v.zeit.getMinutes(), 7 * 60 + 15);
  assert.deepEqual(vorbelegung(hcMorgen, new Date(2030, 0, 10, 4, 0)), { art: "jetzt" });
});

test("letzteDosis je Gabe (Morgen 10 mg beeinflusst Mittag nicht)", () => {
  const m = ev("EEEEEEEE3", "2030-01-10T07:20:00+01:00", { typ: "einnahme",
    daten: { mittel: "Medikament A", supplement_id: 501, gabe: "morgens", status: "genommen", dosis_mg: 10 } });
  assert.equal(letzteDosis("Medikament A", 501, [m], "mittags"), null);
  assert.equal(letzteDosis("Medikament A", 501, [m], "morgens"), 10);
});
