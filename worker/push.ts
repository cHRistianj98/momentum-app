/**
 * Momentum — powiadomienia push z serwera (Web Push + Cloudflare Cron), także przy zamkniętej aplikacji.
 *
 * Aplikacja sama wylicza przypomnienia na najbliższe dni (tą samą logiką co lokalnie) i wysyła listę
 * „zadań wysyłki” (tag, czas, treść). Cron co minutę wysyła te, których czas nadszedł. Serwer nie musi
 * znać rutyn ani strefy czasowej użytkownika.
 *
 * Właściciel listy („owner”): konto synchronizacji (`acct:<id>`), gdy urządzenie je ma — wtedy zadanie
 * dodane na laptopie powiadomi też iPhone'a — albo samo urządzenie (`dev:<id>`).
 */
import {
  consumeDailyQuota, ensureSchema, fail, methodNotAllowed, readSecret, respond, sha256Hex,
  type D1Database, type D1PreparedStatement, type SyncContext, type SyncEnv,
} from './sync';
import { base64UrlDecode, generateVapidKeys, sendWebPush, type PushResult, type VapidKeys } from './webpush';

const DAY_MS = 86_400_000;
const MAX_JOBS = 150;
/** Przyjmujemy terminy do 15 dni naprzód (aplikacja wysyła 7). */
const JOB_HORIZON_MS = 15 * DAY_MS;
/** Przypomnienie spóźnione o ponad 30 min (np. po awarii) już nie jest wysyłane. */
const LATE_LIMIT_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
/** Zadań na jedno uruchomienie crona — reszta w kolejnej minucie (limit CPU darmowego planu). */
const SEND_BATCH = 20;
const DEVICES_PER_IP_PER_DAY = 20;
const TESTS_PER_IP_PER_DAY = 30;
/** Tylko znane usługi push (Apple, Google/Chrome, Mozilla, Microsoft) — serwer nie wyśle żądań w dowolne miejsce. */
const ALLOWED_PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com'];

const PUSH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_jwk TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS push_devices (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices (owner)',
  `CREATE TABLE IF NOT EXISTS push_jobs (
    owner TEXT NOT NULL,
    tag TEXT NOT NULL,
    fire_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    sent_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner, tag)
  )`,
  'CREATE INDEX IF NOT EXISTS push_jobs_due ON push_jobs (fire_at) WHERE sent_at IS NULL',
];

interface DeviceRow { id: string; owner: string; endpoint: string; p256dh: string; auth: string }
interface JobRow { owner: string; tag: string; fire_at: number; payload: string; attempts: number }
interface JobInput { tag: string; at: number; payload: string }
interface PushOptions { fetcher?: typeof fetch }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const schemaReady = new WeakMap<D1Database, Promise<void>>();
function ensurePushSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = ensureSchema(db).then(() => db.batch(PUSH_SCHEMA.map(sql => db.prepare(sql)))).then(() => undefined);
    ready.catch(() => schemaReady.delete(db));
    schemaReady.set(db, ready);
  }
  return ready;
}

// Klucze VAPID powstają same przy pierwszym użyciu i zostają w D1 na stałe (subskrypcje są z nimi związane).
const vapidCache = new WeakMap<D1Database, VapidKeys>();
async function loadVapid(db: D1Database, url?: URL): Promise<VapidKeys | null> {
  const cached = vapidCache.get(db);
  if (cached) return cached;
  const read = async (): Promise<VapidKeys | null> => {
    const row = await db.prepare('SELECT public_key, private_jwk, subject FROM push_config WHERE id = 1')
      .first<{ public_key: string; private_jwk: string; subject: string }>();
    return row ? { publicKey: row.public_key, privateJwk: JSON.parse(row.private_jwk) as JsonWebKey, subject: row.subject } : null;
  };
  let keys = await read();
  if (!keys && url) {
    const generated = await generateVapidKeys(`${url.protocol}//${url.host}`);
    await db.prepare('INSERT INTO push_config (id, public_key, private_jwk, subject, created_at) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING')
      .bind(generated.publicKey, JSON.stringify(generated.privateJwk), generated.subject, new Date().toISOString()).run();
    keys = await read();
  }
  if (keys) vapidCache.set(db, keys);
  return keys;
}

function allowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function parseSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!isRecord(body) || typeof body.endpoint !== 'string' || body.endpoint.length > 1024 || !isRecord(body.keys)) return null;
  const { p256dh, auth } = body.keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !allowedEndpoint(body.endpoint)) return null;
  try {
    const publicKey = base64UrlDecode(p256dh);
    if (publicKey.length !== 65 || publicKey[0] !== 4 || base64UrlDecode(auth).length < 16) return null;
  } catch {
    return null;
  }
  return { endpoint: body.endpoint, p256dh, auth };
}

function parseJobs(body: unknown, now: number): JobInput[] | null {
  if (!isRecord(body) || !Array.isArray(body.jobs) || body.jobs.length > MAX_JOBS) return null;
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
  const jobs: JobInput[] = [];
  const seen = new Set<string>();
  for (const job of body.jobs) {
    if (!isRecord(job) || typeof job.tag !== 'string' || !job.tag || job.tag.length > 200
      || typeof job.at !== 'number' || !Number.isFinite(job.at) || typeof job.title !== 'string' || typeof job.body !== 'string'
      || typeof job.url !== 'string' || !job.url.startsWith('/') || job.url.startsWith('//')) return null;
    if (job.at < now - 60 * 60_000 || job.at > now + JOB_HORIZON_MS || seen.has(job.tag)) continue;
    seen.add(job.tag);
    jobs.push({
      tag: job.tag,
      at: Math.round(job.at),
      payload: JSON.stringify({
        title: job.title.slice(0, 120), body: job.body.slice(0, 240), tag: job.tag, url: job.url.slice(0, 300),
        kind: job.kind === 'task' || job.kind === 'routine' ? job.kind : undefined,
        sourceId: text(job.sourceId, 120), occurrenceDate: text(job.occurrenceDate, 10),
        startAt: typeof job.startAt === 'number' && Number.isFinite(job.startAt) ? Math.round(job.startAt) : undefined,
      }),
    });
  }
  return jobs;
}

function findDevice(db: D1Database, keyHash: string): Promise<DeviceRow | null> {
  return db.prepare('SELECT id, owner, endpoint, p256dh, auth FROM push_devices WHERE key_hash = ?1').bind(keyHash).first<DeviceRow>();
}

function readAccountCode(request: Request): string | null {
  const value = (request.headers.get('X-Momentum-Account') ?? '').trim();
  return /^[0-9A-Z]{20,64}$/.test(value) ? value : null;
}

/** Kod urządzenia push albo kod konta synchronizacji (wtedy lista jest wspólna dla wszystkich urządzeń konta). */
async function resolveOwner(db: D1Database, keyHash: string): Promise<{ owner: string; deviceId: string | null } | null> {
  const device = await findDevice(db, keyHash);
  if (device) return { owner: device.owner, deviceId: device.id };
  const account = await db.prepare('SELECT user_id FROM sync_accounts WHERE key_hash = ?1').bind(keyHash).first<{ user_id: string }>();
  return account ? { owner: `acct:${account.user_id}`, deviceId: null } : null;
}

async function registerDevice(db: D1Database, keyHash: string, request: Request): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return fail(400, 'invalid-subscription'); }
  const subscription = parseSubscription(body);
  if (!subscription) return fail(400, 'invalid-subscription');
  let owner: string | null = null;
  const accountCode = readAccountCode(request);
  if (accountCode) {
    const account = await db.prepare('SELECT user_id FROM sync_accounts WHERE key_hash = ?1')
      .bind(await sha256Hex(accountCode)).first<{ user_id: string }>();
    if (account) owner = `acct:${account.user_id}`;
  }
  const existing = await findDevice(db, keyHash);
  if (!existing && !await consumeDailyQuota(db, 'push', request, DEVICES_PER_IP_PER_DAY)) {
    return fail(429, 'rate-limited', {}, { 'Retry-After': '86400' });
  }
  const id = existing?.id ?? crypto.randomUUID();
  owner ??= `dev:${id}`;
  const now = new Date().toISOString();
  const statements = [
    // Ta sama subskrypcja zapisana wcześniej pod innym kodem (np. po wyczyszczeniu danych aplikacji).
    db.prepare('DELETE FROM push_devices WHERE endpoint = ?1 AND key_hash <> ?2').bind(subscription.endpoint, keyHash),
    db.prepare(
      `INSERT INTO push_devices (id, key_hash, owner, endpoint, p256dh, auth, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(key_hash) DO UPDATE SET owner = excluded.owner, endpoint = excluded.endpoint, p256dh = excluded.p256dh,
       auth = excluded.auth, updated_at = excluded.updated_at`,
    ).bind(id, keyHash, owner, subscription.endpoint, subscription.p256dh, subscription.auth, now),
  ];
  if (existing && existing.owner !== owner && existing.owner.startsWith('dev:')) {
    statements.push(db.prepare('DELETE FROM push_jobs WHERE owner = ?1').bind(existing.owner));
  }
  await db.batch(statements);
  return respond({ ok: true, scope: owner.startsWith('acct:') ? 'account' : 'device' });
}

async function deleteDevice(db: D1Database, keyHash: string): Promise<Response> {
  const device = await findDevice(db, keyHash);
  if (!device) return fail(404, 'device-not-found');
  const statements = [db.prepare('DELETE FROM push_devices WHERE id = ?1').bind(device.id)];
  if (device.owner.startsWith('dev:')) statements.push(db.prepare('DELETE FROM push_jobs WHERE owner = ?1').bind(device.owner));
  await db.batch(statements);
  return respond({ deleted: true });
}

async function replaceSchedule(db: D1Database, keyHash: string, request: Request): Promise<Response> {
  const owner = await resolveOwner(db, keyHash);
  if (!owner) return fail(404, 'not-found');
  let body: unknown;
  try { body = await request.json(); } catch { return fail(400, 'invalid-schedule'); }
  const now = Date.now();
  const jobs = parseJobs(body, now);
  if (!jobs) return fail(400, 'invalid-schedule');
  const devices = (await db.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE owner = ?1').bind(owner.owner).first<{ n: number }>())?.n ?? 0;
  // Nikt z tego konta nie ma włączonych powiadomień z serwera — nic nie zapisujemy.
  if (devices === 0) return respond({ stored: 0, devices: 0 });
  const statements: D1PreparedStatement[] = [
    // Zastępujemy oczekujące; wysłane zostają (INSERT OR IGNORE nie wyśle ich drugi raz) aż do sprzątania.
    db.prepare('DELETE FROM push_jobs WHERE owner = ?1 AND (sent_at IS NULL OR fire_at < ?2)').bind(owner.owner, now - 3 * DAY_MS),
  ];
  for (let start = 0; start < jobs.length; start += 30) {
    const chunk = jobs.slice(start, start + 30);
    const values = chunk.map((_, index) => `(?1, ?${index * 3 + 2}, ?${index * 3 + 3}, ?${index * 3 + 4})`).join(', ');
    statements.push(db.prepare(`INSERT OR IGNORE INTO push_jobs (owner, tag, fire_at, payload) VALUES ${values}`)
      .bind(owner.owner, ...chunk.flatMap(job => [job.tag, job.at, job.payload])));
  }
  if (owner.deviceId) statements.push(db.prepare('UPDATE push_devices SET updated_at = ?1 WHERE id = ?2').bind(new Date(now).toISOString(), owner.deviceId));
  await db.batch(statements);
  return respond({ stored: jobs.length, devices });
}

async function sendTest(db: D1Database, keyHash: string, request: Request, url: URL, options: PushOptions): Promise<Response> {
  const device = await findDevice(db, keyHash);
  if (!device) return fail(404, 'device-not-found');
  if (!await consumeDailyQuota(db, 'pushtest', request, TESTS_PER_IP_PER_DAY)) return fail(429, 'rate-limited');
  const vapid = await loadVapid(db, url);
  if (!vapid) return fail(503, 'push-unavailable');
  const now = Date.now();
  const outcome = await sendWebPush(device, {
    title: 'Momentum · test z serwera', body: 'Tak przyjdą przypomnienia, gdy aplikacja jest zamknięta.', tag: `momentum-push-test-${now}`, url: '/',
  }, vapid, { ttl: 300, fetcher: options.fetcher }).catch((): PushResult => ({ status: 0, ok: false, gone: false }));
  if (outcome.gone) {
    await db.prepare('DELETE FROM push_devices WHERE id = ?1').bind(device.id).run();
    return fail(410, 'subscription-expired');
  }
  if (!outcome.ok) return fail(502, 'push-failed', { status: outcome.status });
  return respond({ ok: true });
}

/** /api/push/key (GET), /api/push/device (PUT, DELETE), /api/push/schedule (PUT), /api/push/test (POST). */
export async function handlePushRequest(request: Request, env: SyncEnv, _context: SyncContext = {}, options: PushOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  const routes: Record<string, string[]> = {
    '/api/push/key': ['GET'], '/api/push/device': ['PUT', 'DELETE'], '/api/push/schedule': ['PUT'], '/api/push/test': ['POST'],
  };
  const allowed = routes[path];
  if (!allowed) return fail(404, 'not-found');
  if (!allowed.includes(method)) return methodNotAllowed(allowed.join(', '));
  const db = env.DB;
  if (!db) return fail(503, 'database-not-configured');
  try {
    await ensurePushSchema(db);
    if (path === '/api/push/key') {
      const keys = await loadVapid(db, url);
      return keys ? respond({ publicKey: keys.publicKey }) : fail(503, 'push-unavailable');
    }
    const secret = readSecret(request);
    if (!secret) return fail(401, 'unauthorized');
    const keyHash = await sha256Hex(secret);
    if (path === '/api/push/device') return method === 'PUT' ? await registerDevice(db, keyHash, request) : await deleteDevice(db, keyHash);
    if (path === '/api/push/schedule') return await replaceSchedule(db, keyHash, request);
    return await sendTest(db, keyHash, request, url, options);
  } catch (error) {
    console.error('[momentum-push]', error);
    return fail(500, 'server-error');
  }
}

export interface PushRunResult { sent: number; failed: number; expired: number; removedDevices: number }

/** Cron (co minutę): wysyła przypomnienia, których czas nadszedł. */
export async function runPushQueue(env: SyncEnv, now = Date.now(), options: PushOptions = {}): Promise<PushRunResult> {
  const result: PushRunResult = { sent: 0, failed: 0, expired: 0, removedDevices: 0 };
  const db = env.DB;
  if (!db) return result;
  await ensurePushSchema(db);
  if (new Date(now).getUTCMinutes() === 0) await db.prepare('DELETE FROM push_jobs WHERE fire_at < ?1').bind(now - 3 * DAY_MS).run();
  const due = (await db.prepare(
    `SELECT owner, tag, fire_at, payload, attempts FROM push_jobs WHERE sent_at IS NULL AND fire_at <= ?1 ORDER BY fire_at LIMIT ${SEND_BATCH}`,
  ).bind(now).all<JobRow>()).results ?? [];
  if (!due.length) return result;

  const vapid = await loadVapid(db);
  const owners = [...new Set(due.map(job => job.owner))];
  const devices = (await db.prepare(
    `SELECT id, owner, endpoint, p256dh, auth FROM push_devices WHERE owner IN (${owners.map((_, index) => `?${index + 1}`).join(', ')})`,
  ).bind(...owners).all<DeviceRow>()).results ?? [];
  const gone = new Set<string>();
  const updates: D1PreparedStatement[] = [];
  const markSent = (job: JobRow) => db.prepare('UPDATE push_jobs SET sent_at = ?1 WHERE owner = ?2 AND tag = ?3').bind(now, job.owner, job.tag);

  await Promise.all(due.map(async job => {
    const targets = devices.filter(device => device.owner === job.owner);
    if (!vapid || targets.length === 0 || now - job.fire_at > LATE_LIMIT_MS) {
      updates.push(markSent(job));
      result.expired++;
      return;
    }
    let payload: { startAt?: number };
    try { payload = JSON.parse(job.payload) as { startAt?: number }; } catch { updates.push(markSent(job)); result.failed++; return; }
    // Push czeka w usłudze (np. telefon offline) najwyżej do 15 min po rozpoczęciu.
    const ttl = typeof payload.startAt === 'number' ? Math.min(DAY_MS / 1000, (payload.startAt + 15 * 60_000 - now) / 1000) : 3600;
    const outcomes = await Promise.all(targets.map(device => sendWebPush(device, payload, vapid, { ttl, fetcher: options.fetcher })
      .catch((): PushResult => ({ status: 0, ok: false, gone: false }))));
    outcomes.forEach((outcome, index) => { if (outcome.gone) gone.add(targets[index].id); });
    const delivered = outcomes.some(outcome => outcome.ok);
    const retryable = outcomes.some(outcome => !outcome.ok && !outcome.gone && (outcome.status === 0 || outcome.status === 429 || outcome.status >= 500));
    if (delivered || !retryable || job.attempts + 1 >= MAX_ATTEMPTS) {
      updates.push(markSent(job));
      if (delivered) result.sent++; else result.failed++;
    } else {
      updates.push(db.prepare('UPDATE push_jobs SET attempts = attempts + 1 WHERE owner = ?1 AND tag = ?2').bind(job.owner, job.tag));
    }
  }));
  for (const id of gone) updates.push(db.prepare('DELETE FROM push_devices WHERE id = ?1').bind(id));
  result.removedDevices = gone.size;
  if (updates.length) await db.batch(updates);
  return result;
}
