# CLAUDE.md

Reply to the user in Turkish. Code, comments, UI text and README are in English.
Explain Git and deployment steps in plain words; the user is new to them.

## Project
NASA Space Apps 2026, challenge "Lunar Landing Site Navigator". Solo entry.
One screen that compares two landing plans (A and B) for the lunar south pole:
where the Sun and Earth sit relative to the real terrain horizon, and what that
means for power and direct-to-Earth contact.
Everything in this repo is created during the event (14-15 Nov 2026). Cite every source.

## Working rules
- No paid services. No secrets in the repo.
- Never say something works without evidence: test output, a number or a picture.
- Commit after every working step; the message says what changed and why.
- If a result disagrees with a reference, report it as it is. Never tune to match.
- Before adding a feature, check the cut order in the plan.

## Method
- Frame MOON_ME, east-positive longitude, sphere R = 1737.4 km, no refraction.
- Azimuth clockwise from north (N 0, E 90).
- DEM: the site's 5 m tile (PGDA product 78) for the first 5 km, LDEM_80S_80MPP_ADJ.TIF to
  100 km, LDEM_60S_240MPP_ADJ.TIF beyond, to 300 km. Where the tile has no data the 80 m map
  is used. Read georeferencing from the GeoTIFF; do not assume axis conventions.
- Horizon: 720 azimuths. March along great circles in 3D, project to sample the DEM.
  tan(e) = (rt cos d - ro) / (rt sin d). Negative horizons are valid.
  Store the distance of the terrain point that sets each horizon value.
- Sky: one Horizons table, COMMAND='301', CENTER='500@399', QUANTITIES='14,15,19,20'.
  Azimuth and elevation at any site come from the sub-solar and sub-Earth points;
  include parallax for Earth.
- Known rows, site 222.69 E, -89.45, 2026-11-14 00:00 UT:
  Sun az 263.9129 el 1.4984; Earth az 136.0519 el -5.0442.
- Power proxy: visible fraction of the Sun's disc. Earth link: centre above terrain.
- The Python pipeline is the reference. Browser code must match it on test vectors.

## Design
- Direction: a photograph from the lunar surface beside an Apollo flight plan. The space
  feeling comes from what is really seen there, not from decoration.
- Page and sky pure black (#000). No blue sky, haze or gradient sky.
- Hero: the view from the plan A site, at least half the screen height, sticky. Real skyline
  with a #3A3A3A edge line. The plan sentence sits at its lower left like a photo caption.
  Plan B's view is smaller, beside or below.
- Sun: white disc (#FFF8E7) with a small hard-edged flare. Earth: drawn with its true phase.
  Terrain: lit and shadowed from the Sun's direction at the cursor time; shadow is black.
- Stars only inside the views, at their real positions.
- Colour code: power = Sun gold #F5D68A, link = Earth blue #6AA9FF, none = black. No red or green.
- Time runs down the page like a flight plan. Hours are written "MET 096:00" (hours since
  landing). Scrolling moves the cursor; arrow keys move it 1 hour, with Shift 1 day.
- Type: Jost (OFL), weights 400 and 500 only, latin subset, self-hosted woff2. No serif.
  Tabular numbers.
- No cards, shadows, blur, glow, badges, emoji, decorative icons, all-caps labels.
- A plan is edited as a sentence, not in a settings panel.
- Plain words first; jargon only in brackets.
- Vertical exaggeration is always labelled. Motion only answers the user.
- No framework. 2D in Canvas or SVG. 3D (three.js) loads in the background after the 2D view
  is up, and the page stays 2D on slow devices. Works at 360 px.
- On narrow screens one line sits over the sky (name and stretch); every other note is behind
  the "i" button or under the view.
- Size: the first screen (2D view and flight plan) stays near 300 kB compressed (gzip).
  No hard limit on the total; 3D and the real sky load in the background. Always report
  compressed and uncompressed sizes. Weak devices must not stutter (see the speed check:
  60 ms median over 30 pictures, set by the user on 15 Nov; it was 40 ms).

## Do not build
Decorative spinning globe, link budget, battery sizing, thermal model, chat assistant,
more than seven terrain sites.

## Before submission
- The first-stage jury is in Türkiye, where vercel.app does not open without a VPN.
  When the repo is made public, add GitHub Pages as a second address:
  restore .github/workflows/pages.yml from commit fef2a9d, have the user set
  Settings > Pages > Source to "GitHub Actions", check that the github.io address
  opens without a VPN, then put both addresses in the README.

## Status
- Stages 1 to 3 of 4 are done and published (14 Nov): the approved screen; 5 m near terrain,
  Lommel-Seeliger ground and Earthlight; real stars (checked against Horizons to 0.008 deg),
  Blue Marble Earth, "Seen by the eye / a camera".
- Fixes after stage 3 (14 Nov): narrow screens show one line over the sky, notes behind "i";
  on roomy desktops the flight plan is wider and the mission summary sits lower left; the
  near ground is smooth (hit point between march steps, finer normal steps, soft terminator).
- Six fixes before stage 4 (14 Nov, published): arrow keys belong to a focused box, Escape or
  a click on the view hands them back to time (hint under the strip); the date is typed text,
  24-hour "YYYY-MM-DD HH:MM" UTC; directions sit on a black band under the view; changeable
  words have an underline, a small triangle and a hover highlight, with one tip under the
  sentence; the mission summary sits under the verdict, before the flight plan; an overview
  strip of the whole stay sits at the bottom of the fixed block (tap to jump, drag to run time),
  and a tap on an hour of the flight plan jumps there.
- One cursor: the scroll position of the flight plan is the only clock. Keys, strip, taps and
  drags all scroll the page (scrollToMet in app.js); never keep a second time variable.
  tests/check_controls.cjs checks this on a desktop and on a touch phone.
- Stage 4 (3D) is published (15 Nov, main = the preview branch). The page opens with the
  panorama; "View:" offers "from above" and "stand on the surface" when the speed check passes.
- FEATURES ARE FROZEN (user, 15 Nov). No new features. Only fixes of what exists, the README
  and the submission steps below. Cut and written under README "Next steps": the date strip
  and the check against PGDA's illumination products.
- Last changes before the freeze (15 Nov):
  - Speed check: after the load event, the data and an idle moment; 2 pictures not counted,
    then 30 timed, one per screen refresh; 3D stays at a median of 60 ms or less; stopped
    after 5 if all five take over 180 ms. Reason: the old check (5 pictures right after the
    data, 40 ms) switched 3D off on the user's PC although 3D ran smoothly there with
    "?3d=force". Not yet confirmed by the user that the new check keeps 3D on that PC.
  - In the 3D views on a wide screen the plan sentence sits under the picture; on a phone it
    stays on it over a 68 % black box. The sentence's words are refitted when the view changes.
- README is final: what it does, live link, three moments to try, how it works, validation
  numbers (Horizons, stars, browser against Python, Barker 2021 with Case C, 3D checks),
  Limits, Next steps, run steps, sites, sources.
- Demo moments (also in README "Three moments to try"), found with the Python reference over
  all sites, every landing day 2027-2029 and every plan B choice; days 10, panels 2 m:
  1. Mons Mouton plateau, 2028-04-06 00:00, B at another site: Site 7; MET 025 (Sun 3.1 deg).
  2. Mons Mouton plateau, 2028-11-30 00:00, B one week later; MET 077 (Sun 3.85 deg).
  3. Malapert massif, 2027-01-26 00:00, B one week later; MET 006 (Sun 3.2 deg), a trade-off.
  Each has a link in README (address parameters, see below).
- After the freeze, at the user's request (15 Nov):
  - The date box: always "YYYY-MM-DD HH:MM" UTC; typing changes digits only (Backspace and
    Delete set a digit to 0, the marks stay, the caret steps over them); a click or tap opens
    our own calendar (days, hours 00-23, minutes :00 :15 :30 :45, Done), never the browser's
    local format. On a touch screen no keyboard comes up. Code: site/js/datefield.js.
  - Address parameters ?site=&date=&days=&panels=&b=&met=&view= open a plan, a moment and a
    view (b: day | week | lunarday | a site id; view: panorama | above | surface; the 3D views
    only where the speed check passes). Values that do not fit are ignored.
  - Checked in tests/check_controls.cjs (desktop and touch phone) and tests/run_plan_js.mjs.
    Screenshots: docs/date_calendar_desktop.png, docs/date_calendar_phone.png.
- Before the presentation (15 Nov): the product is named "LunaricB" (page title, the name over
  the view, README title; the repository keeps its name). Field widths are measured with the
  page's own type settings (tabular figures; the canvas measure cut "2028-11-30 00:0").
  Arrow names from above are placed at the arrow ends and move aside when they would overlap.
- Sizes now: first screen 330 kB on disk, 251 kB compressed (datefield.js added); real sky
  46 kB / 40 kB; 3D 1002 kB / 584 kB (three.js bundle 560 kB / 142 kB, terrain file 442 kB,
  not compressible).
- Screenshots: docs/final_above_desktop.png, docs/final_above_phone.png,
  docs/final_panorama_desktop.png, docs/final_surface_desktop.png.
- Still to do before submission: the GitHub Pages second address (see "Before submission").

### 3D rework of 15 Nov (done and published)
The user's verdict on the first 3D: it looked like the old panorama and the terrain was blurry.
- Blur: the cause was the data (160 m cells beyond 2 km, a strip painted at one degree per
  column beyond 20 km), not the pixel ratio (2x) or antialiasing (on). Two grids were added
  (80 m to 8 km, 960 m to 120 km). Before and after: docs/blur_before_after_phone.png.
- "from above": camera circles the landing point 35 degrees up, 6 km away to start (0.8 to
  20 km); drag turns, wheel or two fingers zoom; landing point, Sun and Earth arrows on the
  ground (dashed when behind terrain), north. Faces north to start, so shadows are seen to move.
- "stand on the surface": level sight line 40 % down the picture.
- Touch: sideways turns, two fingers zoom, up and down still scrolls the page.
- The middle (20 m) grid was not enlarged; the far terrain is real mesh now, so the check
  moment "cut by terrain 42 km away" reads 0.728 in 3D against 0.614 (reported as is).

### Stage 4 as built
- Terrain: pipeline/build_3d.py writes data/sites/[id]_3d.bin: five grids (5 m to 250 m, 20 m
  to 2 km, 80 m to 8 km, 160 m to 20 km, 960 m to 120 km) and two far-only skylines (beyond
  19.2 km for dimming the shadowed ground, beyond 120 km for the strip), for panels at 2 m
  and 5 m. Curvature is in the positions (115.1 m at 20 km). Needs the terrain files in data/raw/.
- Scene: web3d/terrain.js (mesh, no drawing) and web3d/view3d.js (three.js). After a change run
  "npm install" once and "npm run build3d"; the bundle site/js/view3d.bundle.js is committed.
  The ground is drawn far first (outer grid and strip, own depth range), then the shadowed mesh.
- Light: Lommel-Seeliger shader; shadow maps in two steps (inside the wide grid, and 1 km
  around the site), each from the lower and upper half of the Sun's disc, depth compared on
  the receiver's plane. Outer grid: lit, no shadows.
- Loading: after the real sky, then the speed check (see Status). No WebGL2, a median over
  60 ms, or a lost context: 3D is not offered and the panorama stays. "?3d=off" and
  "?3d=force" override, for checks. Draws only when something changes.
- Check: tests/test_view3d.py writes data/view3d_check.txt (shadows against rays, the Sun's
  share 3D beside 2D, in view / not in view 6 of 6). tests/shadow_reference.py is the ray reference.
