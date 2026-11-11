import type { ToolId } from '../state/store';

export interface ToolDef {
  id: ToolId;
  key: string;
  label: string;
  rules: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'guide', key: '1', label: 'Guide', rules: '6F guide catheter. W/S advance, A/D rotate the curved tip. Must face the left cusp to engage. Cannot move while the wire is out.' },
  { id: 'wire', key: '2', label: 'Wire', rules: '0.014" guidewire. A/D rotates the tip to choose branches. Cross the lesion slowly (Shift) or with gentle torque.' },
  { id: 'balloon', key: '3', label: 'Balloon', rules: 'Pre-dilation balloon over the wire. Pick a size while it is in the guide. Hold E to inflate, Q to deflate.' },
  { id: 'stent', key: '4', label: 'Stent', rules: 'Drug-eluting stent on a delivery balloon. Deploys permanently at ≥ 6 atm. Re-inflating inside it post-dilates.' },
  { id: 'contrast', key: '5', label: 'Contrast', rules: 'Inject contrast (C or 5). Selective when the guide is engaged, otherwise an aortic root flush.' },
  { id: 'fluoro', key: '6', label: 'Fluoro', rules: 'Hold Space (or 6) for live fluoroscopy. Releasing shows the last image hold.' },
  { id: 'measure', key: '7', label: 'Measure', rules: 'QCA: measures reference diameter, MLD, % stenosis and lesion length. Hover vessels in 3D for diameters.' },
];

export interface ToolContext {
  engaged: boolean;
  angiogramDone: boolean;
  heparin: boolean;
  wireDistal: boolean;
  predilated: boolean;
  cathKind: 'balloon' | 'stent' | null;
  cathOut: boolean;
}

export function toolStatus(tool: ToolId, c: ToolContext): { enabled: boolean; reason: string } {
  const ok = { enabled: true, reason: '' };
  switch (tool) {
    case 'wire':
      if (!c.engaged) return { enabled: false, reason: 'Engage the left main with the guide first.' };
      if (!c.angiogramDone) return { enabled: false, reason: 'Take a diagnostic angiogram before wiring.' };
      if (!c.heparin) return { enabled: false, reason: 'Give heparin (G) before the wire goes in.' };
      return ok;
    case 'balloon':
      if (!c.wireDistal) return { enabled: false, reason: 'Cross the lesion and park the wire distally first.' };
      if (c.cathOut && c.cathKind === 'stent') return { enabled: false, reason: 'Only one balloon catheter at a time: withdraw the stent catheter into the guide first.' };
      return ok;
    case 'stent':
      if (!c.predilated) return { enabled: false, reason: 'Pre-dilate the lesion with a balloon first.' };
      if (c.cathOut && c.cathKind === 'balloon') return { enabled: false, reason: 'Withdraw the balloon into the guide before loading a stent.' };
      return ok;
    default:
      return ok;
  }
}
