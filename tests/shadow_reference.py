"""Reference for the cast shadows of the 3D view: straight rays through the
height grids of a [site]_3d.bin file, exact on the sphere.

A ground point is lit by one half of the light's disc if the straight line
from the point toward the middle of that half meets no terrain inside the
40 km grid. Each half counts for half, as in the 3D view (web3d/view3d.js).
The surface between grid points is two flat triangles per cell, split along
the south-west / north-east diagonal, as in the mesh.

Not the same as the mesh in one place: where the grids meet, the mesh leans
the finer grid's heights toward the coarser one (1.6 to 1.92 km and 200 to
240 m from the site); this reference uses the stored heights everywhere.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))

import build_3d  # noqa: E402
from horizon import R_M  # noqa: E402

HALF_DISC = 0.4244          # centre of half a disc, in radii from its middle: 4 / (3 pi)


def surfaces(path):
    """The three grids of a file: positions (east, north, up) and heights."""
    header, grids, _ = build_3d.read_3d(path)
    out = {"site_height": float(grids["near"][50, 50])}
    for name, half, step, _ in build_3d.LEVELS:
        n = grids[name].shape[0]
        axis = (np.arange(n) - (n - 1) / 2) * step
        x, y = np.meshgrid(axis, axis)
        out[name] = {"position": build_3d.local_position(x, y, grids[name], out["site_height"]),
                     "step": step, "height": grids[name]}
    return out


def height_at(grid, x, y):
    """Height of the mesh x m east and y m north of the site."""
    z, step = grid["height"], grid["step"]
    size = z.shape[0]
    c = (size - 1) / 2
    fx = np.clip(x / step + c, 0, size - 1.001)
    fy = np.clip(y / step + c, 0, size - 1.001)
    i, j = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - i, fy - j
    z00, z10, z01, z11 = z[j, i], z[j, i + 1], z[j + 1, i], z[j + 1, i + 1]
    return np.where(tx >= ty, z00 + tx * (z10 - z00) + ty * (z11 - z10), z00 + ty * (z01 - z00) + tx * (z11 - z01))


def lit_share(surf, points, az_deg, el_deg, diameter_deg):
    """Share of the light (0, 0.5 or 1) reaching each point; points (..., 3) are east, north, up."""
    total = np.zeros(points.shape[:-1])
    h0 = surf["site_height"]
    # steps along the ray: fine near the point, coarser farther out (m)
    steps = np.concatenate([np.arange(10, 400, 5.0), np.arange(400, 3000, 20.0), np.arange(3000, 45000, 80.0)])
    for sign in (-1, 1):
        el, az = np.radians(el_deg + sign * HALF_DISC * diameter_deg / 2), np.radians(az_deg)
        toward = np.array([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)])
        free = np.ones(points.shape[:-1], bool)
        for s in steps:
            q = points + s * toward
            # back to the grid: distance along the sphere, and height above it
            flat, radial = np.hypot(q[..., 0], q[..., 1]), q[..., 2] + R_M + h0
            d = np.arctan2(flat, radial) * R_M
            scale = np.where(flat > 0, d / np.where(flat > 0, flat, 1.0), 1.0)
            x, y = q[..., 0] * scale, q[..., 1] * scale
            ray_height = np.hypot(flat, radial) - R_M
            fine = (np.abs(x) < 240) & (np.abs(y) < 240)
            mid = (np.abs(x) < 1900) & (np.abs(y) < 1900)
            inside = (np.abs(x) < 20000) & (np.abs(y) < 20000)
            ground = np.where(fine, height_at(surf["near"], x, y),
                              np.where(mid, height_at(surf["middle"], x, y), height_at(surf["wide"], x, y)))
            free &= ~(inside & (ground > ray_height))
        total += free
    return total / 2
