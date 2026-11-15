import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { estimatePulse, estimatePulseRobust, ROBUST_MIN_QUALITY, settle, type Sample } from './ppg';

/**
 * Regression tests on REAL recordings collected during QA (per-frame mean colours only,
 * no images): an Android phone and a laptop, front camera with screen light, plus an
 * unlit webcam that must be rejected instead of producing a fake number.
 */
const load = (name: string): Sample[] =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')).samples.map((x: number[]) => ({ t: x[0], r: x[1], g: x[2], b: x[3] }));

describe('PPG on real device recordings', () => {
  it('Android phone, front camera + screen light → plausible pulse accepted', () => {
    const e = estimatePulseRobust(load('front-screenlight-android.json'))!;
    expect(e.quality).toBeGreaterThanOrEqual(ROBUST_MIN_QUALITY);
    expect(e.bpm).toBeGreaterThanOrEqual(50);
    expect(e.bpm).toBeLessThanOrEqual(100);
  });

  it('laptop, front camera + screen light → plausible pulse accepted', () => {
    const e = estimatePulseRobust(load('front-screenlight-laptop.json'))!;
    expect(e.quality).toBeGreaterThanOrEqual(ROBUST_MIN_QUALITY);
    expect(e.bpm).toBeGreaterThanOrEqual(50);
    expect(e.bpm).toBeLessThanOrEqual(100);
  });

  it('unlit webcam (no torch, no screen light) → rejected, no fake number', () => {
    const e = estimatePulseRobust(load('webcam-no-light-laptop.json'));
    expect(e === null || e.quality < ROBUST_MIN_QUALITY).toBe(true);
  });

  it('the old whole-window estimate failed on the phone recording (why settling + sliding windows exist)', () => {
    const plain = estimatePulse(load('front-screenlight-android.json'));
    expect(plain === null || plain.quality < 0.3).toBe(true);
    expect(settle(load('front-screenlight-android.json')).length).toBeGreaterThan(200);
  });
});
