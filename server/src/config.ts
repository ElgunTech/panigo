/** Centralised, env-driven configuration (12-factor). */
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export interface AppConfig {
  port: number;
  env: string;
  jwtSecret: string;
  jwtTtl: string;
  corsOrigins: string[];
  routingProviders: string[];
  osrmUrl: string;
  osrmTimeoutMs: number;
  dbFile: string | null;
  rateLimitPerMin: number;
  sosPerCitizenPerMin: number;
  broadcastIntervalMs: number;
  simulation: boolean;
  timeScale: number;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const e = process.env;
  const env = e.NODE_ENV ?? 'development';
  const cfg: AppConfig = {
    port: num(e.PORT, 4000),
    env,
    jwtSecret: e.JWT_SECRET ?? 'dev-only-secret-change-me',
    jwtTtl: e.JWT_TTL ?? '12h',
    corsOrigins: (e.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
    routingProviders: (e.ROUTING_PROVIDERS ?? 'osrm,simulated').split(',').map((s) => s.trim()),
    osrmUrl: e.OSRM_URL ?? 'https://router.project-osrm.org',
    osrmTimeoutMs: num(e.OSRM_TIMEOUT_MS, 2500),
    dbFile: e.DB_FILE === 'off' ? null : (e.DB_FILE ?? 'uce-events.db'),
    rateLimitPerMin: num(e.RATE_LIMIT_PER_MIN, 600),
    sosPerCitizenPerMin: num(e.SOS_PER_CITIZEN_PER_MIN, 6),
    broadcastIntervalMs: num(e.BROADCAST_INTERVAL_MS, 250),
    simulation: (e.SIMULATION ?? 'on') !== 'off',
    timeScale: num(e.TIME_SCALE, 4),
    ...overrides,
  };
  if (env === 'production' && cfg.jwtSecret.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must be set in production');
  }
  return cfg;
}
