"""Draw a horizon profile JSON (from horizon.py) as a PNG."""

import argparse
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from horizon import top_peaks  # noqa: E402

FG = "#d8d8d8"
DIM = "#777777"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("json_in")
    ap.add_argument("png_out")
    ap.add_argument("--title", default="")
    args = ap.parse_args()

    with open(args.json_in) as f:
        d = json.load(f)
    el = np.array(d["elevation_deg"])
    dist = np.array(d["distance_km"])
    az = np.arange(len(el)) * 360.0 / len(el)

    plt.rcParams.update({
        "figure.facecolor": "#000", "axes.facecolor": "#000", "savefig.facecolor": "#000",
        "text.color": FG, "axes.labelcolor": FG, "axes.edgecolor": DIM,
        "xtick.color": DIM, "ytick.color": DIM, "font.size": 10,
    })
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(11, 6.2), sharex=True,
        gridspec_kw={"height_ratios": [3, 2], "hspace": 0.12})

    lo = min(-3.0, np.floor(el.min() - 0.3))
    hi = max(2.3, np.ceil(el.max() + 0.3))
    ax1.fill_between(az, el, lo, color="#2a2a2a", linewidth=0)
    ax1.plot(az, el, color=FG, linewidth=1.0)
    ax1.axhline(0, color=DIM, linewidth=0.6)
    for level in (1.5, 2.0):
        ax1.axhline(level, color=DIM, linewidth=0.6, linestyle=(0, (4, 4)))
        ax1.text(359, level + 0.05, f"{level} deg", ha="right", va="bottom", color=DIM, fontsize=8)
    for k, i in enumerate(top_peaks(az, el), start=1):
        ax1.plot([az[i]], [el[i]], marker="o", markersize=4, color=FG)
        ax1.annotate(f"{k}: az {az[i]:.1f}, {el[i]:+.2f} deg, {dist[i]:.2f} km",
                     (az[i], el[i]), xytext=(az[i] + (6 if az[i] < 180 else -6), 1.15 - 0.33 * (k - 1)),
                     ha="left" if az[i] < 180 else "right", fontsize=8, color=FG,
                     arrowprops={"arrowstyle": "-", "color": DIM, "linewidth": 0.6})
    ax1.set_ylim(lo, hi)
    ax1.set_ylabel("Horizon height (deg)")

    ax2.plot(az, dist, color=FG, linewidth=1.0)
    ax2.set_yscale("log")
    ax2.axhline(d["near_limit_km"], color=DIM, linewidth=0.6, linestyle=(0, (4, 4)))
    ax2.text(359, d["near_limit_km"] * 1.08, "80 m DEM below this line, 240 m DEM above",
             ha="right", va="bottom", color=DIM, fontsize=8)
    ax2.set_ylim(0.03, 400)
    ax2.set_ylabel("Distance of the terrain\nthat sets the horizon (km)")
    ax2.set_xlim(0, 360)
    ax2.set_xticks(range(0, 361, 45))
    ax2.set_xticklabels(["N 0", "45", "E 90", "135", "S 180", "225", "W 270", "315", "N 360"])
    ax2.set_xlabel("Direction (azimuth, clockwise from north)")

    for ax in (ax1, ax2):
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)

    title = args.title or f"Terrain horizon at {d['lat']}, {d['lon']} E"
    fig.suptitle(
        f"{title}\nobserver {d['observer_height_m']:g} m above ground, ground {d['site_height_m']:.0f} m "
        f"above the 1737.4 km sphere, terrain out to {d['far_limit_km']:.0f} km",
        x=0.07, y=0.98, ha="left", fontsize=10)

    # vertical exaggeration of the top panel: degrees up versus degrees across
    fig.canvas.draw()
    box = ax1.get_window_extent()
    exaggeration = (box.height / (hi - lo)) / (box.width / 360.0)
    ax1.text(0.005, 0.03, f"vertical scale stretched {exaggeration:.0f}x",
             transform=ax1.transAxes, color=DIM, fontsize=8)

    fig.savefig(args.png_out, dpi=150, bbox_inches="tight")
    print(f"wrote {args.png_out}, vertical exaggeration {exaggeration:.0f}x")


if __name__ == "__main__":
    main()
