// Checks of site/js/plan.js on small hand-made inputs, and earthPhase on
// cases given on stdin (compared with pipeline/sky.py by tests/test_plan.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gaps, changes, untilChange, countdownText, formatMet, formatUtc, parseUtc, planB, siteFile, verdict } from "../site/js/plan.js";
import { earthPhase } from "../site/js/sky.js";
import { lommelSeeliger } from "../site/js/scene.js";
import { edit, toPattern, snap } from "../site/js/datefield.js";

const flags = [1, 1, 0, 0, 0, 1, 0, 1, 1, 1];
assert.deepEqual(gaps(flags, 10), [{ start: 2, hours: 3 }, { start: 6, hours: 1 }]);
assert.deepEqual(gaps([0, 0, 1, 0], 4), [{ start: 0, hours: 2 }, { start: 3, hours: 1 }]);
assert.deepEqual(changes(flags, 10), [{ hour: 2, on: false }, { hour: 5, on: true }, { hour: 6, on: false }, { hour: 7, on: true }]);
assert.deepEqual(untilChange(flags, 10, 0), { now: true, hours: 2 });
assert.deepEqual(untilChange(flags, 10, 3), { now: false, hours: 2 });
assert.deepEqual(untilChange(flags, 10, 7), { now: true, hours: null });

const run = { n: 10, sunUp: flags, link: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
assert.deepEqual(countdownText(run, 0), { sun: "Sunset in 2 h", earth: "Earth stays hidden" });
assert.deepEqual(countdownText(run, 2), { sun: "Sunrise in 3 h", earth: "Earth stays hidden" });
assert.deepEqual(countdownText(run, 8), { sun: "Sun stays up", earth: "Earth stays hidden" });

assert.equal(formatMet(0), "MET 000:00");
assert.equal(formatMet(96), "MET 096:00");
assert.equal(formatMet(1440), "MET 1440:00");
assert.equal(formatUtc(Date.parse("2027-03-05T07:00:00Z")), "2027-03-05 07:00 UTC");

// the landing time as typed: 24-hour UTC, marks between the numbers optional
const t0 = Date.parse("2027-03-01T00:00:00Z");
assert.equal(parseUtc("2027-03-01 00:00"), t0);
assert.equal(parseUtc(" 2027-03-01T00:00 UTC "), t0);
assert.equal(parseUtc("2027-03-01"), t0);
assert.equal(parseUtc("20270301"), t0);
assert.equal(parseUtc("202703011830"), t0 + 18.5 * 3600000);
assert.equal(parseUtc("2027-3-1 7"), t0 + 7 * 3600000);
assert.equal(parseUtc("2027.03.01 23:59"), t0 + (23 * 60 + 59) * 60000);
for (const wrong of ["", "tomorrow", "01/03/2027", "2027-02-30 00:00", "2027-13-01", "2027-03-01 24:00",
                     "2027-03-01 12:60", "2027-03", "2027-03-01 1 pm", "27-03-01 00:00"]) {
  assert.ok(Number.isNaN(parseUtc(wrong)), wrong);
}
assert.equal(formatUtc(parseUtc("202703011830")), "2027-03-01 18:30 UTC");

// the landing time box: digits change, the marks between them stay, the caret steps over them
const V = "2027-03-01 00:00";
assert.deepEqual(edit(V, 5, 5, "deleteContentBackward"), { value: "2020-03-01 00:00", caret: 3 });   // Backspace after "-"
assert.deepEqual(edit(V, 4, 4, "deleteContentForward"), { value: "2027-03-01 00:00", caret: 6 });    // Delete before "-": the month's 0
assert.deepEqual(edit(V, 6, 6, "deleteContentForward"), { value: "2027-00-01 00:00", caret: 8 });
assert.deepEqual(edit(V, 3, 3, "insertText", "8"), { value: "2028-03-01 00:00", caret: 5 });        // over the "-" after the year
assert.deepEqual(edit(V, 8, 8, "insertText", "15"), { value: "2027-03-15 00:00", caret: 11 });
assert.deepEqual(edit(V, 10, 10, "insertText", "6"), { value: "2027-03-01 60:00", caret: 12 });     // the space is skipped
assert.equal(edit(V, 2, 2, "insertText", "x"), null);                                                // letters do nothing
assert.deepEqual(edit(V, 4, 4, "insertText", "-"), { value: V, caret: 5 });                         // typing the mark steps over it
assert.deepEqual(edit(V, 0, 16, "deleteContentBackward"), { value: "0000-00-00 00:00", caret: 0 });  // all selected: digits to 0
assert.deepEqual(edit(V, 0, 16, "insertText", "2028-11-30 06:00"), { value: "2028-11-30 06:00", caret: 16 });
assert.deepEqual(edit(V, 0, 16, "insertFromPaste", "202811300600"), { value: "2028-11-30 06:00", caret: 16 });
assert.deepEqual(edit(V, 0, 0, "insertText", "2028113006"), { value: "2028-11-30 06:00", caret: 16 });   // read as a whole date
assert.deepEqual(edit(V, 0, 0, "insertText", "2028"), { value: "2028-03-01 00:00", caret: 5 });
assert.deepEqual(edit(V, 15, 15, "insertText", "59"), { value: "2027-03-01 00:05", caret: 16 });   // only the first fits: stops at the end
assert.equal(edit(V, 0, 0, "deleteContentBackward"), null);
assert.equal(edit(V, 16, 16, "deleteContentForward"), null);
assert.equal(edit(V, 3, 3, "historyUndo"), null);
for (let p = 0; p <= 16; p++) assert.ok(![4, 7, 10, 13].includes(snap(p)));                          // never right before a mark
assert.equal(toPattern("2027-03-01T07:30Z"), "2027-03-01 07:30");
assert.equal(toPattern("05/04/2027 1 pm"), "0504-20-27 10:00");

const a = { site: "site01", landingMs: Date.parse("2027-03-01T00:00:00Z"), days: 10, height: 2 };
assert.equal(planB(a, "week").landingMs - a.landingMs, 168 * 3600000);
assert.equal(planB(a, "lunarday").landingMs - a.landingMs, 708 * 3600000);
assert.equal(planB(a, "site", "malapert").site, "malapert");
assert.equal(planB(a, "day").site, "site01");
assert.equal(siteFile(a), "site01.json");
assert.equal(siteFile({ ...a, height: 5 }), "site01_5m.json");

const m = (fraction, earth) => ({ meanSunFraction: fraction, earthHours: earth });
assert.equal(verdict(m(0.80, 100), m(0.81, 102), 240),
  "The two plans are nearly the same: about 80 % sunlight and 100 hours of Earth contact.");
assert.equal(verdict(m(0.80, 100), m(0.81, 150), 240),
  "Sunlight is about the same; plan B has 50 more hours of Earth contact.");
assert.equal(verdict(m(0.80, 100), m(0.60, 102), 240),
  "Earth contact is about the same; plan A gets more sunlight (80 % against 60 %).");
assert.equal(verdict(m(0.60, 100), m(0.80, 150), 240),
  "Plan B is better on both counts: 20 points more sunlight and 50 more hours of Earth contact.");
assert.equal(verdict(m(0.80, 100), m(0.60, 150), 240),
  "A trade-off: plan A gets more sunlight (80 % against 60 %), plan B more Earth contact (150 h against 100 h).");

const input = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify({
  phase: input.phase.map((c) => { const p = earthPhase(...c); return [p.lit, p.towardSun]; }),
  shade: input.shade.map((c) => lommelSeeliger(...c)),
}));
