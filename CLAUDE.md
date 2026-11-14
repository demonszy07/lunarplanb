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
- Sizes now: first screen 293 kB on disk, 239 kB compressed; with the real sky 338 kB / 279 kB.
- Not done: shadows cast by other hills.

### Stage 4, approved plan (start in a new session; do not re-ask for approval of these points)
1. Terrain data: one file per site, [id]_3d.bin, three nested height grids centred on the
   site: 40 x 40 km at 160 m (from the 80 m map); +-2 km at 20 m (averaged from the 5 m tile);
   +-250 m at 5 m (the tile itself). The Moon's curvature goes into the vertex positions
   (115 m drop at 20 km). About 230 kB per site.
2. Scene: perspective camera at panel height, horizontal field of view 70 degrees, no vertical
   stretch (say so on screen). Direction by dragging sideways or "Looking toward". Beyond
   20 km a backdrop strip built from the 300 km skyline; stars as points from the same
   catalogue; Earth as a sphere with the Blue Marble picture; Sun as a disc of true angular
   size with a hard-edged flare. "View: [eye level / panorama]" switches back to 2D.
   Plan B's view stays 2D.
3. Light and shadow: directional light from the true Sun direction; a custom shader with the
   Lommel-Seeliger law; shadow map in two steps (the whole 40 km, and the nearest 1 km).
   Mountains beyond 20 km are not in the mesh: use the site's far-horizon profile and darken
   all the near ground when the Sun is below it. That is an approximation; write it in Limits.
4. Loading and fallback: three.js bundled with only the parts used (esbuild; the bundle is
   committed so the host needs no build). It loads after the real sky. If the median frame
   time in the first frames is over 40 ms, or WebGL2 is missing, remove 3D and stay 2D.
   No continuous animation: draw only when the cursor or the view direction changes.
5. Check: five moments (Sun fully in view, fully hidden, partly cut by near terrain, partly
   cut by far terrain, just after sunset). For each, measure the visible share of the Sun's
   disc in 3D (pixels) and put it beside the 2D number. "In view / not in view" must agree in
   all five. The mesh (160 m, 20 m) and the 2D pipeline (80 m, 5 m) differ, so edge cases may
   disagree: report as is, never tune to match.
- Size decision for stage 4: no limit on the total. Keep the first screen near 300 kB
  compressed; measure and report compressed and uncompressed sizes of the three.js bundle,
  the terrain file and the total.
- Cut order if time is short: second shadow step, then Earth as a sphere (reuse the painted
  2D disc), then stars in 3D.
- At the end of stage 4: commit and push, one screenshot, update this note, add three.js
  (MIT) and anything else new to the README sources.
