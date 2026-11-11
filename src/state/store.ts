import { DEVICES, FLUORO } from '../config/anatomy';
import type { Treatment, QCAResult } from '../anatomy/lumen';
import type { VesselFlow } from '../physics/flow';
import type { CathKind } from '../physics/devices';
import { Physiology, initialPhysiology } from '../physics/physiology';
import { makeRng } from '../math/vec';

export type ToolId = 'guide' | 'wire' | 'balloon' | 'stent' | 'contrast' | 'fluoro' | 'measure';
export type MsgLevel = 'info' | 'ok' | 'warn' | 'danger';

export interface Message {
  id: number;
  text: string;
  level: MsgLevel;
  time: number;
}

export interface StentRecord {
  intervals: { vessel: string; s0: number; s1: number }[];
  pathS0: number;
  pathS1: number;
  nominal: number;
  length: number;
  diameter: number;
  maxPressure: number;
  time: number;
}

export interface Dissection {
  vessel: string;
  s: number;
  sealed: boolean;
  cause: 'wire' | 'balloon' | 'stent-edge' | 'rupture';
  time: number;
}

export interface InflationRecord {
  kind: CathKind;
  start: number;
  duration: number;
  maxPressure: number;
  maxDiameter: number;
  pathS0: number;
  pathS1: number;
  overLesion: boolean;
}

export interface Injection {
  time: number;
  kind: 'selective' | 'aortic';
  projection: string;
  afterStent: boolean;
  duration: number;
  flow: Map<string, VesselFlow>;
  ml: number;
}

export interface Projection {
  name: string;
  lao: number; // + LAO, − RAO
  cran: number; // + cranial, − caudal
}

export interface SimState {
  time: number;
  rng: () => number;
  tool: ToolId;
  view: '3d' | 'fluoro';
  guide: { s: number; rot: number; engaged: boolean; speed: number };
  wire: {
    s: number;
    rot: number;
    branches: string[];
    resistance: number;
    risk: number;
    buckling: boolean;
    forcing: number;
    crossed: boolean;
    speed: number;
    rotating: boolean;
  };
  cath: {
    kind: CathKind | null;
    diameter: number;
    length: number;
    s: number;
    pressure: number;
    ruptured: boolean;
    stentOnBoard: boolean;
    inflStart: number | null;
    maxP: number;
    maxD: number;
    dissectedThisInflation: boolean;
    deployedIndex: number | null;
  };
  stents: StentRecord[];
  treatments: Treatment[];
  dissections: Dissection[];
  inflations: InflationRecord[];
  ruptures: number;
  phys: Physiology;
  heparinTime: number | null;
  contrastMl: number;
  fluoroTime: number;
  injections: Injection[];
  fluoro: { pedal: boolean; cineUntil: number; projection: Projection; everImaged: boolean; lastActive: number };
  qca: QCAResult | null;
  qcaTime: number | null;
  stages: { done: boolean[][]; completedAt: (number | null)[] };
  messages: Message[];
  flow: Map<string, VesselFlow>;
  ladFlow: number;
  timi: 0 | 1 | 2 | 3;
  lumenKey: string;
  ecg: { t: number; rr: number; pvc: boolean; beats: number; phase: number };
  ended: boolean;
  log: { time: number; stage: number; ladFlow: number; hr: number; st: number }[];
  /** Flags used to avoid repeating one-off messages. */
  flags: Record<string, boolean>;
  nextMsgId: number;
}

export function createState(seed = 1): SimState {
  const p = FLUORO.presets[0];
  return {
    time: 0,
    rng: makeRng(seed),
    tool: 'guide',
    view: '3d',
    guide: { s: 0, rot: DEVICES.guide.startRotation, engaged: false, speed: 0 },
    wire: {
      s: 0,
      rot: DEVICES.wire.startRotation,
      branches: ['LM'],
      resistance: 0,
      risk: 0,
      buckling: false,
      forcing: 0,
      crossed: false,
      speed: 0,
      rotating: false,
    },
    cath: {
      kind: null,
      diameter: 2.5,
      length: 15,
      s: DEVICES.catheter.minS,
      pressure: 0,
      ruptured: false,
      stentOnBoard: false,
      inflStart: null,
      maxP: 0,
      maxD: 0,
      dissectedThisInflation: false,
      deployedIndex: null,
    },
    stents: [],
    treatments: [],
    dissections: [],
    inflations: [],
    ruptures: 0,
    phys: initialPhysiology(),
    heparinTime: null,
    contrastMl: 0,
    fluoroTime: 0,
    injections: [],
    fluoro: { pedal: false, cineUntil: -1, projection: { ...p }, everImaged: false, lastActive: -1 },
    qca: null,
    qcaTime: null,
    stages: { done: [], completedAt: [] },
    messages: [],
    flow: new Map(),
    ladFlow: 1,
    timi: 3,
    lumenKey: '',
    ecg: { t: 0, rr: 60 / 68, pvc: false, beats: 0, phase: 0 },
    ended: false,
    log: [],
    flags: {},
    nextMsgId: 1,
  };
}

/** Feedback message; identical text within 4 s is suppressed. */
export function pushMessage(st: SimState, text: string, level: MsgLevel = 'info'): void {
  const last = [...st.messages].reverse().find((m) => m.text === text);
  if (last && st.time - last.time < 4) return;
  st.messages.push({ id: st.nextMsgId++, text, level, time: st.time });
  if (st.messages.length > 60) st.messages.splice(0, st.messages.length - 60);
}

/** Tiny pub/sub so UI modules can react to state changes without a framework. */
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(): void {
  for (const fn of listeners) fn();
}

/** The single live state object used by the app (tests create their own). */
export const store: { state: SimState } = { state: createState(Date.now() & 0xffff) };
