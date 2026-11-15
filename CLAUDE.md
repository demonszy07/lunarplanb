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
  compressed and uncompressed sizes. Weak devices must not stutter (see the 40 ms rule).

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
- Stage 4 (3D) is built and tested on branch claude/relaxed-darwin-2ebtlf, reworked on 15 Nov
  after the user looked at the preview on a phone (see below). It is NOT on main (the live
  page): the user looks at the preview first and then says "yayınla". Speed on a real graphics
  card could still not be measured in the build environment (software rendering, about one
  second per picture, so the tests see the fallback to 2D unless "?3d=force" is used).
- Sizes now: first screen 312 kB on disk, 244 kB compressed; real sky 46 kB / 40 kB;
  3D 1002 kB / 584 kB (three.js bundle 560 kB / 142 kB, terrain file 442 kB, not
  compressible); everything 1359 kB / 868 kB.

### 3D rework of 15 Nov (done, on the preview branch, waiting for the user's look)
The user's verdict on the first 3D: it looked like the old panorama and the terrain was blurry.
- [x] 1. Blur. Cause: not the pixel ratio (canvas already 2x, capped at 2) and not antialiasing
      (already on, 4 samples), but the data: 160 m cells beyond 2 km and a strip painted at one
      degree per column beyond 20 km. Fix: two more grids (80 m to 8 km, 960 m to 120 km).
      Before and after of the same moment: docs/blur_before_after_phone.png.
- [x] 2. "from above": camera circles the landing point 35 degrees up, 6 km away to start
      (0.8 to 20 km); drag turns, wheel or two fingers zoom; landing point, Sun and Earth arrows
      on the ground (dashed when behind terrain), north. Same mesh, light and cast shadows.
- [x] 3. "stand on the surface": level sight line 40 % down the picture.
- [x] 4. The page opens with the panorama; View: panorama / from above / stand on the surface.
      All numbers come from 2D. README Limits names the coarser mesh and the largest measured
      difference of the Sun's share (0.117).
- [x] 5. Touch: sideways turns, two fingers zoom, up and down still scrolls the page (checked
      in tests/check_3d.cjs on a touch phone).
Screenshots: docs/above_desktop.png, docs/above_phone.png, docs/surface_desktop.png, docs/surface_phone.png.
Choices made without asking:
- The middle (20 m) grid was not enlarged. Instead an 80 m grid to 8 km and a 960 m grid to
  120 km were added: 442 kB per site, was 231 kB. From above, the ground then continues to
  the horizon instead of ending at 20 km.
- From above the camera faces north to start and does not follow the Sun, so the shadows are
  seen to move as the cursor moves.
- Over a 3D picture the words stand on black: a bar along the top with one line and the choice
  of view, the other notes behind "i" on every screen size, a black box behind the plan
  sentence. On narrow screens "View:" has a second line of its own (it is a control, not a note).
- The far terrain is real mesh now, so the check moment "cut by terrain 42 km away" reads
  0.728 in 3D against 0.614 in 2D (before, the strip was cut along the 2D skyline and agreed
  by construction). Reported as is.
- The 80 m grid is drawn to 7.68 km although heights are stored to 8 km (edges must sit on
  grid lines of both grids); the 9 km check ridge lies just outside it. Left as is, not moved
  to make the check look better.
Open: speed on real hardware; a wider 5 m grid; shadows finer than two halves of the disc.

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
- Loading: after the real sky. No WebGL2, median of the first five pictures (from above, new
  shadows each) over 40 ms, or a lost context: 3D is removed and the panorama stays.
  "?3d=off" and "?3d=force" override, for checks. Draws only when something changes.
- Check: tests/test_view3d.py writes data/view3d_check.txt (shadows against rays, the Sun's
  share 3D beside 2D, in view / not in view 6 of 6). tests/shadow_reference.py is the ray reference.
