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
