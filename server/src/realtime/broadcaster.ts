import type { Server } from 'socket.io';
import type { LiveEvent } from '@shared/types';
import { verifyToken } from '../security/auth';
import { can } from '../security/auth';
import type { Audience, Store } from '../services/store';

/**
 * Realtime fan-out with back-pressure: events are buffered per room and
 * flushed as one `batch` message every `intervalMs`. Upserts of the same
 * entity inside a window are coalesced (last write wins), so 1 000 SOS/s do
 * not become 1 000 socket frames per client.
 */
export class Broadcaster {
  private buffers = new Map<string, Map<string, LiveEvent>>();
  private timer: NodeJS.Timeout;
  sent = 0;

  constructor(
    private readonly io: Server,
    store: Store,
    jwtSecret: string,
    intervalMs: number,
  ) {
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;
      const p = token ? verifyToken(token, jwtSecret) : null;
      socket.data.user = p;
      next();
    });
    io.on('connection', (socket) => {
      socket.join('public');
      const u = socket.data.user;
      if (u && can(u.role, 'dashboard:read')) socket.join('dispatch');
      if (u && can(u.role, 'sos:create')) socket.join(`citizen:${u.sub}`);
    });

    store.on('event', (e: LiveEvent, a: Audience) => this.enqueue(roomOf(a), e));
    this.timer = setInterval(() => this.flush(), intervalMs);
    this.timer.unref();
  }

  private enqueue(room: string, e: LiveEvent) {
    let buf = this.buffers.get(room);
    if (!buf) this.buffers.set(room, (buf = new Map()));
    const id = 'id' in e.data ? (e.data as { id: string }).id : 'citizenId' in e.data ? (e.data as { citizenId: string }).citizenId : '';
    buf.set(`${e.type}:${id}`, e);
    // Public events are also relevant to dispatchers (they join both rooms) — no duplication needed.
  }

  flush() {
    for (const [room, buf] of this.buffers) {
      if (!buf.size) continue;
      this.io.to(room).emit('batch', [...buf.values()]);
      this.sent += buf.size;
      buf.clear();
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

function roomOf(a: Audience): string {
  if (a.kind === 'citizen') return `citizen:${a.citizenId}`;
  return a.kind;
}
