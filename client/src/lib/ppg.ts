/**
 * Camera photoplethysmography (PPG): a fingertip covering the rear camera + torch
 * turns red; every heartbeat slightly changes the blood volume and therefore the
 * mean red intensity. Pure functions here → unit-testable with synthetic signals.
 *
 * ⚠ The result is an ESTIMATE for triage support, not a medical measurement.
 */
export interface Sample {
  /** ms */
  t: number;
  /** mean red channel 0..255 */
  r: number;
  g: number;
  b: number;
}

export interface PulseEstimate {
  bpm: number;
  /** 0..1 — normalised autocorrelation peak (signal periodicity) */
  quality: number;
}

export const MIN_BPM = 40;
export const MAX_BPM = 180;
/** Below this periodicity the reading is rejected ("hold still / cover the lens"). */
export const MIN_QUALITY = 0.45;

/** Is the lens covered by a lit fingertip? (bright, strongly red-dominant frame) */
export function fingerDetected(s: Pick<Sample, 'r' | 'g' | 'b'>): boolean {
  return s.r > 90 && s.r > s.g * 1.6 && s.r > s.b * 1.6;
}

/** Resample to a uniform rate (camera frame timing jitters). */
function resample(samples: Sample[], hz: number): number[] {
  const out: number[] = [];
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  let j = 0;
  for (let t = t0; t <= t1; t += 1000 / hz) {
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[j + 1] ?? a;
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push(a.r + (b.r - a.r) * f);
  }
  return out;
}

function movingAverage(x: number[], w: number): number[] {
  const out = new Array<number>(x.length);
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < x.length; i++) {
    q.push(x[i]);
    sum += x[i];
    if (q.length > w) sum -= q.shift()!;
    out[i] = sum / q.length;
  }
  return out;
}

/** Detrend (remove slow baseline ~1 s) + light smoothing ≈ band-pass 0.7–4 Hz. */
export function filterSignal(x: number[], hz: number): number[] {
  const baseline = movingAverage(x, Math.round(hz));
  const detrended = x.map((v, i) => v - baseline[i]);
  const smooth = movingAverage(detrended, Math.max(1, Math.round(hz / 10)));
  // centred: drop the first second where the baseline is still settling
  return smooth.slice(Math.round(hz));
}

/**
 * Heart rate by autocorrelation: the lag with the strongest self-similarity
 * inside 40–180 bpm is the beat period. Parabolic interpolation refines it.
 */
export function estimatePulse(samples: Sample[], hz = 30): PulseEstimate | null {
  if (samples.length < 2 || samples[samples.length - 1].t - samples[0].t < 6000) return null;
  const x = filterSignal(resample(samples, hz), hz);
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
    ac.push(s / energy);
  }
  let best = -1;
  for (let lag = minLag; lag <= maxLag && lag < ac.length - 1; lag++) {
    // first strong local maximum wins (avoids picking 2× the period)
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
  return { bpm, quality: Math.max(0, Math.min(1, b)) };
}

/** Clinical-ish flag for the dispatcher (estimate!) — resting adult range. */
export const pulseAbnormal = (bpm: number) => bpm < 50 || bpm > 120;
