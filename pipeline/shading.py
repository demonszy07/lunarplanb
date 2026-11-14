"""How bright a patch of lunar ground looks: the Lommel-Seeliger law.

    I = mu0 / (mu0 + mu)

mu0 is the cosine of the angle between the ground normal and the light, mu the
cosine of the angle between the normal and the line to the eye. It is the
standard first-order model for a dark, dusty surface such as the Moon
(named after Lommel and Seeliger; see Hapke, "Theory of Reflectance and
Emittance Spectroscopy", 2nd ed., Cambridge University Press 2012).

Earthlight: Glenar et al. (2019), "Earthshine as an illumination source at
the Moon", Icarus 321, 841-856, https://doi.org/10.1016/j.icarus.2018.12.025
(preprint https://arxiv.org/abs/1904.00236) give about 0.15 W/m2 on the Moon
from the full Earth, roughly half of it reflected sunlight and half thermal
emission, about 0.01 % of sunlight. The page states this as "roughly ten
thousand times fainter" and draws Earthlit ground with the exposure raised;
the drawn brightness is not that ratio.

This file is the reference for site/js/scene.js (lommelSeeliger).
"""

import numpy as np

EARTHSHINE_FULL_EARTH_W_M2 = 0.15      # Glenar et al. 2019, broadband, full Earth
SOLAR_CONSTANT_W_M2 = 1361.0
EARTHSHINE_TO_SUNLIGHT = EARTHSHINE_FULL_EARTH_W_M2 / SOLAR_CONSTANT_W_M2   # about 1.1e-4


def direction(az_deg, el_deg):
    """Unit vector (east, north, up) of a direction given by azimuth and elevation."""
    az, el = np.radians(az_deg), np.radians(el_deg)
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=-1)


def lommel_seeliger(n_east, n_north, az_deg, el_deg, light_az_deg, light_el_deg):
    """Brightness (0..1) of ground with unit normal (n_east, n_north, up = the rest),
    seen in direction (az, el) and lit from (light_az, light_el)."""
    n_east, n_north = np.asarray(n_east, dtype=float), np.asarray(n_north, dtype=float)
    normal = np.stack([n_east, n_north, np.sqrt(np.maximum(0.0, 1.0 - n_east ** 2 - n_north ** 2))], axis=-1)
    mu0 = np.sum(normal * direction(light_az_deg, light_el_deg), axis=-1)
    mu = np.maximum(0.01, -np.sum(normal * direction(az_deg, el_deg), axis=-1))
    return np.where(mu0 > 0.0, mu0 / (mu0 + mu), 0.0)
