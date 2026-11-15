import type { LiveEvent } from '@shared/types';
import type { AuditEntry, Store } from '../services/store';

/**
 * Append-only persistent log (SQLite, built into Node ≥22 — zero native deps).
 * Every domain event and every operator decision (audit) is stored, which gives
 * traceability for post-incident analysis. Writes are batched in a single
 * transaction every second so that high SOS load does not hit the disk per event.
 */
export class EventLog {
  private queue: { kind: string; type: string; payload: string; at: number }[] = [];
  private timer?: NodeJS.Timeout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  static async open(file: string, store: Store): Promise<EventLog | null> {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const log = new EventLog();
      log.db = new DatabaseSync(file);
      log.db.exec(`
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, at);
      `);
      store.on('event', (e: LiveEvent) => {
        if (e.type === 'brigade.upsert' || e.type === 'system.status') return; // high-frequency telemetry, not persisted
        log.queue.push({ kind: 'event', type: e.type, payload: JSON.stringify(e.data), at: Date.now() });
      });
      store.on('audit', (a: AuditEntry) => log.queue.push({ kind: 'audit', type: a.action, payload: JSON.stringify(a), at: a.at }));
      log.timer = setInterval(() => log.flush(), 1000);
      log.timer.unref();
      return log;
    } catch (err) {
      console.warn('[eventlog] persistence disabled:', (err as Error).message);
      return null;
    }
  }

  flush() {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0);
    const stmt = this.db.prepare('INSERT INTO events (kind, type, payload, at) VALUES (?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const r of batch) stmt.run(r.kind, r.type, r.payload, r.at);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.error('[eventlog] flush failed', err);
    }
  }

  recentAudit(limit = 100): AuditEntry[] {
    const rows = this.db.prepare("SELECT payload FROM events WHERE kind = 'audit' ORDER BY id DESC LIMIT ?").all(limit) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload));
  }

  close() {
    clearInterval(this.timer);
    this.flush();
    this.db.close();
  }
}
