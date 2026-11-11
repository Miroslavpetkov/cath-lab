import { ACCESS, AORTA, CORONARIES, CoronaryDef, HEART, LESION } from '../config/anatomy';
import { Polyline, catmullRom } from '../math/polyline';
import { V3, add, lerp, scale, v3 } from '../math/vec';
import { heartFrame, radialDir, surfacePoint } from './heart';
import { referenceDiameter, stenosisFraction } from './lumen';

export type VesselGroup = 'aorta' | 'access' | 'coronary';

export interface Vessel {
  id: string;
  name: string;
  description: string;
  group: VesselGroup;
  parent: string | null;
  parentS: number;
  path: Polyline;
  /** Healthy reference diameter at arc length s. */
  ref: (s: number) => number;
  /** Diameter including the native lesion (before any treatment). */
  native: (s: number) => number;
  /** Rides on the beating heart. */
  beats: boolean;
  wireAngle: number;
  wireCapture: number;
  children: string[];
}

export interface Anatomy {
  vessels: Map<string, Vessel>;
  /** Wrist → aortic root, the rail the guide catheter travels on. */
  route: Polyline;
  routeElbowS: number;
  routeAortaS: number;
  aorticRoot: V3;
  leftOstium: V3;
  rightOstium: V3;
  /** Lesion position on the LAD (vessel-local arc length). */
  lesion: { vessel: string; s0: number; s1: number; center: number };
}

function coronaryPoints(def: CoronaryDef, start: V3): V3[] {
  const f = heartFrame();
  const ctrl = [start, ...def.path.map(([a, h]) => surfacePoint(f, a, h, def.proxDiameter * 0.45 + 0.6))];
  return catmullRom(ctrl, 10);
}

let cached: Anatomy | null = null;

/** Builds the procedural anatomy once (pure maths – no Three.js). */
export function getAnatomy(): Anatomy {
  if (cached) return cached;
  const f = heartFrame();
  const baseCenter = add(f.center, scale(f.long, HEART.baseHalfLength + AORTA.rootAbove));
  const aorticRoot = add(baseCenter, scale(radialDir(f, AORTA.rootAngle), AORTA.rootOffset));
  const rAo = AORTA.diameter / 2;
  const leftOstium = add(aorticRoot, scale(radialDir(f, AORTA.leftCuspAngle), rAo * 0.82));
  const rightOstium = add(aorticRoot, scale(radialDir(f, AORTA.rightCuspAngle), rAo * 0.82));

  const vessels = new Map<string, Vessel>();
  const mk = (v: Omit<Vessel, 'children'>) => vessels.set(v.id, { ...v, children: [] });

  // Aorta: root → ascending → arch → descending.
  const aortaPath = new Polyline(
    catmullRom([aorticRoot, add(aorticRoot, scale(f.long, 22)), AORTA.ascending, AORTA.archTop, AORTA.archEnd, v3(26, 40, -44), AORTA.descendingEnd], 14),
  );
  mk({
    id: 'AO',
    name: 'Aorta',
    description: 'Aorta: root (with the coronary cusps), ascending aorta, arch and descending aorta.',
    group: 'aorta',
    parent: null,
    parentS: 0,
    path: aortaPath,
    ref: () => AORTA.diameter,
    native: () => AORTA.diameter,
    beats: false,
    wireAngle: 0,
    wireCapture: 180,
  });

  // Access route: wrist → brachiocephalic → into the arch → down to the root.
  const accessPts = catmullRom(ACCESS.points.map((p) => ({ ...p })), 12);
  const archEntryS = aortaPath.closestS(ACCESS.points[ACCESS.points.length - 1]);
  const descend: V3[] = [];
  for (let s = archEntryS; s >= 0; s -= 4) descend.push(aortaPath.pointAt(s));
  // Keep the guide near the aortic wall on the way down, ending just above the root.
  const routePts = [...accessPts, ...descend.slice(1), aorticRoot];
  const route = new Polyline(routePts);
  const accessPoly = new Polyline(accessPts);
  const elbowP = ACCESS.points[ACCESS.elbowIndex];
  const routeElbowS = route.closestS(elbowP);
  const routeAortaS = accessPoly.length;
  const dia = ACCESS.diameters;
  mk({
    id: 'ARM',
    name: 'Radial → brachiocephalic',
    description: 'Right radial access path: radial, brachial, axillary, subclavian and brachiocephalic arteries.',
    group: 'access',
    parent: null,
    parentS: 0,
    path: accessPoly,
    ref: (s) => {
      const t = s / accessPoly.length;
      if (t < 0.3) return dia.radial + (dia.brachial - dia.radial) * (t / 0.3);
      if (t < 0.55) return dia.brachial + (dia.axillary - dia.brachial) * ((t - 0.3) / 0.25);
      if (t < 0.8) return dia.axillary + (dia.subclavian - dia.axillary) * ((t - 0.55) / 0.25);
      return dia.subclavian + (dia.brachiocephalic - dia.subclavian) * ((t - 0.8) / 0.2);
    },
    native: (s) => vessels.get('ARM')!.ref(s),
    beats: false,
    wireAngle: 0,
    wireCapture: 180,
  });

  // Coronaries.
  for (const def of CORONARIES) {
    let pts: V3[];
    if (def.id === 'LM') {
      const lad = CORONARIES.find((c) => c.id === 'LAD')!;
      const surf = surfacePoint(f, lad.path[0][0] + 6, lad.path[0][1] + 0.06, 2.6);
      const bif = lerp(leftOstium, surf, 0.5);
      pts = catmullRom([leftOstium, lerp(leftOstium, bif, 0.5), bif], 6);
    } else if (def.id === 'RCA') {
      pts = coronaryPoints(def, rightOstium);
    } else {
      const parent = vessels.get(def.parent!)!;
      const ps = def.parentS < 0 ? parent.path.length : def.parentS;
      pts = coronaryPoints(def, parent.path.pointAt(ps));
    }
    const path = new Polyline(pts);
    const isLesion = def.id === LESION.vessel;
    const L = path.length;
    const ref = (s: number) => referenceDiameter(def.proxDiameter, def.distDiameter, def.taperExp, s, L);
    mk({
      id: def.id,
      name: def.name,
      description: def.description,
      group: 'coronary',
      parent: def.parent,
      parentS: def.parent ? (def.parentS < 0 ? vessels.get(def.parent)!.path.length : def.parentS) : 0,
      path,
      ref,
      native: isLesion ? (s) => ref(s) * (1 - stenosisFraction(s)) : ref,
      beats: true,
      wireAngle: def.wireAngle,
      wireCapture: def.wireCapture,
    });
  }
  for (const v of vessels.values()) if (v.parent) vessels.get(v.parent)!.children.push(v.id);

  cached = {
    vessels,
    route,
    routeElbowS,
    routeAortaS,
    aorticRoot,
    leftOstium,
    rightOstium,
    lesion: {
      vessel: LESION.vessel,
      s0: LESION.centerS - LESION.length / 2,
      s1: LESION.centerS + LESION.length / 2,
      center: LESION.centerS,
    },
  };
  return cached;
}

/** A device path through the coronary tree: LM → LAD → (D1)… with path-space offsets. */
export interface PathSeg {
  vessel: string;
  /** Path arc length where this segment starts. */
  offset: number;
  /** Vessel-local arc length where the segment starts (branch point on this vessel = 0). */
  local0: number;
}

export function pathSegments(branches: readonly string[]): PathSeg[] {
  const a = getAnatomy();
  const segs: PathSeg[] = [];
  let offset = 0;
  for (let i = 0; i < branches.length; i++) {
    segs.push({ vessel: branches[i], offset, local0: 0 });
    if (i + 1 < branches.length) {
      const child = a.vessels.get(branches[i + 1])!;
      offset += child.parentS;
    }
  }
  return segs;
}

export function pathLength(branches: readonly string[]): number {
  const a = getAnatomy();
  const segs = pathSegments(branches);
  const last = segs[segs.length - 1];
  return last.offset + a.vessels.get(last.vessel)!.path.length;
}

/** Map a path arc length to (vessel, local s). */
export function pathToVessel(branches: readonly string[], s: number): { vessel: string; s: number } {
  const segs = pathSegments(branches);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (s >= segs[i].offset || i === 0) return { vessel: segs[i].vessel, s: s - segs[i].offset };
  }
  return { vessel: segs[0].vessel, s };
}

/** Map a vessel-local position to path space, or null if the vessel is not on the path. */
export function vesselToPath(branches: readonly string[], vessel: string, s: number): number | null {
  const seg = pathSegments(branches).find((g) => g.vessel === vessel);
  return seg ? seg.offset + s : null;
}

export function pathPoint(branches: readonly string[], s: number): V3 {
  const { vessel, s: ls } = pathToVessel(branches, s);
  return getAnatomy().vessels.get(vessel)!.path.pointAt(ls);
}

/** Split a path interval into per-vessel intervals. */
export function splitInterval(branches: readonly string[], s0: number, s1: number): { vessel: string; s0: number; s1: number }[] {
  const segs = pathSegments(branches);
  const out: { vessel: string; s0: number; s1: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].offset;
    const end = i + 1 < segs.length ? segs[i + 1].offset : Infinity;
    const a = Math.max(s0, start);
    const b = Math.min(s1, end);
    if (b > a) out.push({ vessel: segs[i].vessel, s0: a - start, s1: b - start });
  }
  return out;
}

/** Lesion interval in LM→LAD path space. */
export function lesionPathRange(): { s0: number; s1: number; center: number } {
  const a = getAnatomy();
  const off = vesselToPath(['LM', 'LAD'], 'LAD', 0)!;
  return { s0: a.lesion.s0 + off, s1: a.lesion.s1 + off, center: a.lesion.center + off };
}
