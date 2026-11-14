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
- Budget: first load (2D view visible) under 300 kB; full experience under 800 kB;
  each site file under 100 kB.

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
- Stage 1 of 4 done (14 Nov): the approved screen. Sticky view from the site, plan sentences,
  flight plan where scrolling is the clock, countdowns, verdict, mission summary.
- Stage 2 of 4 done (14 Nov): first 5 km of every site from its 5 m tile; ground lit by the
  Lommel-Seeliger law from [id]_view.bin (which way the ground faces); Earthlight when the Sun
  is down. Barker comparison rerun, numbers identical. First load 273 kB (sky.bin now keeps the
  Sun's distance once a day). Not done: shadows cast by other hills (planned for the 3D view).
- Stage 3 of 4 done (14 Nov): real stars (Yale BSC5, magnitude 5.5 and brighter, IAU Moon
  orientation, checked against Horizons to 0.008 deg), Earth as the Blue Marble picture with
  true phase and rotation, "Seen by the eye / a camera". These load after the first view.
  First load 278 kB, with the real sky 323 kB.
- Next: stage 4 (3D hero). Before any code: write the approach in five points and wait for
  the user's approval.
