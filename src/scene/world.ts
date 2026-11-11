import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONTRAST, DEVICES, HEART } from '../config/anatomy';
import { beatPoint, beatScale, heartFrame, radialDir } from '../anatomy/heart';
import { getAnatomy, pathSegments, pathToVessel } from '../anatomy/vessels';
import { V3, add, lerp, scale, v3 } from '../math/vec';
import { inflatedDiameter } from '../physics/devices';
import { SimState, Injection } from '../state/store';
import { imagingActive, lumenFn } from '../procedure/sim';
import { heartGeometry, strutTexture, tubeGeometry } from './geometry';
import { contrastMaterial, fluoroPostMaterial, xrayMaterial } from './materials';

const tv = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);

interface VesselMeshes {
  m3d: THREE.Mesh;
  mfx: THREE.Mesh;
}

export interface Label {
  text: string;
  desc: string;
  pos: V3;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene3d = new THREE.Scene();
  readonly sceneFx = new THREE.Scene();
  readonly camera3d: THREE.PerspectiveCamera;
  readonly cameraFx: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private rt: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat = fluoroPostMaterial();
  private heart3d = new THREE.Group();
  private heartFx = new THREE.Group();
  private heartMesh3d!: THREE.Mesh;
  private vessels = new Map<string, VesselMeshes>();
  private contrastMats = new Map<string, THREE.ShaderMaterial>();
  private dev3d = new THREE.Group();
  private devFx = new THREE.Group();
  private lumenKey = '';
  private injKey = -1;
  private lastFrameAt = -1;
  private hasImage = false;
  private iso = tv(HEART.center);
  private strut = strutTexture();
  private camGoal: { target: THREE.Vector3; dist: number } | null = null;
  labels: Label[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1220);
    this.camera3d = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.camera3d.position.set(-180, 120, 420);
    this.controls = new OrbitControls(this.camera3d, canvas);
    this.controls.target.copy(tv(HEART.center));
    this.controls.enableZoom = false; // wheel advances devices; Ctrl+wheel zooms (handled in main)
    this.controls.enableDamping = true;
    this.cameraFx = new THREE.PerspectiveCamera(15, 1, 50, 3000);
    this.rt = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.postMat.uniforms.tImage.value = this.rt.texture;
    this.build();
  }

  private build(): void {
    const a = getAnatomy();
    const f = heartFrame();
    // Lights for 3D.
    this.scene3d.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1a1a, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-200, 300, 400);
    this.scene3d.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.6);
    rim.position.set(300, -100, -300);
    this.scene3d.add(rim);

    // Heart (beating groups positioned at the heart centre).
    this.heart3d.position.copy(tv(HEART.center));
    this.heartFx.position.copy(tv(HEART.center));
    this.scene3d.add(this.heart3d);
    this.sceneFx.add(this.heartFx);
    this.heartMesh3d = new THREE.Mesh(heartGeometry(f), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.02 }));
    this.heart3d.add(this.heartMesh3d);
    this.heartFx.add(new THREE.Mesh(heartGeometry(f, false), xrayMaterial(0.2, 0.03, 1.0)));

    // Static vessels.
    for (const id of ['AO', 'ARM']) {
      const v = a.vessels.get(id)!;
      const samples = v.path.sample(4);
      const geo = tubeGeometry(samples.map((x) => x.p), (i) => v.ref(samples[i].s) / 2, samples.map((x) => x.s), 24);
      const m3d = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: id === 'AO' ? 0xd46a5f : 0xc0504d, transparent: true, opacity: id === 'AO' ? 0.28 : 0.45, roughness: 0.4, depthWrite: false, side: THREE.DoubleSide }),
      );
      m3d.renderOrder = 2;
      this.scene3d.add(m3d);
      if (id === 'AO') {
        const mat = contrastMaterial();
        this.contrastMats.set(id, mat);
        const mfx = new THREE.Mesh(geo, mat);
        this.addContrastAttrs(geo, samples.map(() => 1e6), samples.map((x) => v.ref(x.s)), samples.map(() => 1));
        this.sceneFx.add(mfx);
        this.sceneFx.add(new THREE.Mesh(geo, xrayMaterial(0.05, 0, 1)));
        this.vessels.set(id, { m3d, mfx });
      }
    }
    // Plaque around the lesion (3D only).
    const lad = a.vessels.get('LAD')!;
    const pl: { s: number; p: V3 }[] = [];
    for (let s = a.lesion.s0 - 1; s <= a.lesion.s1 + 1; s += 0.5) pl.push({ s, p: lad.path.pointAt(s) });
    const plaque = new THREE.Mesh(
      tubeGeometry(pl.map((x) => x.p), (i) => lad.ref(pl[i].s) * 0.56, pl.map((x) => x.s), 14, HEART.center),
      new THREE.MeshStandardMaterial({ color: 0xf2d27a, transparent: true, opacity: 0.55, roughness: 0.8, depthWrite: false }),
    );
    plaque.renderOrder = 3;
    this.heart3d.add(plaque);

    this.buildChest();
    this.scene3d.add(this.dev3d);
    this.sceneFx.add(this.devFx);

    this.labels = [
      { text: 'Aorta', desc: a.vessels.get('AO')!.description, pos: a.vessels.get('AO')!.path.pointAt(70) },
      { text: 'Radial access', desc: a.vessels.get('ARM')!.description, pos: a.vessels.get('ARM')!.path.pointAt(30) },
      ...['LM', 'LAD', 'LCx', 'D1', 'D2', 'RCA'].map((id) => {
        const v = a.vessels.get(id)!;
        const s = id === 'LAD' ? 100 : id === 'LM' ? v.path.length * 0.5 : Math.min(30, v.path.length * 0.6);
        return { text: v.name, desc: v.description, pos: add(v.path.pointAt(s), scale(radialDir(f, 0), 0)) };
      }),
      { text: '90% lesion', desc: 'Mid-LAD stenosis, 14 mm long, 90% diameter narrowing, between D1 and D2.', pos: lad.path.pointAt(a.lesion.center) },
    ];
  }

  private buildChest(): void {
    // Spine.
    const vert = new THREE.CylinderGeometry(17, 17, 22, 24);
    for (let y = -230; y <= 210; y += 28) {
      const m = new THREE.Mesh(vert, xrayMaterial(0.2, 0.02, 0.6));
      m.scale.set(1, 1, 0.8);
      m.position.set(4, y, -75);
      this.sceneFx.add(m);
    }
    // Ribs: arcs from the spine around to the front, both sides.
    for (let k = 0; k < 10; k++) {
      const y = 170 - k * 34;
      for (const side of [-1, 1]) {
        const pts: V3[] = [];
        const s: number[] = [];
        for (let i = 0; i <= 24; i++) {
          const ph = (i / 24) * Math.PI * 0.95;
          pts.push(v3(4 + side * (40 + 125 * Math.sin(ph)), y - 22 * Math.sin(ph * 0.9) - 10 * (i / 24), -75 + 150 * (1 - Math.cos(ph)) / 2));
          s.push(i);
        }
        const m = new THREE.Mesh(tubeGeometry(pts, () => 4.5, s, 8), xrayMaterial(0.22, 0.01, 0.6));
        this.sceneFx.add(m);
      }
    }
    // Diaphragm domes and soft tissue.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 40, 24), xrayMaterial(0.26, 0.02, 0.9));
    dome.position.set(10, -215, -10);
    dome.scale.set(1.1, 0.75, 0.9);
    this.sceneFx.add(dome);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(170, 170, 900, 40, 1, true), xrayMaterial(0.12, 0.02, 1));
    body.scale.set(1, 1, 0.65);
    body.position.set(0, 0, -20);
    this.sceneFx.add(body);
  }

  private addContrastAttrs(geo: THREE.BufferGeometry, arrive: number[], diam: number[], flow: number[]): void {
    const n = geo.getAttribute('position').count;
    const ringCount = arrive.length;
    const radial = Math.max(1, Math.floor(n / ringCount));
    const A = new Float32Array(n);
    const D = new Float32Array(n);
    const F = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = Math.min(ringCount - 1, Math.floor(i / radial));
      A[i] = Number.isFinite(arrive[r]) ? arrive[r] : 1e6;
      D[i] = diam[r];
      F[i] = flow[r];
    }
    geo.setAttribute('aArrive', new THREE.BufferAttribute(A, 1));
    geo.setAttribute('aDiam', new THREE.BufferAttribute(D, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(F, 1));
  }

  /** Rebuild coronary meshes when the lumen changes or a new injection starts. */
  private rebuildCoronaries(st: SimState, inj: Injection | null): void {
    const a = getAnatomy();
    const lum = lumenFn(st);
    for (const id of ['LM', 'LAD', 'LCx', 'D1', 'D2', 'RCA']) {
      const v = a.vessels.get(id)!;
      const samples = v.path.sample(1);
      const diam = samples.map((x) => lum(id, x.s));
      const geo = tubeGeometry(samples.map((x) => x.p), (i) => Math.max(0.12, diam[i] / 2), samples.map((x) => x.s), 12, HEART.center, true);
      const f = inj?.flow.get(id);
      const pick = (arr: number[] | undefined, s: number, fallback: number) => {
        if (!arr || !f) return fallback;
        const idx = Math.max(0, Math.min(arr.length - 1, Math.round((s / v.path.length) * (arr.length - 1))));
        return arr[idx];
      };
      const arrive = samples.map((x) => pick(f?.arrival, x.s, 1e6));
      const flow = samples.map((x) => pick(f?.flow, x.s, 1));
      this.addContrastAttrs(geo, arrive, diam, flow);
      const old = this.vessels.get(id);
      if (old) {
        old.m3d.geometry.dispose();
        old.m3d.geometry = geo;
        old.mfx.geometry = geo;
      } else {
        const m3d = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8322a, roughness: 0.35, metalness: 0.05 }));
        m3d.userData.vessel = id;
        this.heart3d.add(m3d);
        let mat = this.contrastMats.get(id);
        if (!mat) {
          mat = contrastMaterial();
          this.contrastMats.set(id, mat);
        }
        const mfx = new THREE.Mesh(geo, mat);
        this.heartFx.add(mfx);
        this.vessels.set(id, { m3d, mfx });
      }
    }
    // Aorta contrast.
    const ao = this.vessels.get('AO')!;
    const aov = a.vessels.get('AO')!;
    const samples = aov.path.sample(4);
    const arr = samples.map((x) => {
      if (!inj) return 1e6;
      if (inj.kind === 'aortic') return x.s / CONTRAST.aorticSpeed;
      return x.s < CONTRAST.aorticRefluxMm ? 0.05 + x.s / CONTRAST.aorticSpeed : 1e6;
    });
    this.addContrastAttrs(ao.mfx.geometry, arr, samples.map(() => 30), samples.map(() => 1));
    this.contrastMats.get('AO')!.uniforms.uDensity.value = inj?.kind === 'aortic' ? 0.55 : 0.3;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera3d.aspect = w / h;
    this.camera3d.updateProjectionMatrix();
    this.postMat.uniforms.uAspect.value = w / h;
  }

  /** Smoothly move the 3D orbit target / distance (auto-zoom). */
  focus(target: V3, dist: number): void {
    this.camGoal = { target: tv(target), dist };
  }

  zoom(factor: number): void {
    const off = this.camera3d.position.clone().sub(this.controls.target);
    const d = Math.max(30, Math.min(1500, off.length() * factor));
    this.camera3d.position.copy(this.controls.target.clone().add(off.setLength(d)));
    this.camGoal = null;
  }

  private beat(p: V3, phase: number, beats: boolean): V3 {
    return beats ? beatPoint(p, phase) : p;
  }

  /** Points of the guide catheter, with the pre-shaped tip near the root. */
  private guidePoints(st: SimState): { pts: V3[]; s: number[] } {
    const a = getAnatomy();
    const g = st.guide;
    const pts: V3[] = [];
    const ss: number[] = [];
    const end = Math.max(0.5, g.s);
    const tipLen = DEVICES.guide.tipLength;
    const dir = radialDir(heartFrame(), g.rot);
    const nearRoot = Math.max(0, Math.min(1, (end - (a.route.length - 80)) / 60));
    for (let s = 0; s <= end + 1e-6; s += 4) {
      let p = a.route.pointAt(s);
      const k = (s - (end - tipLen)) / tipLen;
      if (k > 0) p = add(p, scale(dir, 13 * k * k * nearRoot));
      pts.push(p);
      ss.push(s);
    }
    if (end % 4 > 0.01) {
      const k = 1;
      pts.push(add(a.route.pointAt(end), scale(dir, 13 * k * k * nearRoot)));
      ss.push(end);
    }
    if (g.engaged) {
      // Seat the tip into the left main ostium.
      const tip = a.leftOstium;
      const last = pts[pts.length - 1];
      pts.push(lerp(last, tip, 0.5), tip);
      ss.push(end + 4, end + 8);
    }
    return { pts, s: ss };
  }

  private wirePathPoints(st: SimState, s0: number, s1: number, step: number, phase: number): V3[] {
    const a = getAnatomy();
    const out: V3[] = [];
    for (let s = s0; s <= s1 + 1e-6; s += step) {
      const { vessel, s: ls } = pathToVessel(st.wire.branches, Math.max(0, s));
      out.push(this.beat(a.vessels.get(vessel)!.path.pointAt(ls), phase, true));
    }
    if ((s1 - s0) % step > 0.01) {
      const { vessel, s: ls } = pathToVessel(st.wire.branches, s1);
      out.push(this.beat(a.vessels.get(vessel)!.path.pointAt(ls), phase, true));
    }
    return out;
  }

  private rebuildDevices(st: SimState, phase: number): void {
    for (const grp of [this.dev3d, this.devFx]) {
      for (const c of [...grp.children]) {
        grp.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
    }
    const add3 = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      this.dev3d.add(m);
      return m;
    };
    const addFx = (geo: THREE.BufferGeometry, k: number, base = 0) => this.devFx.add(new THREE.Mesh(geo, this.fxMat(k, base)));
    // Guide.
    const g = this.guidePoints(st);
    if (g.pts.length >= 2) {
      const geo = tubeGeometry(g.pts, () => DEVICES.guide.diameter / 2, g.s, 8);
      add3(geo, this.mat('guide', 0xe8eef5, 0.35));
      addFx(geo, 0.38, 0.05);
    }
    // Wire.
    if (st.wire.s > 0.5) {
      const pts = [getAnatomy().leftOstium, ...this.wirePathPoints(st, 0, st.wire.s, 2, phase)];
      const ss = pts.map((_, i) => i);
      const geo = tubeGeometry(pts, () => 0.25, ss, 6);
      add3(geo, this.mat('wire', 0xc9d3dd, 0.2, 0.9));
      addFx(geo, 0.32, 0.08);
      const tipPts = this.wirePathPoints(st, Math.max(0, st.wire.s - 25), st.wire.s, 1, phase);
      if (tipPts.length >= 2) {
        const tgeo = tubeGeometry(tipPts, () => 0.32, tipPts.map((_, i) => i), 6);
        add3(tgeo, this.mat('wiretip', 0xf5c542, 0.3, 0.6));
        addFx(tgeo, 0.62, 0.15);
      }
    }
    // Balloon / stent catheter.
    const c = st.cath;
    if (c.kind && c.s > 0) {
      const s0 = c.s - c.length;
      const shaftEnd = Math.max(0, s0);
      if (shaftEnd > 0.5) {
        const pts = [getAnatomy().leftOstium, ...this.wirePathPoints(st, 0, shaftEnd, 2, phase)];
        const geo = tubeGeometry(pts, () => 0.45, pts.map((_, i) => i), 6);
        add3(geo, this.mat('shaft', 0x9fb4c8, 0.5));
        addFx(geo, 0.12, 0.02);
      }
      const d = inflatedDiameter(c.kind, c.diameter, c.pressure);
      const bpts = this.wirePathPoints(st, Math.max(0, s0), c.s, 0.5, phase);
      if (bpts.length >= 2) {
        const bs = bpts.map((_, i) => i * 0.5);
        const r = (i: number) => {
          const t = i / (bpts.length - 1);
          const taper = Math.min(1, Math.min(t, 1 - t) * c.length / 1.2);
          return Math.max(0.45, (d / 2) * (0.35 + 0.65 * taper));
        };
        const geo = tubeGeometry(bpts, r, bs, 14, undefined, true);
        const inflated = c.pressure > 0.3;
        add3(geo, inflated ? this.mat('balloonInfl', 0xf4d03f, 0.35, 0.1, 0.92) : this.mat('balloon', 0xd9e3ec, 0.4, 0.1, 0.85));
        if (inflated) addFx(geo, 0.6, 0.05);
        else addFx(geo, 0.06, 0.01);
        if (c.kind === 'stent' && c.stentOnBoard) {
          const sgeo = tubeGeometry(bpts, (i) => r(i) + 0.08, bs, 16);
          add3(sgeo, this.stentMat());
          addFx(sgeo, 0.1, 0.02);
        }
        // Radiopaque markers at both ends of the working length.
        for (const ms of [Math.max(0, s0), c.s]) {
          const mp = this.wirePathPoints(st, Math.max(0, ms - 0.6), ms + 0.6, 0.6, phase);
          if (mp.length >= 2) {
            const mg = tubeGeometry(mp, () => 0.62, mp.map((_, i) => i), 10, undefined, true);
            add3(mg, this.mat('marker', 0xffd166, 0.3, 0.8));
            addFx(mg, 0.85, 0.3);
          }
        }
      }
    }
    // Deployed stents.
    const a = getAnatomy();
    for (const s of st.stents) {
      for (const it of s.intervals) {
        const v = a.vessels.get(it.vessel)!;
        const pts: V3[] = [];
        const ss: number[] = [];
        for (let x = it.s0; x <= it.s1 + 1e-6; x += 0.5) {
          pts.push(this.beat(v.path.pointAt(x), phase, true));
          ss.push(x);
        }
        if (pts.length < 2) continue;
        const geo = tubeGeometry(pts, () => (s.diameter * 0.97) / 2 + 0.06, ss, 18);
        add3(geo, this.stentMat());
        addFx(geo, 0.1, 0.02);
      }
    }
    // Dissections: dark flap in 3D, lingering contrast stain on fluoro (after an injection).
    for (const d of st.dissections) {
      const v = a.vessels.get(d.vessel)!;
      const p = this.beat(v.path.pointAt(d.s), phase, true);
      const off = scale(radialDir(heartFrame(), 40), v.ref(d.s) * 0.5);
      const flap = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.mat(d.sealed ? 'flapSealed' : 'flap', d.sealed ? 0x6b4b4b : 0x1a0c0c, 0.9));
      flap.scale.set(1.6, 0.7, 3.2);
      flap.position.copy(tv(add(p, off)));
      this.dev3d.add(flap);
      const injected = st.injections.some((i) => i.time > d.time);
      if (injected && !d.sealed) {
        const stain = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), this.fxMat(0.42, 0.05));
        stain.scale.set(1.8, 1.2, 4);
        stain.position.copy(tv(add(p, off)));
        this.devFx.add(stain);
      }
    }
  }

  private mats = new Map<string, THREE.Material>();
  private mat(key: string, color: number, roughness: number, metalness = 0.1, opacity = 1): THREE.Material {
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness, transparent: opacity < 1, opacity });
      this.mats.set(key, m);
    }
    return m;
  }
  private stentMat(): THREE.Material {
    let m = this.mats.get('stent');
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.9, roughness: 0.25, alphaMap: this.strut, alphaTest: 0.5, side: THREE.DoubleSide });
      this.mats.set('stent', m);
    }
    return m;
  }
  private fxMat(k: number, base: number): THREE.Material {
    const key = `fx${k}_${base}`;
    let m = this.mats.get(key);
    if (!m) {
      m = xrayMaterial(k, base, 0.5);
      this.mats.set(key, m);
    }
    return m;
  }

  /** Per-frame update of the beating heart, lumen, devices and cameras. */
  update(st: SimState, dt: number, follow: boolean): void {
    const phase = st.ecg.phase;
    const k = beatScale(phase);
    this.heart3d.scale.setScalar(k);
    this.heartFx.scale.setScalar(k);
    const inj = this.latestInjection(st);
    const injIdx = inj ? st.injections.indexOf(inj) : -1;
    if (st.lumenKey !== this.lumenKey || injIdx !== this.injKey || !this.vessels.has('LAD')) {
      this.lumenKey = st.lumenKey;
      this.injKey = injIdx;
      this.rebuildCoronaries(st, inj);
    }
    for (const m of this.contrastMats.values()) {
      m.uniforms.uActive.value = inj ? 1 : 0;
      m.uniforms.uTime.value = inj ? st.time - inj.time : 0;
      m.uniforms.uWash.value = CONTRAST.washout;
    }
    this.rebuildDevices(st, phase);

    // C-arm isocentre follows the guide up the arm, then settles on the heart.
    const a = getAnatomy();
    const tip = a.route.pointAt(st.guide.s);
    const chest = st.guide.s > a.routeAortaS - 40 || st.guide.engaged;
    const goal = chest ? tv(HEART.center).add(new THREE.Vector3(-15, 25, 0)) : tv(tip);
    this.iso.lerp(goal, Math.min(1, dt * 3));
    const p = st.fluoro.projection;
    const lao = (p.lao * Math.PI) / 180;
    const cran = (p.cran * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(lao) * Math.cos(cran), Math.sin(cran), Math.cos(lao) * Math.cos(cran));
    this.cameraFx.position.copy(this.iso.clone().add(dir.multiplyScalar(900)));
    this.cameraFx.up.set(0, 1, 0);
    this.cameraFx.lookAt(this.iso);

    // 3D camera: follow tip or auto-zoom.
    if (follow) {
      const t = this.deviceTip(st, phase);
      this.controls.target.lerp(tv(t), Math.min(1, dt * 4));
    }
    if (this.camGoal) {
      this.controls.target.lerp(this.camGoal.target, Math.min(1, dt * 3));
      const off = this.camera3d.position.clone().sub(this.controls.target);
      const d = off.length() + (this.camGoal.dist - off.length()) * Math.min(1, dt * 3);
      this.camera3d.position.copy(this.controls.target.clone().add(off.setLength(d)));
      if (Math.abs(d - this.camGoal.dist) < 1 && this.controls.target.distanceTo(this.camGoal.target) < 1) this.camGoal = null;
    }
    this.controls.update();
  }

  deviceTip(st: SimState, phase: number): V3 {
    const a = getAnatomy();
    if ((st.tool === 'balloon' || st.tool === 'stent') && st.cath.s > 0) return this.wirePathPoints(st, st.cath.s, st.cath.s, 1, phase)[0];
    if (st.wire.s > 0.5) return this.wirePathPoints(st, st.wire.s, st.wire.s, 1, phase)[0];
    if (st.guide.engaged) return a.leftOstium;
    return a.route.pointAt(st.guide.s);
  }

  private latestInjection(st: SimState): Injection | null {
    const inj = st.injections[st.injections.length - 1];
    if (!inj) return null;
    return st.time - inj.time < inj.duration + 4 ? inj : null;
  }

  render(st: SimState): void {
    if (st.view === '3d') {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene3d, this.camera3d);
      return;
    }
    // Pulsed fluoroscopy: new frame at 15 fps while imaging, otherwise last-image hold.
    const active = imagingActive(st);
    if (active && st.time - this.lastFrameAt >= 1 / 15 - 1e-4) {
      this.lastFrameAt = st.time;
      this.renderer.setRenderTarget(this.rt);
      this.renderer.setClearColor(0xd6d6d6, 1);
      this.renderer.clear();
      this.renderer.render(this.sceneFx, this.cameraFx);
      this.renderer.setClearColor(0x0b1220, 1);
      this.hasImage = true;
      this.postMat.uniforms.uSeed.value = Math.random() * 100;
    }
    this.postMat.uniforms.uHas.value = this.hasImage ? 1 : 0;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  resetImage(): void {
    this.hasImage = false;
    this.lastFrameAt = -1;
  }

  /** Screen position (px) of a world point in the 3D view, and whether the heart hides it. */
  project(p: V3, w: number, h: number): { x: number; y: number; visible: boolean; behind: boolean } {
    const v = tv(p).project(this.camera3d);
    const visible = v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible, behind: false };
  }

  private ray = new THREE.Raycaster();
  occludedByHeart(p: V3): boolean {
    const origin = this.camera3d.position.clone();
    const target = tv(p);
    const dirv = target.clone().sub(origin);
    const dist = dirv.length();
    this.ray.set(origin, dirv.normalize());
    this.ray.far = dist - 4;
    return this.ray.intersectObject(this.heartMesh3d, false).length > 0;
  }

  /** Hover pick on coronary meshes in 3D: vessel id + arc length. */
  pick(ndcX: number, ndcY: number): { vessel: string; s: number } | null {
    this.ray.far = Infinity;
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera3d);
    const meshes = [...this.vessels.entries()].filter(([id]) => id !== 'AO').map(([, m]) => m.m3d);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const id = hit.object.userData.vessel as string;
    const v = getAnatomy().vessels.get(id)!;
    const k = this.heart3d.scale.x;
    const c = HEART.center;
    const unbeat = v3(c.x + (hit.point.x - c.x) / k, c.y + (hit.point.y - c.y) / k, c.z + (hit.point.z - c.z) / k);
    return { vessel: id, s: v.path.closestS(unbeat) };
  }

  segmentsKey(st: SimState): string {
    return pathSegments(st.wire.branches).map((s) => s.vessel).join('>');
  }
}
