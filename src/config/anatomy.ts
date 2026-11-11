/**
 * Every anatomy size, device size and physiology constant lives here.
 * Units: 1 scene unit = 1 mm. Angles in degrees unless noted. Times in seconds.
 * World axes: +x = patient's left, +y = head, +z = anterior.
 * Values are simplified teaching approximations, not clinical reference data.
 */

export const HEART = {
  center: { x: 18, y: -10, z: 0 },
  /** Direction from base to apex: left, down, forward. */
  apexDir: { x: 0.6, y: -0.62, z: 0.5 },
  radius: 44, // short-axis radius
  baseHalfLength: 46, // centre → base
  apexHalfLength: 62, // centre → apex
  apexTaper: 0.32, // how pointed the apex is
  rvBulge: 7, // mm extra on the anterior-right free wall
  rvBulgeAngle: -55,
  beatAmplitude: 0.035, // fractional contraction at peak systole
  systoleFraction: 0.38,
} as const;

export const AORTA = {
  diameter: 30,
  /** Aortic root sits at the heart base, shifted right/anterior (heart-local angle, mm). */
  rootAngle: -35,
  rootOffset: 10,
  rootAbove: 10,
  ascending: { x: -18, y: 105, z: 18 },
  archTop: { x: -4, y: 132, z: 0 },
  archEnd: { x: 22, y: 118, z: -38 },
  descendingEnd: { x: 26, y: -170, z: -42 },
  leftCuspAngle: 70, // heart-local angle of the left coronary ostium on the root
  rightCuspAngle: -80,
} as const;

/** Right radial → brachial → axillary → subclavian → brachiocephalic access path. */
export const ACCESS = {
  points: [
    { x: -300, y: -250, z: 70 }, // radial puncture at the wrist
    { x: -292, y: -170, z: 58 },
    { x: -275, y: -60, z: 40 },
    { x: -262, y: -10, z: 32 }, // elbow
    { x: -238, y: 70, z: 18 },
    { x: -200, y: 140, z: 10 }, // axilla
    { x: -140, y: 172, z: 8 },
    { x: -80, y: 178, z: 10 }, // subclavian
    { x: -42, y: 165, z: 14 },
    { x: -24, y: 145, z: 12 }, // brachiocephalic → arch
  ],
  elbowIndex: 3,
  diameters: { radial: 2.6, brachial: 4, axillary: 6, subclavian: 8, brachiocephalic: 12 },
} as const;

export interface CoronaryDef {
  id: string;
  name: string;
  description: string;
  parent: string | null;
  /** Arc length on the parent where this vessel branches off (mm). -1 = parent's end. */
  parentS: number;
  /** Heart-surface control points as [angle deg, h] where h ∈ [-1 apex, 1 base]. */
  path: [number, number][];
  proxDiameter: number;
  distDiameter: number;
  taperExp: number;
  /** Shaped-wire tip angle that captures this branch, and capture half-width. */
  wireAngle: number;
  wireCapture: number;
}

export const CORONARIES: CoronaryDef[] = [
  {
    id: 'LM',
    name: 'Left main',
    description: 'Left main stem: short trunk from the left coronary cusp that splits into the LAD and LCx.',
    parent: null,
    parentS: 0,
    path: [],
    proxDiameter: 4.4,
    distDiameter: 4.2,
    taperExp: 1,
    wireAngle: 0,
    wireCapture: 180,
  },
  {
    id: 'LAD',
    name: 'LAD',
    description: 'Left anterior descending artery: runs down the anterior interventricular groove and feeds the front wall and septum.',
    parent: 'LM',
    parentS: -1,
    path: [
      [44, 0.76],
      [24, 0.62],
      [14, 0.3],
      [10, -0.1],
      [12, -0.5],
      [18, -0.85],
      [30, -0.97],
    ],
    proxDiameter: 3.33,
    distDiameter: 1.8,
    taperExp: 1.3,
    wireAngle: 0,
    wireCapture: 90,
  },
  {
    id: 'LCx',
    name: 'LCx',
    description: 'Left circumflex: curves around the left AV groove to the lateral and back walls.',
    parent: 'LM',
    parentS: -1,
    path: [
      [52, 0.8],
      [80, 0.74],
      [115, 0.66],
      [150, 0.58],
      [185, 0.46],
    ],
    proxDiameter: 3.2,
    distDiameter: 1.7,
    taperExp: 1.1,
    wireAngle: 180,
    wireCapture: 90,
  },
  {
    id: 'D1',
    name: 'D1',
    description: 'First diagonal branch of the LAD, supplying the anterolateral wall.',
    parent: 'LAD',
    parentS: 24,
    path: [
      [32, 0.42],
      [52, 0.3],
      [70, 0.12],
      [84, -0.08],
    ],
    proxDiameter: 2.2,
    distDiameter: 1.1,
    taperExp: 1,
    wireAngle: 90,
    wireCapture: 50,
  },
  {
    id: 'D2',
    name: 'D2',
    description: 'Second diagonal branch of the LAD, beyond the lesion.',
    parent: 'LAD',
    parentS: 66,
    path: [
      [24, -0.18],
      [42, -0.3],
      [58, -0.46],
      [70, -0.62],
    ],
    proxDiameter: 2.0,
    distDiameter: 1.0,
    taperExp: 1,
    wireAngle: 90,
    wireCapture: 50,
  },
  {
    id: 'RCA',
    name: 'RCA',
    description: 'Right coronary artery: from the right cusp along the right AV groove (not treated in this case).',
    parent: null,
    parentS: 0,
    path: [
      [-60, 0.84],
      [-90, 0.74],
      [-125, 0.62],
      [-160, 0.48],
      [-190, 0.2],
      [-200, -0.1],
    ],
    proxDiameter: 3.6,
    distDiameter: 1.9,
    taperExp: 1,
    wireAngle: 0,
    wireCapture: 180,
  },
];

export const LESION = {
  vessel: 'LAD',
  centerS: 45, // mm from LAD origin; D1 at 24, D2 at 66
  length: 14,
  plateau: 3,
  stenosis: 0.9, // diameter stenosis
} as const;

export const FLUORO = {
  fps: 15,
  noise: 0.075,
  blur: 0.9,
  collimation: 0.9,
  vignette: 0.55,
  presets: [
    { name: 'RAO30 CRA30', lao: -30, cran: 30 },
    { name: 'AP CRA35', lao: 0, cran: 35 },
    { name: 'LAO45 CRA30', lao: 45, cran: 30 },
    { name: 'LAO45 CAU30', lao: 45, cran: -30 },
    { name: 'RAO30 CAU25', lao: -30, cran: -25 },
    { name: 'AP', lao: 0, cran: 0 },
  ],
} as const;

export const CONTRAST = {
  selectiveMl: 8,
  aorticMl: 20,
  baseSpeed: 110, // mm/s dye front speed in an unobstructed coronary
  aorticSpeed: 400,
  washout: 2.0, // s of opacification behind the front (scaled by 1/flow)
  cineTail: 1.2,
  maxCine: 9,
  aorticRefluxMm: 18,
} as const;

export const FLOW = {
  /** Diameter stenosis below which flow is unaffected. */
  noEffectBelow: 0.6,
  zeroAt: 0.98,
  exponent: 0.7,
  dissectionFactor: 0.45,
  timi3: 0.8,
  timi2: 0.25,
  timi1: 0.02,
  sampleStep: 1, // mm between flow rings
} as const;

export const DEVICES = {
  guide: {
    french: 6,
    diameter: 2.0,
    speed: 45,
    fineSpeed: 8,
    rotSpeed: 90,
    fineRotSpeed: 25,
    leftCusp: 90,
    rightCusp: -90,
    engageTolerance: 25,
    popOutDeg: 40,
    gentleSpeed: 12, // advancing faster than this at the root just bumps the cusp
    startRotation: -10,
    tipLength: 22,
  },
  wire: {
    diameterInch: 0.014,
    diameter: 0.36,
    speed: 15,
    fineSpeed: 4,
    rotSpeed: 120,
    fineRotSpeed: 40,
    safeSpeed: 8,
    torqueSafeBonus: 2.0,
    buckleRiskPerMm: 0.012,
    startRotation: 150,
    endWarnMm: 8,
    hintAheadMm: 18,
  },
  catheter: {
    speed: 12,
    fineSpeed: 3,
    behindWireTip: 4,
    minS: -40,
    inflateRate: 3,
    fineInflateRate: 0.75,
    deflateRate: 8,
    foldedDiameter: 0.9,
    blockFlowAbove: 1.5, // atm
  },
  balloon: {
    diameters: [2.0, 2.5, 3.0, 3.5],
    lengths: [12, 15, 20],
    nominal: 8,
    rbp: 14,
    compliance: 0.015,
    elasticRecoil: 0.3,
  },
  stent: {
    diameters: [2.5, 2.75, 3.0, 3.5, 4.0],
    lengths: [12, 15, 18, 23, 28],
    nominal: 10,
    rbp: 16,
    compliance: 0.012,
    deployAt: 6,
    recoil: 0.03,
  },
  ruptureAboveRbp: 4,
  unfoldBelow: 2,
  dissectionOversize: 1.2,
  edgeDissectionOffset: 3,
  taperMm: 1.5,
} as const;

export const PHYSIOLOGY = {
  baseHR: 68,
  maxHRRise: 24,
  baseSys: 132,
  baseDia: 76,
  spo2: 98,
  ischaemiaRiseTime: 20,
  recoveryTau: 8,
  poorFlowThreshold: 0.25,
  maxST: 4,
  dropAfter: 40,
  unstableAfter: 60,
  actBase: 128,
  actHeparin: 285,
  actTau: 12,
  pvcProbability: 0.25,
} as const;

export const SCORING = {
  residualOk: 10,
  residualWarn: 30,
  sizeOk: [0.95, 1.15] as const,
  sizeWarn: [0.9, 1.25] as const,
  marginOk: 1.5,
  inflationOk: 30,
  inflationWarn: 60,
  contrastOk: 120,
  contrastWarn: 200,
  fluoroOkMin: 10,
  fluoroWarnMin: 20,
} as const;
