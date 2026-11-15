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
- Stage 4 (3D hero) is built and tested (15 Nov) on branch claude/relaxed-darwin-2ebtlf.
  It is NOT on main (the live page) yet: frame time on a real graphics card could not be
  measured in the build environment (software rendering only, about 500 ms per picture, so
  the fallback to 2D is what the tests see). Put it on main when the user says so.
- Sizes now: first screen 302 kB on disk, 242 kB compressed; real sky 46 kB / 40 kB;
  3D view 790 kB / 373 kB (three.js bundle 558 kB / 141 kB, terrain file 231 kB, not
  compressible); everything 1138 kB / 654 kB.

### In progress (15 Nov): 3D rework after the user looked at the preview on a phone
The user's verdict: the eye-level 3D looks like the old panorama and the terrain is blurry.
Do NOT publish to main; stay on the preview branch; the user approves after looking.
Commit and push after every small step. If a question comes up, pick the most sensible option
and write the choice here instead of stopping. Tasks, tick them here as they are done:
- [ ] 1. Blur: find the cause and say it; draw at device pixel ratio (max 2), antialias on;
      show the same moment before and after.
- [ ] 2. Main 3D view from above ("View: from above"): camera circles the landing point about
      35 degrees up; drag turns, pinch or wheel zooms; default distance where the mesh looks
      best (5 to 8 km; enlarge the middle grid if needed and report the size). Landing point
      marked; Sun and Earth directions as thin arrows on the ground, north marked separately.
      Same mesh, Lommel-Seeliger and cast shadows; shadows move with the cursor. No vertical stretch.
- [ ] 3. Eye level stays as second choice ("stand on the surface"), horizon at about 40 % of the
      canvas height so the sky does not fill the screen.
- [ ] 4. Page opens with the 2D panorama; view choice: panorama / from above / stand on the
      surface. All numbers come from the 2D pipeline also in 3D; README Limits: the 3D mesh is
      coarser, with the largest measured difference of the Sun's share.
- [ ] 5. Touch: horizontal drag and two fingers on the canvas move the 3D view; vertical
      scrolling still moves the page (time).
Done when: phone and desktop screenshots from above at a moment with visible shadows; the frame
time rule holds; this note is up to date.
Choices made without asking:
(none yet)

### Stage 4 as built (the approved plan, with what came out)
- Terrain: pipeline/build_3d.py writes data/sites/[id]_3d.bin (40 km at 160 m, 4 km at 20 m,
  500 m at 5 m, plus the far-only skyline for panels at 2 m and 5 m). Curvature is in the
  positions (115.1 m at 20 km). Needs the terrain files in data/raw/.
- Scene: web3d/terrain.js (mesh, no drawing) and web3d/view3d.js (three.js). After a change
  run "npm install" once and "npm run build3d"; the bundle site/js/view3d.bundle.js is committed.
  Camera at panel height, 70 degrees wide, shifted lens (level sight line 60 % down), no vertical
  stretch. Far strip cut along the far-only skyline. Stars as points, Earth as a sphere, Sun as
  a true-size disc with the flare. The #3A3A3A skyline line is drawn in 3D too.
- Light: Lommel-Seeliger shader; shadow maps in two steps (40 km, and 1 km around the camera),
  each from the lower and upper half of the Sun's disc; far mountains dim all near ground by
  the Sun's share above the far-only skyline (approximation, in README Limits).
- Loading: after the real sky. No WebGL2, median of the first five pictures over 40 ms, or a
  lost context: 3D is removed and the panorama stays. "?3d=off" and "?3d=force" override, for
  checks. Draws only when the cursor, the direction or the plan changes.
- Check: tests/test_view3d.py writes data/view3d_check.txt. In view / not in view agrees in
  6 of 6 moments; shares differ where the mesh is coarser (0.624 against 0.591 for a crest
  0.4 km away, 0.586 against 0.469 for a ridge 9 km away). Reported as is.
- Nothing from the cut order was cut.
- Open: a wider 5 m grid (the horizon at 2 m is often set 300 to 450 m away, outside the
  500 m grid) would bring 3D closer to the 2D numbers at about 60 kB more per site; soft
  shadows finer than two halves of the disc; the far strip is soft.
