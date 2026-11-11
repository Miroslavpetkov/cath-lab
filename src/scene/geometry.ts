import * as THREE from 'three';
import { V3, anyPerp, cross, norm, sub, dot, scale } from '../math/vec';
import { HeartFrame, surfacePoint } from '../anatomy/heart';

/**
 * Custom tube along a point list with a per-ring radius. Rebuilt whenever the lumen changes.
 * Adds attribute `aS` (arc length, mm) so shaders can look up contrast arrival per ring.
 */
export function tubeGeometry(
  pts: V3[],
  radius: (i: number) => number,
  sValues: number[],
  radial = 10,
  origin: V3 = { x: 0, y: 0, z: 0 },
  cap = false,
): THREE.BufferGeometry {
  const n = pts.length;
  const pos = new Float32Array(n * radial * 3);
  const nor = new Float32Array(n * radial * 3);
  const sAttr = new Float32Array(n * radial);
  let prevN = anyPerp(norm(sub(pts[Math.min(1, n - 1)], pts[0])));
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const t = norm(sub(b, a));
    // Parallel transport of the normal.
    let nn = sub(prevN, scale(t, dot(prevN, t)));
    if (Math.hypot(nn.x, nn.y, nn.z) < 1e-6) nn = anyPerp(t);
    nn = norm(nn);
    prevN = nn;
    const bn = cross(t, nn);
    const r = radius(i);
    for (let j = 0; j < radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const dx = nn.x * c + bn.x * s;
      const dy = nn.y * c + bn.y * s;
      const dz = nn.z * c + bn.z * s;
      const k = (i * radial + j) * 3;
      pos[k] = pts[i].x + dx * r - origin.x;
      pos[k + 1] = pts[i].y + dy * r - origin.y;
      pos[k + 2] = pts[i].z + dz * r - origin.z;
      nor[k] = dx;
      nor[k + 1] = dy;
      nor[k + 2] = dz;
      sAttr[i * radial + j] = sValues[i];
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(sAttr, 1));
  // UVs for the stent strut texture: u around, v along.
  const uv = new Float32Array(n * radial * 2);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < radial; j++) {
      uv[(i * radial + j) * 2] = j / radial;
      uv[(i * radial + j) * 2 + 1] = sValues[i] - sValues[0];
    }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (cap) {
    // Close the distal end with a fan.
    const base = n * radial;
    const end = pts[n - 1];
    const p2 = new Float32Array(pos.length + 3);
    p2.set(pos);
    p2[base * 3] = end.x - origin.x;
    p2[base * 3 + 1] = end.y - origin.y;
    p2[base * 3 + 2] = end.z - origin.z;
    const n2 = new Float32Array(nor.length + 3);
    n2.set(nor);
    const tEnd = norm(sub(pts[n - 1], pts[Math.max(0, n - 2)]));
    n2[base * 3] = tEnd.x;
    n2[base * 3 + 1] = tEnd.y;
    n2[base * 3 + 2] = tEnd.z;
    for (let j = 0; j < radial; j++) idx.push((n - 1) * radial + j, base, (n - 1) * radial + ((j + 1) % radial));
    const s2 = new Float32Array(sAttr.length + 1);
    s2.set(sAttr);
    s2[base] = sValues[n - 1];
    const uv2 = new Float32Array(uv.length + 2);
    uv2.set(uv);
    g.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n2, 3));
    g.setAttribute('aS', new THREE.BufferAttribute(s2, 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
  }
  g.setIndex(idx);
  return g;
}

/** Procedural heart: deformed ellipsoid in heart-local coordinates (origin = heart centre). */
export function heartGeometry(f: HeartFrame, fatColours = true): THREE.BufferGeometry {
  const NA = 72;
  const NH = 48;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const muscle = new THREE.Color(0.55, 0.16, 0.14);
  const fat = new THREE.Color(0.92, 0.8, 0.46);
  for (let i = 0; i <= NH; i++) {
    const h = -1 + (2 * i) / NH;
    for (let j = 0; j < NA; j++) {
      const ang = (j / NA) * 360 - 180;
      const p = surfacePoint(f, ang, h);
      pos.push(p.x - f.center.x, p.y - f.center.y, p.z - f.center.z);
      const angDist = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
      let w = Math.exp(-(((h - 0.74) / 0.09) ** 2));
      w += Math.exp(-((angDist(ang, 14) / 10) ** 2)) * (h < 0.85 ? 1 : 0) * 0.85;
      w += Math.exp(-((angDist(ang, 190) / 10) ** 2)) * (h < 0.85 ? 1 : 0) * 0.7;
      w = fatColours ? Math.min(1, w) : 0;
      const c = muscle.clone().lerp(fat, w * 0.85);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NH; i++)
    for (let j = 0; j < NA; j++) {
      const a = i * NA + j;
      const b = i * NA + ((j + 1) % NA);
      const c = (i + 1) * NA + j;
      const d = (i + 1) * NA + ((j + 1) % NA);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Alpha map with a diamond strut pattern for stents. */
export function strutTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#fff';
  x.lineWidth = 6;
  x.beginPath();
  x.moveTo(0, 32);
  x.lineTo(32, 0);
  x.lineTo(64, 32);
  x.lineTo(32, 64);
  x.closePath();
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 0.4);
  return t;
}
