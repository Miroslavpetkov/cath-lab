/** Monitor sounds: QRS beep (pitch follows SpO2) and a two-tone alarm. Web Audio, unlocked by a click. */
export class MonitorAudio {
  private ctx: AudioContext | null = null;
  enabled = true;
  private alarmUntil = 0;

  unlock(): void {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  beep(spo2: number): void {
    const f = 880 - (100 - spo2) * 45;
    this.tone(f, 0.09, 0.08, 'sine');
  }

  /** Call every frame; plays the two-tone alarm while active. */
  alarm(active: boolean, now: number): void {
    if (!active || now < this.alarmUntil) return;
    this.alarmUntil = now + 1.4;
    this.tone(960, 0.18, 0.06, 'square');
    this.tone(720, 0.18, 0.06, 'square', 0.22);
  }
}
