export interface StageDef {
  id: string;
  title: string;
  goal: string;
  tasks: string[];
  why: string;
}

export const STAGES: StageDef[] = [
  {
    id: 'guide',
    title: 'Advance guide to aortic root',
    goal: 'Bring the 6F guide catheter from the right wrist up the arm and down into the aortic root.',
    tasks: ['Past the elbow', 'Into the aorta', 'Look on fluoro', 'Reach the aortic root'],
    why: 'Radial access has fewer bleeding complications than femoral access. Short fluoro taps confirm where the catheter is without wasting radiation.',
  },
  {
    id: 'engage',
    title: 'Engage left main',
    goal: 'Turn the pre-shaped tip toward the left coronary cusp, seat it in the left main ostium and take a diagnostic picture.',
    tasks: ['Face the left cusp', 'Seat in the left main', 'Diagnostic angiogram'],
    why: 'A coaxial, stable guide gives support for every device that follows. The diagnostic angiogram shows the lesion before you touch it.',
  },
  {
    id: 'wire',
    title: 'Cross the LAD lesion',
    goal: 'Anticoagulate, then steer the 0.014" wire into the LAD (not the LCx or diagonals) and across the lesion gently.',
    tasks: ['Give heparin', 'Wire out of the guide', 'Into the LAD (not LCx)', 'Cross the lesion gently', 'Park the wire distally'],
    why: 'Heparin prevents clot on the hardware. Forcing a wire through a tight lesion can tear the vessel wall (dissection); a distal wire position gives a stable rail.',
  },
  {
    id: 'predil',
    title: 'Pre-dilate',
    goal: 'Bring an undersized balloon over the wire, centre its markers on the lesion, inflate briefly and deflate.',
    tasks: ['Markers across the lesion', 'Inflate ≥ 6 atm over the lesion', 'Deflate'],
    why: 'Pre-dilation opens a path for the stent and lets you size the vessel. An undersized balloon limits the risk of dissection.',
  },
  {
    id: 'stent',
    title: 'Deploy stent',
    goal: 'Measure the lesion (QCA), choose a stent that matches the reference diameter and covers the lesion with margin, then deploy it.',
    tasks: ['Measure (QCA) and load a stent', 'Cover the whole lesion', 'Deploy and deflate'],
    why: 'A stent sized ~1:1 to the reference vessel and covering healthy shoulders on both sides reduces restenosis and edge dissection.',
  },
  {
    id: 'final',
    title: 'Final angiogram',
    goal: 'Inject contrast after stenting and check the result in a second, different projection.',
    tasks: ['Inject after stenting', 'Second distinct projection'],
    why: 'One view can hide a residual narrowing or edge dissection; two orthogonal-ish views confirm TIMI 3 flow and a good result.',
  },
];

export function emptyDone(): boolean[][] {
  return STAGES.map((s) => s.tasks.map(() => false));
}

/** Sub-tasks latch: once achieved they stay achieved. */
export function latch(prev: boolean[][], now: boolean[][]): boolean[][] {
  return now.map((row, i) => row.map((v, j) => v || (prev[i]?.[j] ?? false)));
}

/** Index of the first stage that is not fully done (STAGES.length when all are done). */
export function currentStage(done: boolean[][]): number {
  for (let i = 0; i < STAGES.length; i++) if (!done[i] || done[i].some((v) => !v)) return i;
  return STAGES.length;
}

export function stageComplete(done: boolean[][], i: number): boolean {
  return currentStage(done) > i;
}

/** The facts the stage logic needs, extracted from the simulation every frame. */
export interface Snapshot {
  pastElbow: boolean;
  inAorta: boolean;
  fluoroInChest: boolean;
  atRoot: boolean;
  facingLeft: boolean;
  engaged: boolean;
  selectiveAngio: boolean;
  heparin: boolean;
  wireOut: boolean;
  wireInLAD: boolean;
  wireCrossed: boolean;
  wireDistal: boolean;
  balloonMarkersAcross: boolean;
  predilated: boolean;
  predilDeflated: boolean;
  qcaDone: boolean;
  stentLoaded: boolean;
  stentCovers: boolean;
  stentDeployed: boolean;
  stentDeflated: boolean;
  postStentInjection: boolean;
  postStentViews: number;
}

export function evaluateTasks(s: Snapshot): boolean[][] {
  return [
    [s.pastElbow, s.inAorta, s.fluoroInChest, s.atRoot],
    [s.facingLeft || s.engaged, s.engaged, s.selectiveAngio],
    [s.heparin, s.wireOut, s.wireInLAD, s.wireCrossed, s.wireDistal],
    [s.balloonMarkersAcross || s.predilated, s.predilated, s.predilDeflated],
    [s.qcaDone && (s.stentLoaded || s.stentDeployed), s.stentCovers || s.stentDeployed, s.stentDeployed && s.stentDeflated],
    [s.postStentInjection, s.postStentViews >= 2],
  ];
}
