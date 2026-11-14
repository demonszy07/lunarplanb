// The view from the plan A site as a camera would frame it: perspective,
// 70 degrees wide, no vertical stretch. Built with three.js (MIT licence,
// https://threejs.org), bundled with only the parts used; see package.json.
//
// What is in the picture:
//   ground within 20 km   a mesh from the site's three height grids (terrain.js)
//   mountains beyond      a strip standing behind the mesh, cut along the
//                         skyline that terrain from the edge of the mesh to
//                         300 km makes, and painted with the same lit-ground
//                         picture as the panorama
//   stars                 points, from the catalogue the panorama uses
//   Earth                 a sphere with the Blue Marble picture, lit by the Sun
//   Sun                   a disc of its true angular size with a hard-edged flare
// Nothing moves by itself: a picture is drawn only when draw() is called.
//
// Scene axes: x east, y up, z south. Origin: the ground at the site.

import {
  BufferAttribute, BufferGeometry, CanvasTexture, ClampToEdgeWrapping, DoubleSide, LinearFilter, LinearSRGBColorSpace, Mesh,
  MeshBasicMaterial, NoColorSpace, NormalBlending, PerspectiveCamera, Points, RepeatWrapping, Scene, ShaderMaterial,
  SphereGeometry, Texture, Vector3, WebGLRenderer, WebGLRenderTarget,
} from "three";
import { buildTerrain, parseTerrain } from "./terrain.js";

export { parseTerrain };

export const FIELD_OF_VIEW = 70;          // degrees, side to side
const HORIZON_AT = 0.6;                   // level sight line this far down the picture
const NEAR = 1, FAR = 100000;             // metres
const SKY = { stars: 70000, sun: 65000, earth: 60000, backdrop: 50000 };
const RAD = Math.PI / 180;
const SUN = [1, 0.973, 0.906];            // #FFF8E7
const DISC = Math.sin(0.2666 * RAD);      // half width of the Sun's disc

// unit vector of a direction given by azimuth (clockwise from north) and elevation
function direction(azDeg, elDeg, out = new Vector3()) {
  const az = azDeg * RAD, el = elDeg * RAD;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}
// on the sky at that direction: toward increasing azimuth (right) and toward increasing elevation (up)
function skyAxes(azDeg, elDeg) {
  const az = azDeg * RAD, el = elDeg * RAD;
  return {
    right: new Vector3(Math.cos(az), 0, Math.sin(az)),
    up: new Vector3(-Math.sin(el) * Math.sin(az), Math.cos(el), Math.sin(el) * Math.cos(az)),
  };
}

// ---- materials --------------------------------------------------------------

// Ground: the Lommel-Seeliger law, I = mu0 / (mu0 + mu), with the same soft
// edge for the width of the Sun's disc and the same display curve as the
// panorama (scene.js, shadeGround).
const GROUND_VERTEX = `
varying vec3 vNormal;
varying vec3 vPlace;
void main() {
  vNormal = normal;
  vPlace = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const GROUND_FRAGMENT = `
uniform vec3 uLight;        // unit vector toward the light
uniform vec3 uEye;
uniform vec3 uColour;
uniform float uStrength;    // share of the light that far terrain lets through
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vPlace;
const float DISC = ${DISC.toFixed(8)};
float softMu0(float mu0) {
  return mu0 >= DISC ? mu0 : mu0 <= -DISC ? 0.0 : (mu0 + DISC) * (mu0 + DISC) / (4.0 * DISC);
}
void main() {
  vec3 n = normalize(vNormal);
  float mu0 = softMu0(dot(n, uLight));
  float mu = max(0.01, dot(n, normalize(uEye - vPlace)));
  float value = mu0 > 0.0 ? uLevel * pow(uStrength * mu0 / (mu0 + mu), 1.0 / 2.2) : 0.0;
  gl_FragColor = vec4(uColour * value, 1.0);
}`;

// The strip of far mountains: looked up in the panorama's ground picture by
// the direction of each pixel (column = azimuth, row = elevation).
const BACKDROP_VERTEX = `
varying vec3 vRay;
uniform vec3 uEye;
void main() {
  vRay = position - uEye;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BACKDROP_FRAGMENT = `
uniform sampler2D uPicture;
uniform float uHasPicture;
uniform float uElTop;
uniform float uElSpan;
varying vec3 vRay;
void main() {
  if (uHasPicture < 0.5) { gl_FragColor = vec4(0.0706, 0.0706, 0.0706, 1.0); return; }
  float az = degrees(atan(vRay.x, -vRay.z));
  float el = degrees(atan(vRay.y, length(vRay.xz)));
  vec2 uv = vec2((az + 0.5) / 360.0, 1.0 - clamp((uElTop - el) / uElSpan, 0.0, 1.0));
  gl_FragColor = vec4(texture2D(uPicture, uv).rgb, 1.0);
}`;

const STAR_VERTEX = `
attribute float magnitude;
uniform float uRatio;
varying float vAlpha;
void main() {
  vAlpha = clamp(1.0 - 0.11 * (magnitude + 1.5), 0.28, 1.0);
  gl_PointSize = (magnitude < 0.5 ? 2.0 : magnitude < 2.5 ? 1.5 : 1.0) * uRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FRAGMENT = `
varying float vAlpha;
void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha); }`;

// Earth: the picture wrapped on a sphere, the day side lit, the night side black.
const EARTH_VERTEX = `
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const EARTH_FRAGMENT = `
uniform sampler2D uPicture;
uniform float uHasPicture;
uniform vec3 uSun;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  float mu0 = dot(normalize(vNormal), uSun);
  vec3 day = uHasPicture > 0.5 ? texture2D(uPicture, vUv).rgb * 1.9 * sqrt(max(mu0, 0.0)) : vec3(0.812, 0.886, 1.0);
  vec3 night = uHasPicture > 0.5 ? vec3(0.0) : vec3(0.043, 0.094, 0.188);
  gl_FragColor = vec4(mu0 > 0.0 ? day : night, 1.0);
}`;

function shader(vertexShader, fragmentShader, uniforms, extra = {}) {
  return new ShaderMaterial({ vertexShader, fragmentShader, uniforms, ...extra });
}

// ---- the view ---------------------------------------------------------------

export class View3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;      // colours are written as they should appear, like the 2D canvas
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = false;
    this.gl = this.renderer.getContext();
    this.camera = new PerspectiveCamera(40, 1, NEAR, FAR);
    this.sky = new Scene();
    this.ground = new Scene();
    this.eye = new Vector3(0, 2, 0);
    this.size = { width: 0, height: 0, ratio: 0 };

    this.groundMaterial = shader(GROUND_VERTEX, GROUND_FRAGMENT, {
      uLight: { value: new Vector3(0, 1, 0) }, uEye: { value: this.eye }, uColour: { value: new Vector3(1, 1, 1) },
      uStrength: { value: 1 }, uLevel: { value: 1 },
    });
    this.meshes = [];

    this.backdropMaterial = shader(BACKDROP_VERTEX, BACKDROP_FRAGMENT, {
      uPicture: { value: null }, uHasPicture: { value: 0 }, uElTop: { value: 2.4 }, uElSpan: { value: 10.4 },
      uEye: { value: this.eye },
    }, { depthTest: false, depthWrite: false, side: DoubleSide });
    this.backdrop = new Mesh(new BufferGeometry(), this.backdropMaterial);
    this.backdrop.renderOrder = -1;
    this.backdrop.frustumCulled = false;
    this.ground.add(this.backdrop);
    this.pictureSource = null;

    this.starMaterial = shader(STAR_VERTEX, STAR_FRAGMENT, { uRatio: { value: 1 } },
      { transparent: true, blending: NormalBlending, depthWrite: false });
    this.stars = null;

    this.earthMaterial = shader(EARTH_VERTEX, EARTH_FRAGMENT,
      { uPicture: { value: null }, uHasPicture: { value: 0 }, uSun: { value: new Vector3(1, 0, 0) } });
    this.earth = new Mesh(new SphereGeometry(1, 64, 32), this.earthMaterial);
    this.earth.matrixAutoUpdate = false;
    this.sky.add(this.earth);

    // Sun: a disc, and four thin spikes drawn at 55 % like the panorama's flare
    this.sunDisc = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0xffffff }));
    this.sunDisc.material.color.setRGB(SUN[0], SUN[1], SUN[2]);
    this.sunFlare = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.sunFlare.material.color.setRGB(SUN[0], SUN[1], SUN[2]);
    for (const part of [this.sunDisc, this.sunFlare]) {
      part.frustumCulled = false;
      part.material.side = DoubleSide;
      this.sky.add(part);
    }
    this.black = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide });
    this.probe = null;
  }

  // The site's terrain (a parsed [site]_3d.bin).
  setTerrain(terrain) {
    for (const mesh of this.meshes) { this.ground.remove(mesh); mesh.geometry.dispose(); }
    this.meshes = buildTerrain(terrain).map((level) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(level.position, 3));
      geometry.setAttribute("normal", new BufferAttribute(level.normal, 3));
      geometry.setIndex(new BufferAttribute(level.index, 1));
      const mesh = new Mesh(geometry, this.groundMaterial);
      mesh.frustumCulled = false;
      this.ground.add(mesh);
      return mesh;
    });
    this.triangles = this.meshes.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  }

  // Panel height (the camera) and the skyline of the terrain beyond the mesh
  // (720 elevations in degrees, from the terrain file) for the strip.
  setSite(site, profile) {
    this.eye.set(0, site.observer_height_m, 0);
    const n = profile.length;
    const position = new Float32Array((n + 1) * 2 * 3), index = [];
    const foot = Math.tan(-45 * RAD) * SKY.backdrop;
    for (let i = 0; i <= n; i++) {
      const az = (i % n) * (360 / n) * RAD, k = 6 * i;
      const x = Math.sin(az) * SKY.backdrop, z = -Math.cos(az) * SKY.backdrop;
      position.set([x, this.eye.y + Math.tan(profile[i % n] * RAD) * SKY.backdrop, z, x, this.eye.y + foot, z], k);
      if (i < n) index.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
    }
    this.backdrop.geometry.dispose();
    this.backdrop.geometry = new BufferGeometry();
    this.backdrop.geometry.setAttribute("position", new BufferAttribute(position, 3));
    this.backdrop.geometry.setIndex(index);
  }

  // Unit vectors of the stars in the catalogue's frame, and their magnitudes.
  setStars(stars) {
    const count = stars.count, position = new Float32Array(3 * count);
    for (let i = 0; i < count; i++) position.set([stars.x[i], stars.y[i], stars.z[i]], 3 * i);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("magnitude", new BufferAttribute(Float32Array.from(stars.mag), 1));
    this.stars = new Points(geometry, this.starMaterial);
    this.stars.matrixAutoUpdate = false;
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);
  }

  setEarthPicture(image) {
    const texture = new Texture(image);
    texture.colorSpace = NoColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.earthMaterial.uniforms.uPicture.value = texture;
    this.earthMaterial.uniforms.uHasPicture.value = 1;
  }

  resize(width, height, ratio) {
    if (this.size.width === width && this.size.height === height && this.size.ratio === ratio) return;
    this.size = { width, height, ratio };
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
  }

  // Pixels per unit of tan(angle) at the middle of the picture.
  focal(width) { return (width / 2) / Math.tan(FIELD_OF_VIEW / 2 * RAD); }

  // Aim a camera. The level sight line sits below the middle of the picture
  // (a shifted lens, not a tilted camera), so upright things stay upright.
  aim(camera, width, height, lookAz) {
    const tall = 2 * HORIZON_AT * height;                     // the whole image the lens draws; we keep its upper part
    camera.aspect = width / tall;
    camera.fov = 2 * Math.atan((tall / 2) / this.focal(width)) / RAD;
    camera.setViewOffset(width, tall, 0, 0, width, height);
    camera.position.copy(this.eye);
    camera.rotation.set(0, -lookAz * RAD, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Put everything where it is at one moment. `at` holds:
  //   view        result of viewAt (Sun and Earth: azimuth, elevation, diameter)
  //   lookAz      azimuth at the middle of the picture
  //   light       { source: "sun" | "earth" | "none", strength, az, el, colour: [r, g, b] 0..1, level }
  //   starMatrix  9 numbers, catalogue frame -> east, north, up (row-major), or null to hide the stars
  //   earth       { lon, lat, pole } facing point and pole angle, or null before they are known
  //   picture     canvas with the panorama's lit ground, or null
  place(at, width) {
    const v = at.view;
    const light = this.groundMaterial.uniforms;
    direction(at.light.az, at.light.el, light.uLight.value);
    light.uColour.value.set(...at.light.colour);
    light.uStrength.value = at.light.source === "none" ? 0 : at.light.strength;
    light.uLevel.value = at.light.level;

    // far mountains
    const back = this.backdropMaterial.uniforms;
    if (at.picture) {
      if (this.pictureSource !== at.picture) {
        if (back.uPicture.value) back.uPicture.value.dispose();
        const texture = new CanvasTexture(at.picture);
        texture.colorSpace = NoColorSpace;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.minFilter = texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        back.uPicture.value = texture;
        this.pictureSource = at.picture;
      }
      back.uPicture.value.needsUpdate = true;
      back.uElTop.value = at.pictureElTop;
      back.uElSpan.value = at.pictureElSpan;
    }
    back.uHasPicture.value = at.picture ? 1 : 0;

    // stars: catalogue frame -> scene (x east, y up, z = -north), pushed out to their shell
    if (this.stars) {
      this.stars.visible = !!at.starMatrix;
      if (at.starMatrix) {
        const m = at.starMatrix, s = SKY.stars;
        this.stars.matrix.set(s * m[0], s * m[1], s * m[2], 0, s * m[6], s * m[7], s * m[8], 0,
          -s * m[3], -s * m[4], -s * m[5], 0, 0, 0, 0, 1);
        this.stars.matrixWorldNeedsUpdate = true;
      }
    }

    // Sun
    const sunDir = direction(v.sunAz, v.sunEl), sunAxes = skyAxes(v.sunAz, v.sunEl);
    const centre = sunDir.clone().multiplyScalar(SKY.sun).add(this.eye);
    const r = SKY.sun * Math.tan(v.sunDiameter / 2 * RAD), pixel = SKY.sun / this.focal(width);
    const at3 = (x, y) => [centre.x + sunAxes.right.x * x + sunAxes.up.x * y, centre.y + sunAxes.right.y * x + sunAxes.up.y * y,
                           centre.z + sunAxes.right.z * x + sunAxes.up.z * y];
    const disc = [];
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * 2 * Math.PI, b = (k + 1) / 64 * 2 * Math.PI;
      disc.push(...at3(0, 0), ...at3(r * Math.cos(a), r * Math.sin(a)), ...at3(r * Math.cos(b), r * Math.sin(b)));
    }
    this.sunDisc.geometry.setAttribute("position", new BufferAttribute(new Float32Array(disc), 3));
    const reach = r * 3.2 + 4 * pixel, half = Math.max(0.75 * pixel, r * 0.16), flare = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      flare.push(...at3(dx * reach, dy * reach), ...at3(-dy * half, dx * half), ...at3(dy * half, -dx * half));
    }
    this.sunFlare.geometry.setAttribute("position", new BufferAttribute(new Float32Array(flare), 3));

    // Earth: the sphere's own axes (x through longitude 0, y through the north
    // pole, z through longitude 90 W) written in scene coordinates. Worked out on
    // the disc first (x right, y up, z toward the eye), the way realsky.js does.
    const earthDir = direction(v.earthAz, v.earthEl), axes = skyAxes(v.earthAz, v.earthEl);
    const toEye = earthDir.clone().negate();
    const radius = SKY.earth * Math.sin(v.earthDiameter / 2 * RAD);
    const facing = at.earth || { lon: 0, lat: 0, pole: 0 };
    const b = facing.lat * RAD, l = facing.lon * RAD, p = facing.pole * RAD;
    const onDisc = (xp, yp, z) => {                      // from "pole up" to the disc as seen, then to the scene
      const x = xp * Math.cos(p) + yp * Math.sin(p), y = -xp * Math.sin(p) + yp * Math.cos(p);
      return new Vector3().addScaledVector(axes.right, x).addScaledVector(axes.up, y).addScaledVector(toEye, z);
    };
    const pole = onDisc(0, Math.cos(b), Math.sin(b));
    const lon0 = onDisc(-Math.sin(l), -Math.sin(b) * Math.cos(l), Math.cos(b) * Math.cos(l));
    const lon90 = onDisc(Math.cos(l), -Math.sin(b) * Math.sin(l), Math.cos(b) * Math.sin(l));
    const c = earthDir.multiplyScalar(SKY.earth).add(this.eye);
    this.earth.matrix.set(
      radius * lon0.x, radius * pole.x, -radius * lon90.x, c.x,
      radius * lon0.y, radius * pole.y, -radius * lon90.y, c.y,
      radius * lon0.z, radius * pole.z, -radius * lon90.z, c.z,
      0, 0, 0, 1);
    this.earth.matrixWorldNeedsUpdate = true;
    this.earthMaterial.uniforms.uSun.value.copy(sunDir);
    this.starMaterial.uniforms.uRatio.value = this.size.ratio || 1;
  }

  render(camera, target = null) {
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.sky, camera);
    this.renderer.clearDepth();
    this.renderer.render(this.ground, camera);
  }

  // Draw one picture. Returns how azimuths map to x, for the direction labels.
  draw(at, width, height, ratio) {
    this.resize(width, height, ratio);
    this.place(at, width);
    this.aim(this.camera, width, height, at.lookAz);
    this.render(this.camera);
    const f = this.focal(width), lookAz = at.lookAz;
    return {
      lookAz, windowDeg: FIELD_OF_VIEW,
      x: (az) => {
        const offset = ((az - lookAz + 180) % 360 + 360) % 360 - 180;
        return Math.abs(offset) > 80 ? null : width / 2 + f * Math.tan(offset * RAD);
      },
      y: (el) => HORIZON_AT * height - f * Math.tan(el * RAD),      // at the middle column
    };
  }

  // Time a few full pictures, in milliseconds each. readPixels makes the
  // graphics card finish before the clock is read.
  time(at, width, height, ratio, frames = 5) {
    const times = [], pixel = new Uint8Array(4);
    for (let k = 0; k < frames; k++) {
      const start = performance.now();
      this.draw(at, width, height, ratio);
      this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
      times.push(performance.now() - start);
    }
    return times;
  }

  // Check: the share of the Sun's disc that the 3D scene leaves in view,
  // counted in pixels through a long lens aimed at the Sun (the disc is
  // about 180 pixels wide). Drawn off screen; the flare is left out.
  measureSun(at, size = 384) {
    this.place(at, this.size.width || 800);
    if (!this.probe) this.probe = new WebGLRenderTarget(size, size);
    const camera = new PerspectiveCamera(1.15, 1, NEAR, FAR);
    camera.position.copy(this.eye);
    camera.lookAt(direction(at.view.sunAz, at.view.sunEl).multiplyScalar(SKY.sun).add(this.eye));
    camera.updateMatrixWorld();
    const hidden = [this.sunFlare, this.earth, this.stars].filter(Boolean).map((part) => [part, part.visible]);
    for (const [part] of hidden) part.visible = false;
    const count = (withGround) => {
      this.renderer.setRenderTarget(this.probe);
      this.renderer.clear();
      this.renderer.render(this.sky, camera);
      if (withGround) {
        this.renderer.clearDepth();
        this.ground.overrideMaterial = this.black;
        this.renderer.render(this.ground, camera);
        this.ground.overrideMaterial = null;
      }
      const pixels = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(this.probe, 0, 0, size, size, pixels);
      let lit = 0;
      for (let k = 0; k < pixels.length; k += 4) if (pixels[k] > 127) lit++;
      return lit;
    };
    const whole = count(false), seen = count(true);
    for (const [part, was] of hidden) part.visible = was;
    this.renderer.setRenderTarget(null);
    return { seenPixels: seen, discPixels: whole, fraction: whole ? seen / whole : 0 };
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.backdrop.geometry.dispose();
    if (this.probe) this.probe.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
