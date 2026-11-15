import type { RequestHandler } from 'express';
import type { LatencyStats } from '@shared/types';

const WINDOW_MS = 60_000;
const MAX_SAMPLES = 20_000;

/**
 * Rolling response-time tracker (Challenge Drop 3: "average latency < 300 ms under
 * mass requests"). Measures every /api request with a high-resolution clock;
 * statistics cover the last 60 s and are shown live on the dispatcher panel.
 */
export class LatencyTracker {
  private at: number[] = [];
  private ms: number[] = [];

  middleware(): RequestHandler {
    return (_req, res, next) => {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => this.record(Number(process.hrtime.bigint() - t0) / 1e6));
      next();
    };
  }

  record(ms: number) {
    this.at.push(Date.now());
    this.ms.push(ms);
    if (this.at.length > MAX_SAMPLES) {
      this.at.splice(0, this.at.length - MAX_SAMPLES);
      this.ms.splice(0, this.ms.length - MAX_SAMPLES);
    }
  }

  stats(): LatencyStats {
    const cut = Date.now() - WINDOW_MS;
    let i = 0;
    while (i < this.at.length && this.at[i] < cut) i++;
    if (i) {
      this.at.splice(0, i);
      this.ms.splice(0, i);
    }
    const n = this.ms.length;
    if (!n) return { count: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...this.ms].sort((a, b) => a - b);
    const avg = this.ms.reduce((s, v) => s + v, 0) / n;
    return { count: n, avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(sorted[Math.floor(n * 0.95)] * 10) / 10, maxMs: Math.round(sorted[n - 1] * 10) / 10 };
  }
}
