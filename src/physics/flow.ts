import { CONTRAST, FLOW } from '../config/anatomy';
import { getAnatomy } from '../anatomy/vessels';

/** Relative flow through a narrowing: 1 below 60% DS, falls steeply, 0 at ≥ 98%. */
export function flowFactor(diameterStenosis: number): number {
  const ds = Math.max(0, diameterStenosis);
  if (ds < FLOW.noEffectBelow) return 1;
  if (ds >= FLOW.zeroAt) return 0;
  return Math.pow((FLOW.zeroAt - ds) / (FLOW.zeroAt - FLOW.noEffectBelow), FLOW.exponent);
}

/** TIMI flow grade from a relative flow value. */
export function timiGrade(flow: number): 0 | 1 | 2 | 3 {
  if (flow >= FLOW.timi3) return 3;
  if (flow >= FLOW.timi2) return 2;
  if (flow > FLOW.timi1) return 1;
  return 0;
}

export interface FlowInput {
  /** Current lumen diameter. */
  diameter: (vessel: string, s: number) => number;
  /** Intervals blocked by an inflated balloon. */
  occlusions: readonly { vessel: string; s0: number; s1: number }[];
  dissections: readonly { vessel: string; s: number; sealed: boolean }[];
}

export interface VesselFlow {
  s: number[];
  /** Contrast arrival time (s after injection), Infinity if dye never gets there. */
  arrival: number[];
  /** Effective relative flow reaching this ring (min upstream, with penalties). */
  flow: number[];
  diam: number[];
}

/**
 * Contrast transit through the coronary tree. Speed at each ring is limited by the
 * tightest narrowing upstream (inherited by branches); a balloon stops flow beyond it and
 * an unsealed dissection multiplies downstream flow.
 */
export function computeFlow(input: FlowInput, roots: readonly string[] = ['LM']): Map<string, VesselFlow> {
  const a = getAnatomy();
  const out = new Map<string, VesselFlow>();
  const walk = (id: string, upFlow: number, upTime: number) => {
    const v = a.vessels.get(id)!;
    const L = v.path.length;
    const n = Math.max(2, Math.ceil(L / FLOW.sampleStep) + 1);
    const res: VesselFlow = { s: [], arrival: [], flow: [], diam: [] };
    let f = upFlow;
    let t = upTime;
    let prevS = 0;
    const diss = input.dissections.filter((d) => d.vessel === id && !d.sealed);
    const occ = input.occlusions.filter((o) => o.vessel === id);
    for (let i = 0; i < n; i++) {
      const s = (L * i) / (n - 1);
      const d = input.diameter(id, s);
      const ds = 1 - d / v.ref(s);
      let local = flowFactor(ds);
      if (occ.some((o) => s >= o.s0 && s <= o.s1)) local = 0;
      for (const dd of diss) if (prevS < dd.s && s >= dd.s) f *= FLOW.dissectionFactor;
      f = Math.min(f, local);
      const speed = CONTRAST.baseSpeed * f;
      if (i > 0) t = speed > 1e-3 && Number.isFinite(t) ? t + (s - prevS) / speed : Infinity;
      res.s.push(s);
      res.arrival.push(t);
      res.flow.push(f);
      res.diam.push(d);
      prevS = s;
    }
    out.set(id, res);
    for (const c of v.children) {
      const child = a.vessels.get(c)!;
      const idx = Math.min(n - 1, Math.round((child.parentS / L) * (n - 1)));
      walk(c, res.flow[idx], res.arrival[idx]);
    }
  };
  for (const r of roots) walk(r, 1, 0);
  return out;
}

/** Relative flow at the distal end of a vessel. */
export function distalFlow(flow: Map<string, VesselFlow>, vessel: string): number {
  const f = flow.get(vessel);
  return f ? f.flow[f.flow.length - 1] : 0;
}

/** Arrival time at a vessel-local position. */
export function arrivalAt(flow: Map<string, VesselFlow>, vessel: string, s: number): number {
  const f = flow.get(vessel);
  if (!f) return Infinity;
  let best = 0;
  for (let i = 0; i < f.s.length; i++) if (Math.abs(f.s[i] - s) < Math.abs(f.s[best] - s)) best = i;
  return f.arrival[best];
}

/** How long a cine run should last so the slowest-filling (but reachable) segment is seen. */
export function cineLength(flow: Map<string, VesselFlow>): number {
  let maxT = 0;
  for (const f of flow.values()) for (const t of f.arrival) if (Number.isFinite(t)) maxT = Math.max(maxT, t);
  return Math.min(CONTRAST.maxCine, maxT + CONTRAST.washout + CONTRAST.cineTail);
}
