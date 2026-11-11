import { DEVICES } from '../config/anatomy';
import { getAnatomy, lesionPathRange } from '../anatomy/vessels';
import { coverageMargins, inflatedDiameter, rupturePressure, deviceSpec } from '../physics/devices';
import { ecgSample } from '../physics/ecg';
import { Debrief } from '../procedure/debrief';
import { branchHint, guideLocation, mentorHint } from '../procedure/hints';
import { imagingActive, imagingMode, toolContext } from '../procedure/sim';
import { STAGES, currentStage } from '../procedure/stages';
import { SimState, ToolId } from '../state/store';
import { cathInterval, cathOut, refAtPath } from '../tools/controller';
import { TOOLS, toolStatus } from '../tools/tools';
import { $, esc, mmss, setHTML, setText } from './dom';
import { dialSVG, gaugeSVG } from './widgets';

export interface UIHandlers {
  selectTool(t: ToolId): void;
  setSize(d: number, l: number): void;
  measure(): void;
  heparin(): void;
  toggleSound(): void;
  toggleView(): void;
  togglePause(): void;
  toggleHelp(): void;
  endCase(): void;
  keepExploring(): void;
  newCase(): void;
}

export const CONTROLS: [string, string][] = [
  ['1–7', 'Tools: guide, wire, balloon, stent, contrast, fluoro, measure'],
  ['W / S, wheel', 'Advance / retract the active device (hold Shift for fine)'],
  ['A / D', 'Rotate the guide or wire tip'],
  ['E (hold) / Q', 'Inflate / deflate the balloon or stent (Shift = fine)'],
  ['G', 'Give heparin'],
  ['5 or C', 'Inject contrast'],
  ['Space or 6 (hold)', 'Live fluoroscopy'],
  ['Tab', 'Switch 3D / X-ray view'],
  ['V / arrow keys', 'C-arm presets / fine-tune angles'],
  ['F', 'Camera follows the device tip (3D)'],
  ['L', 'Anatomy labels'],
  ['H', 'This help'],
  ['M', 'Mentor panel'],
  ['N', 'Sound on/off'],
  ['Esc', 'Pause'],
  ['Drag / Ctrl+wheel', 'Orbit / zoom the 3D view'],
];

/** Sweeping ECG trace on a canvas. */
class EcgView {
  private ctx: CanvasRenderingContext2D;
  private x = 0;
  private lastY = 0;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.fillStyle = '#02060c';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  draw(st: SimState, dt: number): void {
    const { width: w, height: h } = this.canvas;
    const c = this.ctx;
    const speed = w / 3.2; // 3.2 s per sweep
    // Sub-sample the frame so narrow QRS complexes are never skipped.
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    let t = st.ecg.t - dt;
    for (let i = 0; i < steps; i++) {
      t += dt / steps;
      const tt = t < 0 ? t + st.ecg.rr : t;
      const v = ecgSample(tt, st.ecg.rr, st.phys.st, st.ecg.pvc && t >= 0);
      const y = h * 0.62 - v * h * 0.32;
      const nx = this.x + (speed * dt) / steps;
      if (nx >= w) {
        this.x = 0;
        this.lastY = y;
        continue;
      }
      c.fillStyle = '#02060c';
      c.fillRect(this.x + 1, 0, Math.min(14, w - this.x), h);
      c.strokeStyle = '#4ade80';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(this.x, this.lastY);
      c.lineTo(nx, y);
      c.stroke();
      this.x = nx;
      this.lastY = y;
    }
  }
}

export class UI {
  private ecg = new EcgView($('ecg') as HTMLCanvasElement);
  private lastStage = -1;
  private flashStage = -1;
  private shownMsgIds = new Set<number>();
  private msgEls: { el: HTMLElement; until: number }[] = [];
  mentorCollapsed = false;
  hoverText = '';

  constructor(private h: UIHandlers) {
    this.buildToolbar();
    $('hud-view').onclick = () => h.toggleView();
    $('hud-help').onclick = () => h.toggleHelp();
    $('hud-pause').onclick = () => h.togglePause();
    $('hud-end').onclick = () => h.endCase();
    $('v-heparin').onclick = () => h.heparin();
    $('v-sound').onclick = () => h.toggleSound();
    $('mentor-toggle').onclick = () => this.toggleMentor();
    $('btn-resume').onclick = () => h.togglePause();
    $('btn-help-close').onclick = () => h.toggleHelp();
    setHTML($('help-body'), `<dl>${CONTROLS.map(([k, d]) => `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`);
    // Delegated clicks for size chips and buttons inside the device panel.
    $('device').addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      if (t.dataset.d) h.setSize(Number(t.dataset.d), Number(t.dataset.cl));
      if (t.dataset.l) h.setSize(Number(t.dataset.cd), Number(t.dataset.l));
      if (t.dataset.act === 'qca') h.measure();
    });
  }

  toggleMentor(): void {
    this.mentorCollapsed = !this.mentorCollapsed;
    $('mentor').classList.toggle('collapsed', this.mentorCollapsed);
    setText($('mentor-toggle'), this.mentorCollapsed ? '+' : '–');
  }

  private buildToolbar(): void {
    const bar = $('toolbar');
    bar.innerHTML = TOOLS.map((t) => `<button data-tool="${t.id}" title="${esc(t.rules)}"><b>${t.label}</b><span class="k">${t.key}</span></button>`).join('');
    bar.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => this.h.selectTool((b as HTMLButtonElement).dataset.tool as ToolId)),
    );
  }

  /** Called every frame. Heavier DOM work is cheap thanks to setHTML diffing. */
  update(st: SimState, dt: number, demo: { active: boolean; narration: string } | null, soundOn: boolean): void {
    this.ecg.draw(st, dt);
    // HUD
    setText($('hud-view'), st.view === '3d' ? '3D' : 'X-ray');
    const on = imagingActive(st);
    const x = $('hud-xray');
    setText(x, on ? (imagingMode(st) === 'CINE' ? 'CINE' : 'X-RAY ON') : 'X-RAY OFF');
    x.classList.toggle('on', on);
    setText($('hud-fluoro'), mmss(st.fluoroTime));
    setText($('hud-contrast'), st.contrastMl.toFixed(0));

    // Vitals
    const p = st.phys;
    setText($('v-hr'), p.hr.toFixed(0));
    setText($('v-bp'), `${p.sys.toFixed(0)}/${p.dia.toFixed(0)}`);
    setText($('v-spo2'), p.spo2.toFixed(0));
    setText($('v-st'), `${p.st >= 0.05 ? '+' : ''}${p.st.toFixed(1)}`);
    $('v-st').className = p.st > 1 ? 'red' : 'green';
    setText($('v-act'), p.act.toFixed(0));
    setText($('v-heparin'), p.heparin ? 'Heparin given' : 'Heparin (G)');
    ($('v-heparin') as HTMLButtonElement).disabled = p.heparin;
    setText($('v-sound'), `Sound: ${soundOn ? 'on' : 'off'}`);
    $('v-alarm').classList.toggle('hidden', !p.alarm);

    // Checklist
    const cur = currentStage(st.stages.done);
    if (cur !== this.lastStage) {
      if (this.lastStage >= 0 && cur > this.lastStage) this.flashStage = this.lastStage;
      this.lastStage = cur;
    }
    setHTML(
      $('checklist'),
      `<h3>Procedure</h3>` +
        STAGES.map((s, i) => {
          const done = i < cur;
          const cls = `stage${done ? ' done' : ''}${i === cur ? ' current' : ''}${i === this.flashStage ? ' flash' : ''}`;
          const t = st.stages.completedAt[i];
          return `<div class="${cls}"><span class="num">${done ? '✓' : i + 1}</span><span class="t">${esc(s.title)}</span><span class="time">${t != null ? mmss(t) : ''}</span></div>`;
        }).join(''),
    );

    // Mentor
    const stage = STAGES[Math.min(cur, STAGES.length - 1)];
    $('mentor-badge').classList.toggle('hidden', !demo?.active);
    setText($('mentor-title'), cur >= STAGES.length ? 'Case complete' : `Step ${cur + 1} of 6 · ${stage.title}`);
    setText($('mentor-goal'), stage.goal);
    const done = st.stages.done[Math.min(cur, STAGES.length - 1)] ?? [];
    setHTML($('mentor-tasks'), stage.tasks.map((t, i) => `<li class="${done[i] ? 'ok' : ''}"><span class="box">${done[i] ? '☑' : '☐'}</span>${esc(t)}</li>`).join(''));
    const pct = done.length ? (done.filter(Boolean).length / done.length) * 100 : 100;
    ($('mentor-progress') as HTMLElement).style.width = `${cur >= STAGES.length ? 100 : pct}%`;
    setText($('mentor-hint'), demo?.active ? demo.narration : mentorHint(st));
    setText($('mentor-why-text'), stage.why);

    this.updateToolbar(st);
    this.updateDevice(st);
    this.updateMessages(st);
  }

  private updateToolbar(st: SimState): void {
    const ctx = toolContext(st);
    $('toolbar')
      .querySelectorAll('button')
      .forEach((b) => {
        const id = (b as HTMLButtonElement).dataset.tool as ToolId;
        const status = toolStatus(id, ctx);
        const def = TOOLS.find((t) => t.id === id)!;
        b.classList.toggle('sel', st.tool === id || (id === 'fluoro' && imagingActive(st)));
        b.classList.toggle('locked', !status.enabled);
        const title = status.enabled ? def.rules : `Locked: ${status.reason}`;
        if (b.getAttribute('title') !== title) b.setAttribute('title', title);
      });
  }

  private holdRow(kind: 'guide' | 'wire' | 'cath'): string {
    const b = (h: string, label: string) => `<button data-hold="${h}">${label}</button>`;
    let s = '<div class="hold-row">' + b('adv-', '◀ Back') + b('adv+', 'Fwd ▶');
    if (kind !== 'cath') s += b('rot-', '↺') + b('rot+', '↻');
    else s += b('infl', 'Inflate') + b('defl', 'Deflate');
    s += b('fine', 'Fine') + b('fluoro', 'Fluoro') + '</div>';
    return s;
  }

  private updateDevice(st: SimState): void {
    const el = $('device');
    const G = DEVICES.guide;
    let html = '';
    if (st.tool === 'guide') {
      const marks = [
        { angle: G.leftCusp, label: 'LEFT', color: '#4ade80', width: G.engageTolerance },
        { angle: G.rightCusp, label: 'RIGHT', color: '#ff7b7b', width: G.engageTolerance },
      ];
      html = `<h4>Guide catheter 6F <span class="muted">${st.guide.engaged ? 'engaged' : ''}</span></h4>
        <div class="dev-row">${dialSVG(st.guide.rot, marks)}
        <div class="dev-info"><div><span>Location</span><b>${esc(guideLocation(st))}</b></div>
        <div><span>Inserted</span><b>${st.guide.s.toFixed(0)} mm</b></div>
        <div><span>Tip rotation</span><b>${st.guide.rot.toFixed(0)}°</b></div></div></div>${this.holdRow('guide')}`;
    } else if (st.tool === 'wire') {
      const marks = [
        { angle: 0, label: 'LAD', color: '#4ade80', width: 25 },
        { angle: 180, label: 'LCx', color: '#ff7b7b', width: 40 },
        { angle: 90, label: 'Diag', color: '#ffc857', width: 50 },
      ];
      const w = st.wire;
      html = `<h4>Guidewire 0.014" <span class="muted">${esc(w.branches.join(' → '))}</span></h4>
        <div class="dev-row">${dialSVG(w.rot, marks)}
        <div class="dev-info"><div><span>Tip</span><b>${w.s.toFixed(0)} mm</b></div>
        <div><span>Next</span><b style="text-align:right">${esc(branchHint(st))}</b></div>
        <div><span>Resistance</span><b>${w.buckling ? 'BUCKLING' : w.resistance > 0.3 ? 'felt' : 'low'}</b></div>
        <div class="meter"><div style="width:${(w.resistance * 100).toFixed(0)}%"></div></div></div></div>${this.holdRow('wire')}`;
    } else if ((st.tool === 'balloon' || st.tool === 'stent') && st.cath.kind) {
      const c = st.cath;
      const spec = deviceSpec(c.kind!);
      const inGuide = c.s <= 0;
      const dChips = spec.diameters.map((d) => `<button data-d="${d}" data-cl="${c.length}" class="${d === c.diameter ? 'sel' : ''}" ${inGuide ? '' : 'disabled'}>Ø ${d}</button>`).join('');
      const lChips = spec.lengths.map((l) => `<button data-l="${l}" data-cd="${c.diameter}" class="${l === c.length ? 'sel' : ''}" ${inGuide ? '' : 'disabled'}>${l} mm</button>`).join('');
      const d = inflatedDiameter(c.kind!, c.diameter, c.pressure);
      const lesion = lesionPathRange();
      const onLAD = st.wire.branches[1] === 'LAD';
      const m = coverageMargins(cathInterval(st), lesion);
      const ref = cathOut(st) ? refAtPath(st, (cathInterval(st).s0 + cathInterval(st).s1) / 2) : 0;
      const timer = c.inflStart !== null ? `${(st.time - c.inflStart).toFixed(0)} s` : '–';
      const label = c.kind === 'balloon' ? 'Balloon (pre-dilation)' : c.stentOnBoard ? 'Drug-eluting stent' : 'Stent delivery balloon (post-dilate)';
      html = `<h4>${label} <span class="muted">${c.diameter} × ${c.length} mm${c.ruptured ? ' · RUPTURED' : ''}</span></h4>
        <div class="chips">${dChips}</div><div class="chips">${lChips}</div>
        <div class="dev-row">${gaugeSVG(c.pressure, spec.nominal, spec.rbp, rupturePressure(c.kind!))}
        <div class="dev-info"><div><span>Achieved Ø</span><b>${c.pressure > 0.05 ? d.toFixed(2) + ' mm' : '–'}</b></div>
        <div><span>Ref Ø here</span><b>${ref ? ref.toFixed(2) + ' mm' : '–'}</b></div>
        <div><span>Inflation</span><b>${timer}</b></div>
        <div><span>Position</span><b>${inGuide ? 'in guide' : onLAD ? `prox ${m.proximal.toFixed(1)} / dist ${m.distal.toFixed(1)} mm` : 'not in LAD'}</b></div></div></div>${this.holdRow('cath')}`;
    } else if (st.tool === 'measure') {
      const q = st.qca;
      html = `<h4>Measure (QCA)</h4>
        ${q ? `<table class="qca-table"><tr><td>Reference Ø</td><td>${q.referenceDiameter.toFixed(2)} mm</td></tr><tr><td>MLD</td><td>${q.mld.toFixed(2)} mm</td></tr><tr><td>% diameter stenosis</td><td>${q.percentDS.toFixed(0)}%</td></tr><tr><td>Lesion length</td><td>${q.lesionLength.toFixed(1)} mm</td></tr></table>` : '<p class="muted">Measure the mid-LAD lesion, or hover over a vessel in 3D for its diameter.</p>'}
        <button data-act="qca" class="primary">Measure lesion (QCA)</button>
        <p class="muted">${esc(this.hoverText || 'Hover a coronary in the 3D view to read its diameter.')}</p>`;
    } else {
      html = `<h4>${esc(TOOLS.find((t) => t.id === st.tool)?.label ?? '')}</h4><p class="muted">Pick a device with 1–4.</p>`;
    }
    setHTML(el, html);
  }

  private updateMessages(st: SimState): void {
    const box = $('messages');
    for (const m of st.messages) {
      if (this.shownMsgIds.has(m.id)) continue;
      this.shownMsgIds.add(m.id);
      const el = document.createElement('div');
      el.className = `msg ${m.level}`;
      el.textContent = m.text;
      box.appendChild(el);
      this.msgEls.push({ el, until: performance.now() + (m.level === 'danger' ? 7000 : 5000) });
    }
    const now = performance.now();
    while (this.msgEls.length > 3) this.msgEls.shift()!.el.remove();
    this.msgEls = this.msgEls.filter((x) => {
      if (x.until < now) {
        x.el.remove();
        return false;
      }
      return true;
    });
  }

  clearMessages(): void {
    for (const x of this.msgEls) x.el.remove();
    this.msgEls = [];
  }

  markMessagesSeen(st: SimState): void {
    for (const m of st.messages) this.shownMsgIds.add(m.id);
  }

  showDebrief(d: Debrief): void {
    const card = $('debrief-card');
    card.innerHTML = `<h1>Debrief</h1>
      <div class="score"><span class="n">${d.score}</span><span class="grade ${d.grade.split(' ')[0]}">${d.grade}</span></div>
      <p>${esc(d.headline)}</p>
      <ul class="items">${d.items
        .map((i) => `<li class="${i.status}"><div class="row"><span>${esc(i.label)}</span><span>${esc(i.value)}</span></div><p>${esc(i.teaching)}</p></li>`)
        .join('')}</ul>
      <p class="muted">Educational simulation only. Scores reflect this simplified model, not clinical competence.</p>
      <div class="start-buttons"><button id="btn-keep">Keep exploring</button><button id="btn-new" class="primary">New case</button></div>`;
    $('debrief').classList.remove('hidden');
    $('btn-keep').onclick = () => this.h.keepExploring();
    $('btn-new').onclick = () => this.h.newCase();
  }

  hideDebrief(): void {
    $('debrief').classList.add('hidden');
  }
}

export function lesionLabelPoint() {
  const a = getAnatomy();
  return a.vessels.get('LAD')!.path.pointAt(a.lesion.center);
}
