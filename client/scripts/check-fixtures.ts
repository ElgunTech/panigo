import fs from 'node:fs';
import { estimatePulse, estimatePulseRobust, ROBUST_MIN_QUALITY as MIN_QUALITY } from '../src/lib/ppg';

for (const f of fs.readdirSync('src/lib/__fixtures__')) {
  const r = JSON.parse(fs.readFileSync(`src/lib/__fixtures__/${f}`, 'utf8'));
  const s = r.samples.map((x: number[]) => ({ t: x[0], r: x[1], g: x[2], b: x[3] }));
  const plain = estimatePulse(s);
  const robust = estimatePulseRobust(s);
  console.log(f.padEnd(34), 'plain:', JSON.stringify(plain), '| robust:', JSON.stringify(robust), robust && robust.quality >= MIN_QUALITY ? 'ACCEPT' : 'REJECT');
}
