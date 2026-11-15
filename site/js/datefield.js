// The landing time box. It always reads "YYYY-MM-DD HH:MM" (24-hour clock, UTC).
// Typing changes digits only: the marks between them cannot be deleted, and
// the caret steps over them. A click or tap opens a small calendar with the
// hours, so the date can also be picked; it never shows the browser's own
// local format.

import { parseUtc, formatUtc } from "./plan.js";

const LENGTH = 16;
const DIGITS = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15];          // where the digits are; the rest is "-", " ", ":"
const PATTERN = /^\d{4}-\d\d-\d\d \d\d:\d\d$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MINUTES = [0, 15, 30, 45];

// the first digit at or after p, or the end
const nextDigit = (p) => DIGITS.find((d) => d >= p) ?? LENGTH;
// the last digit before p, or -1
const prevDigit = (p) => { for (let k = DIGITS.length - 1; k >= 0; k--) if (DIGITS[k] < p) return DIGITS[k]; return -1; };
const put = (text, p, ch) => text.slice(0, p) + ch + text.slice(p + 1);
const pad = (n, w = 2) => String(n).padStart(w, "0");

// Any text into the fixed pattern: a date it can read, or its digits in order.
export function toPattern(text) {
  const ms = parseUtc(text);
  if (Number.isFinite(ms)) return formatUtc(ms).slice(0, LENGTH);
  if (PATTERN.test(text)) return text;
  const digits = (String(text).replace(/\D/g, "") + "000000000000").slice(0, 12);
  let out = "0000-00-00 00:00";
  DIGITS.forEach((p, k) => { out = put(out, p, digits[k]); });
  return out;
}

// What one edit does to the text. Returns { value, caret } or null for no change.
// inputType and data as in the browser's beforeinput event.
export function edit(value, start, end, inputType, data) {
  let v = PATTERN.test(value) ? value : toPattern(value);
  if (inputType.startsWith("insert")) {
    const text = data == null ? "" : String(data);
    // a whole date pasted or typed over everything
    if ((start === 0 && end >= LENGTH) || text.length >= 8) {
      const ms = parseUtc(text);
      if (Number.isFinite(ms)) return { value: formatUtc(ms).slice(0, LENGTH), caret: LENGTH };
    }
    const digits = text.replace(/\D/g, "");
    if (!digits) {
      // typing the mark that is already there just steps over it
      return text && text[0] === v[start] ? { value: v, caret: nextDigit(start + 1) } : null;
    }
    let p = start;
    for (const d of digits) {
      p = nextDigit(p);
      if (p >= LENGTH) break;
      v = put(v, p, d);
      p += 1;
    }
    return { value: v, caret: nextDigit(p) };
  }
  if (inputType.startsWith("delete")) {
    if (end > start) {                                  // a selection: its digits become 0
      for (const p of DIGITS) if (p >= start && p < end) v = put(v, p, "0");
      return { value: v, caret: nextDigit(start) };
    }
    if (inputType.endsWith("Backward")) {
      const p = prevDigit(start);
      return p < 0 ? null : { value: put(v, p, "0"), caret: p };
    }
    const p = nextDigit(start);
    return p >= LENGTH ? null : { value: put(v, p, "0"), caret: nextDigit(p + 1) };
  }
  return null;                                          // undo, redo and the like: nothing
}

// Where the caret may stand: before a digit, or at the end.
export const snap = (p) => nextDigit(p);

// Set the box up. apply() is called when the date should be taken (a pick in
// the calendar, Enter, or leaving the box); range() gives [first, last] in ms.
export function dateField(field, apply, range) {
  let shown = null, applied = field.value;

  const take = () => {
    if (field.value === applied) return;
    applied = field.value;
    apply();
  };
  const setValue = (value, caret) => {
    field.value = value;
    if (document.activeElement === field && caret !== undefined) field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  field.addEventListener("beforeinput", (event) => {
    event.preventDefault();
    const data = event.data ?? (event.dataTransfer ? event.dataTransfer.getData("text/plain") : null);
    const result = edit(field.value, field.selectionStart, field.selectionEnd, event.inputType, data);
    if (result) setValue(result.value, result.caret);
    if (shown) draw();
  });
  // left and right step from digit to digit
  field.addEventListener("keydown", (event) => {
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const at = field.selectionStart;
    const to = event.key === "ArrowLeft" ? Math.max(0, prevDigit(at)) : nextDigit(Math.min(LENGTH, at + 1));
    field.setSelectionRange(to, to);
  });
  const snapCaret = () => {
    if (field.selectionStart === field.selectionEnd) {
      const to = snap(field.selectionStart);
      if (to !== field.selectionStart) field.setSelectionRange(to, to);
    }
  };
  field.addEventListener("click", snapCaret);
  field.addEventListener("keyup", snapCaret);

  // ---- the calendar ----
  const pick = document.createElement("div");
  pick.className = "pick";
  pick.id = "date-pick";
  pick.hidden = true;
  pick.setAttribute("role", "dialog");
  pick.setAttribute("aria-label", "Landing date and hour, UTC");
  document.body.append(pick);
  const button = (text, label, onPick, pressed, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.disabled = !!disabled;
    b.addEventListener("click", () => { onPick(); });
    return b;
  };
  const current = () => {
    const ms = parseUtc(field.value);
    return Number.isFinite(ms) ? new Date(ms) : null;
  };
  // choose a new date and time: shown at once, and the plan follows
  const choose = (date) => {
    const [first, last] = range();
    const ms = Math.min(last, Math.max(first, date.getTime()));
    setValue(formatUtc(ms).slice(0, LENGTH));
    take();
    draw();
  };

  function draw() {
    const now = current() || new Date(range()[0]);
    if (!shown) shown = { year: now.getUTCFullYear(), month: now.getUTCMonth() };
    const [first, last] = range().map((ms) => new Date(ms));
    const { year, month } = shown;
    const head = document.createElement("div");
    head.className = "pick-head";
    const step = (k) => {
      const m = new Date(Date.UTC(year, month + k, 1));
      shown = { year: m.getUTCFullYear(), month: m.getUTCMonth() };
      draw();
    };
    const title = document.createElement("span");
    title.textContent = MONTHS[month] + " " + year;
    title.id = "pick-month";
    head.append(
      button("‹", "Previous month", () => step(-1), undefined, Date.UTC(year, month, 1) <= first.getTime()),
      title,
      button("›", "Next month", () => step(1), undefined, Date.UTC(year, month + 1, 1) > last.getTime()));

    const days = document.createElement("div");
    days.className = "pick-days";
    for (const name of WEEKDAYS) {
      const cell = document.createElement("span");
      cell.textContent = name;
      days.append(cell);
    }
    const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;      // Monday first
    for (let k = 0; k < lead; k++) days.append(document.createElement("span"));
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let day = 1; day <= count; day++) {
      const ms = Date.UTC(year, month, day);
      const on = now.getUTCFullYear() === year && now.getUTCMonth() === month && now.getUTCDate() === day;
      days.append(button(String(day), `${year}-${pad(month + 1)}-${pad(day)}`, () => {
        choose(new Date(Date.UTC(year, month, day, now.getUTCHours(), now.getUTCMinutes())));
      }, on, ms + 86400000 <= first.getTime() || ms > last.getTime()));
    }

    const label = (text) => { const p = document.createElement("p"); p.className = "pick-label"; p.textContent = text; return p; };
    const hours = document.createElement("div");
    hours.className = "pick-hours";
    for (let h = 0; h < 24; h++) {
      hours.append(button(pad(h), `${pad(h)} hours UTC`, () => {
        const d = current() || now;
        choose(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, d.getUTCMinutes())));
      }, now.getUTCHours() === h));
    }
    const minutes = document.createElement("div");
    minutes.className = "pick-minutes";
    for (const m of MINUTES) {
      minutes.append(button(":" + pad(m), `${pad(m)} minutes`, () => {
        const d = current() || now;
        choose(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), m)));
      }, now.getUTCMinutes() === m));
    }
    const foot = document.createElement("div");
    foot.className = "pick-foot";
    const note = document.createElement("span");
    note.textContent = "UTC, 24-hour clock";
    foot.append(note, button("Done", "Close the calendar", () => { close(); field.blur(); }));
    pick.replaceChildren(head, days, label("Hour"), hours, label("Minute"), minutes, foot);
  }

  function place() {
    const box = field.getBoundingClientRect(), width = pick.offsetWidth, height = pick.offsetHeight;
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
    let top = box.bottom + 6;
    if (top + height > window.innerHeight - 8) top = box.top - height - 6;            // no room below: above
    if (top < 8) top = Math.max(8, window.innerHeight - height - 8);                  // nor above: as low as it fits
    pick.style.left = left + "px";
    pick.style.top = top + "px";
  }
  function open() {
    if (!pick.hidden) return;
    shown = null;
    draw();
    pick.hidden = false;
    place();
    field.setAttribute("aria-expanded", "true");
  }
  function close() {
    pick.hidden = true;
    shown = null;
    field.setAttribute("aria-expanded", "false");
  }

  field.setAttribute("aria-haspopup", "dialog");
  field.setAttribute("aria-controls", pick.id);
  field.setAttribute("aria-expanded", "false");
  // on a touch screen the calendar is the way to change it: no keyboard comes up
  field.addEventListener("pointerdown", (event) => { field.inputMode = event.pointerType === "touch" ? "none" : "numeric"; });
  field.addEventListener("click", open);
  // a press inside the calendar keeps the focus in the box
  pick.addEventListener("mousedown", (event) => event.preventDefault());
  pick.addEventListener("keydown", (event) => {
    event.stopPropagation();                         // arrow keys here are not the time
    if (event.key === "Escape") { close(); field.focus(); }
  });
  // leaving the box and the calendar takes the date and closes the calendar
  const leave = () => setTimeout(() => {
    const now = document.activeElement;
    if (now === field || pick.contains(now)) return;
    close();
    take();
  }, 0);
  field.addEventListener("focusout", leave);
  pick.addEventListener("focusout", leave);
  field.addEventListener("keydown", (event) => { if (event.key === "Escape" || event.key === "Enter") close(); });
  window.addEventListener("resize", () => { if (!pick.hidden) place(); });

  return {
    close,
    // after the page set the value itself (a plan from the address, a step with the arrow keys)
    taken() { applied = field.value; if (!pick.hidden) draw(); },
  };
}
