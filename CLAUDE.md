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
- DEM: LDEM_80S_80MPP_ADJ.TIF to 100 km, LDEM_60S_240MPP_ADJ.TIF beyond, to 300 km.
  Read georeferencing from the GeoTIFF; do not assume axis conventions.
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
- Space theme: pure black page (#000) like the lunar sky; sparse, faint, static stars only inside sky bands.
- Two meaningful colours only: Sun yellow = power, Earth blue = link, black = none.
- No cards, shadows, gradients, glow, badges, emoji, decorative icons, all-caps labels.
- A plan is edited as a sentence, not in a settings panel.
- Plain words first; jargon only in brackets.
- Vertical exaggeration is always labelled. Motion only answers the user.
- No framework. 2D in Canvas or SVG. 3D (three.js) only in its own view, loaded on demand. Works at 360 px. Keyboard moves the cursor.
- Budget: first load under 300 kB; each site file under 100 kB; each 3D terrain file under 150 kB.

## Do not build
Decorative spinning globe, link budget, battery sizing, thermal model, chat assistant,
more than seven terrain sites.
