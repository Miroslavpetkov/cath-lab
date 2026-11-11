/** Synthetic V2 lead: Gaussian P, Q, R, S, T waves with ST elevation and wide PVCs. Pure. */

const g = (t: number, mu: number, sigma: number, amp: number) => amp * Math.exp(-((t - mu) * (t - mu)) / (2 * sigma * sigma));

/**
 * ECG amplitude (mV) at time t (s) into a beat of length rr (s). stMm is ST elevation in mm
 * (1 mm = 0.1 mV). A PVC is a wide, bizarre QRS with no P wave and a discordant T.
 */
export function ecgSample(t: number, rr: number, stMm: number, pvc = false): number {
  const k = Math.min(1.15, Math.max(0.75, rr / 0.88)); // stretch intervals a little with rate
  const st = stMm * 0.1;
  if (pvc) {
    return g(t, 0.08, 0.045, 1.5) + g(t, 0.17, 0.04, -0.9) + g(t, 0.42 * k, 0.07, -0.45);
  }
  const p = g(t, 0.08 * k, 0.025, 0.12);
  const q = g(t, 0.2 * k, 0.008, -0.12);
  const r = g(t, 0.22 * k, 0.01, 1.35);
  const s = g(t, 0.24 * k, 0.01, -0.35);
  // ST segment: plateau from the J point into a taller T when ischaemic.
  const j = 0.25 * k;
  const tw = 0.42 * k;
  const stSeg = t > j && t < tw + 0.08 ? st * Math.min(1, (t - j) / 0.02) * (t < tw ? 1 : Math.max(0, 1 - (t - tw) / 0.08)) : 0;
  const tWave = g(t, tw, 0.05, 0.3 + st * 0.6);
  return p + q + r + s + stSeg + tWave;
}

/** Time of the R peak inside a beat (for the QRS beep). */
export function rPeakTime(rr: number): number {
  return 0.22 * Math.min(1.15, Math.max(0.75, rr / 0.88));
}
