/** Small SVG widgets: rotation dial and pressure gauge. */

export function dialSVG(rot: number, marks: { angle: number; label: string; color: string; width?: number }[]): string {
  const r = 34;
  const c = 40;
  const pt = (deg: number, rr: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
  };
  let s = `<svg viewBox="0 0 80 80" width="84" height="84" aria-label="Rotation dial ${rot.toFixed(0)} degrees">`;
  s += `<circle cx="${c}" cy="${c}" r="${r}" fill="#0b1426" stroke="#2c3b58" stroke-width="2"/>`;
  for (const m of marks) {
    const w = m.width ?? 20;
    const [x1, y1] = pt(m.angle - w, r);
    const [x2, y2] = pt(m.angle + w, r);
    s += `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" stroke="${m.color}" stroke-width="5" fill="none" opacity="0.8"/>`;
    const [lx, ly] = pt(m.angle, r - 12);
    s += `<text x="${lx}" y="${ly + 3}" font-size="8" fill="${m.color}" text-anchor="middle" font-weight="700">${m.label}</text>`;
  }
  const [nx, ny] = pt(rot, r - 4);
  s += `<line x1="${c}" y1="${c}" x2="${nx}" y2="${ny}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
  s += `<circle cx="${c}" cy="${c}" r="3" fill="#fff"/>`;
  s += `<text x="${c}" y="${c + 16}" font-size="8" fill="#94a3b8" text-anchor="middle">${rot.toFixed(0)}°</text></svg>`;
  return s;
}

export function gaugeSVG(p: number, nominal: number, rbp: number, rupture: number, max = 24): string {
  const c = 50;
  const r = 40;
  const ang = (v: number) => Math.PI + (Math.min(max, Math.max(0, v)) / max) * Math.PI;
  const pt = (v: number, rr: number) => [c + rr * Math.cos(ang(v)), 52 + rr * Math.sin(ang(v))];
  const arc = (v0: number, v1: number, color: string) => {
    const [x1, y1] = pt(v0, r);
    const [x2, y2] = pt(v1, r);
    return `<path d="M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}" stroke="${color}" stroke-width="6" fill="none"/>`;
  };
  let s = `<svg viewBox="0 0 100 62" width="120" height="74" aria-label="Pressure ${p.toFixed(1)} atm">`;
  s += arc(0, rbp, '#2f5f4a') + arc(rbp, rupture, '#7a5a1a') + arc(rupture, max, '#6b1d24');
  for (const [v, lab, col] of [[nominal, 'NOM', '#4ade80'], [rbp, 'RBP', '#ffc857']] as [number, string, string][]) {
    const [x1, y1] = pt(v, r - 6);
    const [x2, y2] = pt(v, r + 5);
    const [tx, ty] = pt(v, r - 14);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="2"/><text x="${tx}" y="${ty}" font-size="6" fill="${col}" text-anchor="middle">${lab}</text>`;
  }
  const [nx, ny] = pt(p, r - 3);
  s += `<line x1="${c}" y1="52" x2="${nx}" y2="${ny}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
  s += `<text x="${c}" y="48" font-size="11" fill="#fff" text-anchor="middle" font-weight="700">${p.toFixed(1)}</text>`;
  s += `<text x="${c}" y="60" font-size="6" fill="#94a3b8" text-anchor="middle">atm</text></svg>`;
  return s;
}
