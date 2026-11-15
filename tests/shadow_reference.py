"""Reference for the cast shadows of the 3D view: straight rays through the
height grids of a [site]_3d.bin file, exact on the sphere.

A ground point is lit by one half of the light's disc if the straight line
from the point toward the middle of that half meets no terrain inside the
40 km grid. Each half counts for half, as in the 3D view (web3d/view3d.js).
The surface between grid points is two flat triangles per cell, split along
the south-west / north-east diagonal, as in the mesh.

Not the same as the mesh in one place: where the grids meet, the mesh leans
the finer grid's heights toward the coarser one (200 to 240 m, 1.6 to 1.92 km
and 7.04 to 7.68 km from the site); this reference uses the stored heights
everywhere. Shadows are cast and received inside the wide grid only (19.2 km).
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))

import build_3d  # noqa: E402
from horizon import R_M  # noqa: E402

HALF_DISC = 0.4244          # centre of half a disc, in radii from its middle: 4 / (3 pi)


# the mesh draws each grid out to this far from the site (m), finest first
REACH = [("near", 240.0), ("middle", 1920.0), ("local", 7680.0), ("wide", 19200.0)]


def surfaces(path):
    """The grids of a file: step and heights, and the height of the site."""
    header, grids, _ = build_3d.read_3d(path)
    out = {"site_height": float(grids["near"][50, 50])}
    for name, half, step, _, _ in build_3d.LEVELS:
        out[name] = {"step": step, "height": grids[name]}
    return out


def ground_height(surf, x, y):
    """Height of the mesh x m east and y m north of the site: the finest grid drawn there."""
    reach = np.maximum(np.abs(x), np.abs(y))
    h = height_at(surf["wide"], x, y)
    for name, half in reversed(REACH[:-1]):
        h = np.where(reach < half, height_at(surf[name], x, y), h)
    return h


def mesh_points(surf, size, half):
    """Places on the mesh under the pixel centres of a picture taken from straight
    above (size pixels square, half metres from the site to each edge): east, north, up."""
    axis = (np.arange(size) - (size - 1) / 2) * (2 * half / size)
    x, y = np.meshgrid(axis, axis)
    return build_3d.local_position(x, y, ground_height(surf, x, y), surf["site_height"]), np.maximum(np.abs(x), np.abs(y))


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
            inside = (np.abs(x) < 19200) & (np.abs(y) < 19200)
            free &= ~(inside & (ground_height(surf, x, y) > ray_height))
        total += free
    return total / 2
