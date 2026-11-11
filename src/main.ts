import './style.css';
import { HEART } from './config/anatomy';
import { getAnatomy } from './anatomy/vessels';
import { MonitorAudio } from './audio/monitor';
import { debriefFor } from './procedure/debrief';
import { DemoController } from './procedure/demo';
import {
  cyclePreset,
  endCase,
  giveHeparin,
  inject,
  lumenDiameter,
  measureQCA,
  selectTool,
  setCathSize,
  setProjection,
  stepSim,
} from './procedure/sim';
import { createState, emit, store, ToolId } from './state/store';
import { NO_INPUT, SimInput } from './tools/controller';
import { World } from './scene/world';
import { $ } from './ui/dom';
import { UI } from './ui/ui';

const canvas = $('view') as HTMLCanvasElement;
const world = new World(canvas);
const audio = new MonitorAudio();
let demo: DemoController | null = null;
let started = false;
let paused = false;
let follow = false;
let labelsOn = true;
let debriefShown = false;
let ignoreInputUntil = 0;
let pendingWheel = 0;
const keys = new Set<string>();
const holds = new Set<string>();

const TOOL_KEYS: Record<string, ToolId> = { Digit1: 'guide', Digit2: 'wire', Digit3: 'balloon', Digit4: 'stent', Digit7: 'measure' };
const st = () => store.state;

const ui = new UI({
  selectTool: (t) => chooseTool(t),
  setSize: (d, l) => setCathSize(st(), d, l),
  measure: () => measureQCA(st()),
  heparin: () => giveHeparin(st()),
  toggleSound: () => (audio.enabled = !audio.enabled),
  toggleView: () => toggleView(),
  togglePause: () => setPaused(!paused),
  toggleHelp: () => $('help').classList.toggle('hidden'),
  endCase: () => endCase(st()),
  keepExploring: () => {
    st().ended = false;
    st().flags.keepExploring = true;
    debriefShown = false;
    ui.hideDebrief();
  },
  newCase: () => newCase(),
});

if (window.innerWidth < 820) ui.toggleMentor();

function chooseTool(t: ToolId): void {
  if (t === 'fluoro') return;
  const before = st().tool;
  if (selectTool(st(), t) && t !== before) autoZoom(t);
}

function autoZoom(t: ToolId): void {
  const a = getAnatomy();
  if (t === 'wire' || t === 'balloon' || t === 'stent' || t === 'measure') world.focus(a.vessels.get('LAD')!.path.pointAt(a.lesion.center), 150);
  else if (t === 'guide') world.focus({ x: HEART.center.x - 60, y: HEART.center.y + 40, z: 0 }, 520);
}

function toggleView(): void {
  st().view = st().view === '3d' ? 'fluoro' : '3d';
}

function setPaused(p: boolean): void {
  paused = p;
  $('pause').classList.toggle('hidden', !paused);
}

function newCase(): void {
  store.state = createState((Date.now() & 0xffff) + 1);
  demo = null;
  debriefShown = false;
  world.resetImage();
  ui.hideDebrief();
  ui.clearMessages();
  autoZoom('guide');
  emit();
}

function start(withDemo: boolean): void {
  audio.unlock();
  $('start').classList.add('hidden');
  started = true;
  ignoreInputUntil = performance.now() + 400;
  if (withDemo) demo = new DemoController();
  autoZoom('guide');
}

$('btn-enter').onclick = () => start(false);
$('btn-demo').onclick = () => start(true);

/** Any user input takes control back from the demo. */
function userTookOver(): void {
  if (!demo?.active || performance.now() < ignoreInputUntil) return;
  demo.active = false;
  st().messages.push({ id: st().nextMsgId++, text: 'Demo stopped. You have control from here.', level: 'info', time: st().time });
}

window.addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'Escape') {
    setPaused(!paused);
    return;
  }
  if (e.repeat) {
    keys.add(e.code);
    return;
  }
  userTookOver();
  keys.add(e.code);
  const s = st();
  if (TOOL_KEYS[e.code]) chooseTool(TOOL_KEYS[e.code]);
  switch (e.code) {
    case 'Digit5':
    case 'KeyC':
      if (inject(s)) s.view = 'fluoro';
      break;
    case 'KeyG':
      giveHeparin(s);
      break;
    case 'Tab':
      toggleView();
      break;
    case 'KeyV':
      cyclePreset(s);
      break;
    case 'ArrowLeft':
      setProjection(s, s.fluoro.projection.lao - 5, s.fluoro.projection.cran);
      break;
    case 'ArrowRight':
      setProjection(s, s.fluoro.projection.lao + 5, s.fluoro.projection.cran);
      break;
    case 'ArrowUp':
      setProjection(s, s.fluoro.projection.lao, s.fluoro.projection.cran + 5);
      break;
    case 'ArrowDown':
      setProjection(s, s.fluoro.projection.lao, s.fluoro.projection.cran - 5);
      break;
    case 'KeyF':
      follow = !follow;
      break;
    case 'KeyL':
      labelsOn = !labelsOn;
      break;
    case 'KeyH':
      $('help').classList.toggle('hidden');
      break;
    case 'KeyM':
      ui.toggleMentor();
      break;
    case 'KeyN':
      audio.enabled = !audio.enabled;
      break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  holds.clear();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!started) return;
    e.preventDefault();
    userTookOver();
    if (e.ctrlKey) world.zoom(e.deltaY > 0 ? 1.1 : 0.9);
    else pendingWheel += (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 3);
  },
  { passive: false },
);
canvas.addEventListener('pointerdown', () => started && userTookOver());
canvas.addEventListener('click', () => {
  if (st().tool === 'measure' && hoverPick?.vessel === 'LAD') measureQCA(st());
});

// Hold buttons in the device panel (mouse / touch).
const device = $('device');
device.addEventListener('pointerdown', (e) => {
  const b = (e.target as HTMLElement).closest('[data-hold]') as HTMLElement | null;
  userTookOver();
  if (!b) return;
  e.preventDefault();
  if (b.dataset.hold === 'fine') {
    holds.has('fine') ? holds.delete('fine') : holds.add('fine');
    return;
  }
  holds.add(b.dataset.hold!);
});
window.addEventListener('pointerup', () => {
  const fine = holds.has('fine');
  holds.clear();
  if (fine) holds.add('fine');
});
$('toolbar').addEventListener('pointerdown', (e) => {
  userTookOver();
  const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (b?.dataset.tool === 'fluoro') holds.add('fluoro');
});

function userInput(): SimInput {
  const k = (c: string) => keys.has(c);
  const fine = k('ShiftLeft') || k('ShiftRight') || holds.has('fine');
  let advance = (k('KeyW') || holds.has('adv+') ? 1 : 0) - (k('KeyS') || holds.has('adv-') ? 1 : 0);
  if (advance === 0 && pendingWheel !== 0) advance = Math.sign(pendingWheel);
  return {
    advance,
    fine,
    rotate: (k('KeyD') || holds.has('rot+') ? 1 : 0) - (k('KeyA') || holds.has('rot-') ? 1 : 0),
    inflate: k('KeyE') || holds.has('infl'),
    deflate: k('KeyQ') || holds.has('defl'),
    fluoro: k('Space') || k('Digit6') || holds.has('fluoro'),
  };
}

// Labels.
const labelBox = $('labels');
const labelEls = world.labels.map((l) => {
  const el = document.createElement('div');
  el.className = `label${l.text.includes('lesion') ? ' lesion' : ''}`;
  el.textContent = l.text;
  el.title = l.desc;
  labelBox.appendChild(el);
  return el;
});
let frame = 0;
function updateLabels(w: number, h: number): void {
  const show = labelsOn && st().view === '3d' && started;
  labelBox.classList.toggle('hidden', !show);
  if (!show) return;
  world.labels.forEach((l, i) => {
    const p = world.project(l.pos, w, h);
    const el = labelEls[i];
    el.style.display = p.visible ? '' : 'none';
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    if (frame % 8 === i % 8) el.classList.toggle('dim', world.occludedByHeart(l.pos));
  });
}

// Hover diameter readout with the measure tool.
let hoverPick: { vessel: string; s: number } | null = null;
let mouse = { x: 0, y: 0, inside: false };
canvas.addEventListener('pointermove', (e) => (mouse = { x: e.clientX, y: e.clientY, inside: true }));
canvas.addEventListener('pointerleave', () => (mouse.inside = false));
function updateHover(w: number, h: number): void {
  const el = $('hover-readout');
  if (st().tool !== 'measure' || st().view !== '3d' || !mouse.inside) {
    el.classList.add('hidden');
    hoverPick = null;
    return;
  }
  hoverPick = world.pick((mouse.x / w) * 2 - 1, -(mouse.y / h) * 2 + 1);
  if (!hoverPick) {
    el.classList.add('hidden');
    ui.hoverText = '';
    return;
  }
  const v = getAnatomy().vessels.get(hoverPick.vessel)!;
  const d = lumenDiameter(st(), hoverPick.vessel, hoverPick.s);
  const text = `${v.name} @ ${hoverPick.s.toFixed(0)} mm: Ø ${d.toFixed(2)} mm (ref ${v.ref(hoverPick.s).toFixed(2)})${hoverPick.vessel === 'LAD' ? ' · click to run QCA' : ''}`;
  ui.hoverText = text;
  el.textContent = text;
  el.style.left = `${Math.min(w - 260, mouse.x + 14)}px`;
  el.style.top = `${mouse.y + 14}px`;
  el.classList.remove('hidden');
}

// Cursors per tool.
const cursorSvg = (label: string, color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><circle cx='14' cy='14' r='9' fill='none' stroke='${color}' stroke-width='2'/><circle cx='14' cy='14' r='1.6' fill='${color}'/><text x='22' y='9' font-size='9' font-family='sans-serif' fill='${color}'>${label}</text></svg>`)}") 14 14, crosshair`;
const CURSORS: Record<string, string> = {
  guide: cursorSvg('G', '#e8eef5'),
  wire: cursorSvg('W', '#f5c542'),
  balloon: cursorSvg('B', '#f4d03f'),
  stent: cursorSvg('S', '#dfe6ee'),
  measure: cursorSvg('Ø', '#4cc2ff'),
};

function resize(): void {
  world.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let lastBeat = 0;
let lastInjections = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame++;
  const s = st();
  if (started && !paused && !s.ended) {
    let input: SimInput = NO_INPUT;
    if (demo?.active) input = demo.update(s, dt);
    else input = userInput();
    if (pendingWheel !== 0 && !demo?.active) {
      pendingWheel -= Math.sign(pendingWheel) * Math.min(Math.abs(pendingWheel), dt * 20);
      if (Math.abs(pendingWheel) < 0.05) pendingWheel = 0;
    }
    stepSim(s, input, dt);
    // Switch to X-ray when a cine run starts; the demo returns to 3D afterwards.
    if (s.injections.length !== lastInjections) {
      lastInjections = s.injections.length;
      s.view = 'fluoro';
    }
    if (demo?.active && s.view === 'fluoro' && s.time > s.fluoro.cineUntil + 0.8 && !s.fluoro.pedal) s.view = '3d';
    if (demo?.active && s.tool !== (demo as DemoController & { _tool?: string })._tool) {
      (demo as DemoController & { _tool?: string })._tool = s.tool;
      autoZoom(s.tool);
    }
    if (s.ecg.beats !== lastBeat) {
      lastBeat = s.ecg.beats;
      audio.beep(s.phys.spo2);
    }
    audio.alarm(s.phys.alarm, now / 1000);
  }
  if (s.ended && !debriefShown) {
    debriefShown = true;
    ui.showDebrief(debriefFor(s));
  }
  world.update(s, started && !paused ? dt : 0, follow);
  world.render(s);
  const w = window.innerWidth;
  const h = window.innerHeight;
  updateLabels(w, h);
  updateHover(w, h);
  canvas.style.cursor = s.view === '3d' ? CURSORS[s.tool] ?? 'default' : 'default';
  // Fluoro overlay text.
  const fo = $('fluoro-overlay');
  fo.classList.toggle('hidden', s.view !== 'fluoro');
  if (s.view === 'fluoro') {
    $('fo-proj').textContent = s.fluoro.projection.name;
    const mode = s.time < s.fluoro.cineUntil ? 'CINE' : s.fluoro.pedal ? 'FLUORO' : s.fluoro.everImaged ? 'LIH' : 'NO IMAGE';
    const m = $('fo-mode');
    m.textContent = mode;
    m.className = mode === 'CINE' ? 'cine' : '';
    $('fo-fps').textContent = mode === 'CINE' || mode === 'FLUORO' ? '15 fps' : '';
    $('fo-info').textContent = mode === 'NO IMAGE' ? 'Hold Space for fluoro or press C to inject' : `Fluoro ${Math.floor(s.fluoroTime / 60)}:${String(Math.floor(s.fluoroTime % 60)).padStart(2, '0')} · contrast ${s.contrastMl} ml`;
  }
  if (started) ui.update(s, dt, demo ? { active: demo.active, narration: demo.narration } : null, audio.enabled);
}
requestAnimationFrame(loop);

// Expose for debugging in the console.
(window as unknown as { cathlab: unknown }).cathlab = { store, world };
