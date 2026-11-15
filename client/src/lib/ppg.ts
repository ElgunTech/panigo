/**
 * Camera photoplethysmography (PPG): a fingertip covering the camera and lit by the
 * torch (or the screen, for the front camera) changes colour slightly with every
 * heartbeat. Pure functions here → unit-testable with synthetic signals.
 *
 * Real-phone lessons built in:
 *  - with the torch the RED channel often saturates (≈255) and becomes flat →
 *    we analyse red AND green and keep the channel with the clearer rhythm;
 *  - auto-exposure drifts the baseline → proper Butterworth band-pass (0.7–3.5 Hz);
 *  - a finger moving for a moment must not restart the measurement (hysteresis in UI).
 *
 * ⚠ The result is an ESTIMATE for triage support, not a medical measurement.
 */
export interface Sample {
  /** ms */
  t: number;
  /** mean channel values 0..255 */
  r: number;
  g: number;
  b: number;
}

export type Channel = 'r' | 'g';

export interface PulseEstimate {
  bpm: number;
  /** 0..1 — normalised autocorrelation peak (signal periodicity) */
  quality: number;
  channel: Channel;
}

export const MIN_BPM = 40;
export const MAX_BPM = 180;
/** Below this periodicity the reading is rejected (noise / movement). */
export const MIN_QUALITY = 0.3;
const HZ = 30;

/** Is the lens covered by a lit fingertip? Red-dominant and bright (tolerant: saturation, front camera). */
export function fingerDetected(s: Pick<Sample, 'r' | 'g' | 'b'>): boolean {
  return s.r > 100 && s.r >= s.g * 1.15 && s.r >= s.b * 1.15;
}

/** Resample one channel to a uniform rate (camera frame timing jitters / duplicates). */
function resample(samples: Sample[], ch: Channel, hz: number): number[] {
  const out: number[] = [];
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  let j = 0;
  for (let t = t0; t <= t1; t += 1000 / hz) {
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[j + 1] ?? a;
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push(a[ch] + (b[ch] - a[ch]) * f);
  }
  return out;
}

/** RBJ biquad (2nd-order Butterworth, Q = 1/√2). */
function biquad(x: number[], kind: 'lp' | 'hp', fc: number, fs: number): number[] {
  const w = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = kind === 'lp' ? 1 - cos : -(1 + cos);
  const b2 = b0;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const y = new Array<number>(x.length);
  let x1 = x[0];
  let x2 = x[0];
  let y1 = kind === 'lp' ? x[0] : 0;
  let y2 = y1;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Zero-phase band-pass 0.7–3.5 Hz (42–210 bpm): forward + backward pass. */
export function bandpass(x: number[], fs = HZ): number[] {
  const once = (v: number[]) => biquad(biquad(v, 'hp', 0.7, fs), 'lp', 3.5, fs);
  const f = once(x);
  return once(f.reverse()).reverse();
}

/** A channel stuck near the sensor ceiling carries no pulse information. */
function saturated(v: number[]): boolean {
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  return mean > 250 && sd < 0.6;
}

function estimateChannel(samples: Sample[], ch: Channel, hz: number): PulseEstimate | null {
  const raw = resample(samples, ch, hz);
  if (saturated(raw)) return null;
  // drop the first second (filter settling)
  const x = bandpass(raw, hz).slice(Math.round(hz));
  const n = x.length;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const y = x.map((v) => v - mean);
  const energy = y.reduce((s, v) => s + v * v, 0);
  if (energy < 1e-6) return null;

  const minLag = Math.floor((60 / MAX_BPM) * hz);
  const maxLag = Math.ceil((60 / MIN_BPM) * hz);
  const ac: number[] = [];
  for (let lag = 0; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += y[i] * y[i + lag];
    // unbiased: compensate fewer overlapping terms at larger lags
    ac.push((s / energy) * (n / (n - lag)));
  }
  let best = -1;
  for (let lag = minLag; lag <= maxLag && lag < ac.length - 1; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && (best < 0 || ac[lag] > ac[best] * 1.15)) {
      if (best < 0 || ac[lag] > ac[best]) best = lag;
    }
  }
  if (best < 0) return null;
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c)) || 0;
  const period = (best + Math.max(-0.5, Math.min(0.5, shift))) / hz;
  const bpm = Math.round(60 / period);
  if (bpm < MIN_BPM || bpm > MAX_BPM) return null;
  return { bpm, quality: Math.max(0, Math.min(1, b)), channel: ch };
}

/**
 * Heart rate by autocorrelation on the band-passed signal, evaluated on red and
 * green; the channel with the stronger periodicity wins.
 */
export function estimatePulse(samples: Sample[], hz = HZ): PulseEstimate | null {
  if (samples.length < 2 || samples[samples.length - 1].t - samples[0].t < 6000) return null;
  const cands = (['r', 'g'] as Channel[]).map((ch) => estimateChannel(samples, ch, hz)).filter((e): e is PulseEstimate => !!e);
  if (!cands.length) return null;
  return cands.sort((x, y) => y.quality - x.quality)[0];
}

/** Live diagnostics for the UI (helps tuning on real phones). */
export function signalStats(samples: Sample[]) {
  const last = samples.slice(-60);
  if (!last.length) return null;
  const avg = (k: Channel) => last.reduce((s, x) => s + x[k], 0) / last.length;
  const span = last.length > 1 ? (last[last.length - 1].t - last[0].t) / 1000 : 0;
  return { r: Math.round(avg('r')), g: Math.round(avg('g')), fps: span ? Math.round((last.length - 1) / span) : 0 };
}

/** Flag for the dispatcher (estimate!) — resting adult range. */
export const pulseAbnormal = (bpm: number) => bpm < 50 || bpm > 120;
