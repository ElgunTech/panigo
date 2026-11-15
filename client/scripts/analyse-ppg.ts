/**
 * Dev tool: analyse real phone/webcam PPG recordings captured by /api/citizen/ppg-debug.
 *   npx tsx scripts/analyse-ppg.ts ../server/ppg-recordings/<file>.json [...]
 */
import fs from 'node:fs';
import { bandpass, estimatePulse, type Sample } from '../src/lib/ppg';

function resample(seg: Sample[], k: 'r' | 'g', hz: number) {
  const out: number[] = [];
  let j = 0;
  for (let t = seg[0].t; t <= seg[seg.length - 1].t; t += 1000 / hz) {
    while (j < seg.length - 2 && seg[j + 1].t < t) j++;
    const a = seg[j];
    const b = seg[j + 1] ?? a;
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    out.push(a[k] + (b[k] - a[k]) * f);
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all: Sample[] = rec.samples.map((x: number[]) => ({ t: x[0], r: x[1], g: x[2], b: x[3] }));
  const mobile = /Android|iPhone|iPad/.test(rec.ua);
  console.log(`\n=== ${file.split(/[\\/]/).pop()} · ${mobile ? 'PHONE' : 'DESKTOP'} · ${rec.facing} · torch=${rec.torch} · ${rec.outcome}`);
  console.log(`UA: ${rec.ua}`);
  for (const from of [0, 2000, 4000, 6000]) {
    const seg = all.filter((s) => s.t >= from);
    if (seg.length > 50) console.log(`  estimate from ${from} ms →`, JSON.stringify(estimatePulse(seg)));
  }
  const seg = all.filter((s) => s.t >= 5000);
  if (seg.length < 60) continue;
  const hz = 20;
  for (const k of ['r', 'g'] as const) {
    const x = bandpass(resample(seg, k, hz), hz).slice(hz);
    const n = x.length;
    let best = 0;
    let bf = 0;
    for (let f = 0.7; f <= 3.5; f += 0.02) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        re += x[i] * Math.cos((2 * Math.PI * f * i) / hz);
        im += x[i] * Math.sin((2 * Math.PI * f * i) / hz);
      }
      const p = Math.hypot(re, im);
      if (p > best) {
        best = p;
        bf = f;
      }
    }
    const sd = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / n);
    console.log(`  ${k}: band-passed amplitude sd=${sd.toFixed(3)} · spectral peak ≈ ${Math.round(bf * 60)} bpm`);
  }
}
