import { describe, expect, it } from 'vitest';
import { estimatePulse, fingerDetected, MIN_QUALITY, pulseAbnormal, type Sample } from './ppg';

/** Synthetic fingertip PPG: red baseline + heartbeat + breathing drift + noise + frame jitter. */
function synth(bpm: number, seconds = 20, noise = 1.2, seed = 7): Sample[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const out: Sample[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    const sec = t / 1000;
    const beat = Math.sin(2 * Math.PI * (bpm / 60) * sec) + 0.35 * Math.sin(4 * Math.PI * (bpm / 60) * sec + 0.6);
    const breath = 3 * Math.sin(2 * Math.PI * 0.25 * sec);
    out.push({ t, r: 190 + 2.5 * beat + breath + noise * rnd(), g: 40, b: 35 });
    t += 1000 / 30 + 6 * rnd(); // ~30 fps with jitter
  }
  return out;
}

describe('camera PPG pulse estimate', () => {
  for (const bpm of [48, 62, 75, 96, 128, 160]) {
    it(`recovers ${bpm} bpm within ±4`, () => {
      const r = estimatePulse(synth(bpm))!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.bpm - bpm)).toBeLessThanOrEqual(4);
      expect(r.quality).toBeGreaterThan(MIN_QUALITY);
    });
  }

  it('torch saturates RED at 255 → reads the pulse from GREEN', () => {
    const s = synth(84).map((x, i) => ({ ...x, r: 255, g: 120 + 1.5 * Math.sin(2 * Math.PI * 1.4 * (x.t / 1000)) + 0.6 * Math.sin(i * 7.31) }));
    const r = estimatePulse(s)!;
    expect(r).not.toBeNull();
    expect(r.channel).toBe('g');
    expect(Math.abs(r.bpm - 84)).toBeLessThanOrEqual(4);
  });

  it('weak real-world amplitude with auto-exposure drift is still measured', () => {
    const s = synth(70, 20, 1.0).map((x) => ({ ...x, r: 190 + 0.8 * Math.sin(2 * Math.PI * (70 / 60) * (x.t / 1000)) + 12 * (x.t / 20000) + 0.5 * Math.sin(x.t * 0.37) }));
    const r = estimatePulse(s)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.bpm - 70)).toBeLessThanOrEqual(4);
  });

  it('rejects pure noise (no finger / moving) with low quality or null', () => {
    const noise = synth(75, 20, 0).map((x, i) => ({ ...x, r: 190 + 8 * Math.sin(i * 12.9898) * Math.cos(i * 78.233) }));
    const r = estimatePulse(noise);
    expect(r === null || r.quality < MIN_QUALITY).toBe(true);
  });

  it('needs at least ~6 s of signal', () => {
    expect(estimatePulse(synth(75, 4))).toBeNull();
  });

  it('detects a fingertip on the lens (bright red) vs open camera', () => {
    expect(fingerDetected({ r: 200, g: 40, b: 30 })).toBe(true);
    expect(fingerDetected({ r: 120, g: 115, b: 110 })).toBe(false);
    expect(fingerDetected({ r: 255, g: 190, b: 120 })).toBe(true); // torch-saturated fingertip
  });

  it('flags abnormal resting pulse', () => {
    expect(pulseAbnormal(45)).toBe(true);
    expect(pulseAbnormal(80)).toBe(false);
    expect(pulseAbnormal(130)).toBe(true);
  });
});
