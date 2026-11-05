/**
 * Momentum Cloud Sync — backend (Cloudflare Worker + D1), etap 1. Wywoływany z worker/index.ts.
 *
 * Model: jedno anonimowe konto = jeden losowy kod odzyskiwania (bez logowania).
 * Serwer przechowuje wyłącznie skrót SHA-256 kodu oraz najnowszą migawkę danych
 * urządzenia (cały namespace momentum.*), podzieloną na fragmenty, bo D1 ogranicza
 * pojedynczą wartość do 2 MB. Optymistyczna współbieżność: PUT wskazuje rewizję,
 * na której bazuje klient; nieaktualna baza => 409 i decyzja po stronie aplikacji.
 *
 * Darmowy plan Workers ma ~10 ms CPU na żądanie, dlatego serwer NIE parsuje dużych
 * migawek (JSON.parse/stringify) — tylko je tnie i skleja jako tekst. Pełną walidację
 * wykonuje aplikacja przed zastosowaniem danych.
 */

// ---------- Minimalne typy Cloudflare (bez dodatkowej zależności npm) ----------
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; [key: string]: unknown };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface SyncEnv {
  /** Baza D1 z wrangler.jsonc („d1_databases”, binding „DB”). Bez niej API odpowiada 503. */
  DB?: D1Database;
}

export interface SyncContext {
  waitUntil?(promise: Promise<unknown>): void;
}

// ---------- Protokół (musi zgadzać się z src/lib/cloudSync.ts) ----------
export const SYNC_FORMAT = 'momentum-sync';
export const SYNC_SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
/** ≤ 400 tys. znaków UTF-16 = maks. 1,2 MB w UTF-8, bezpiecznie poniżej limitu 2 MB na wartość w D1. */
const CHUNK_CHARS = 400_000;
const BODY_PREFIX = `{"format":"${SYNC_FORMAT}","schemaVersion":${SYNC_SCHEMA_VERSION},`;
/** Do tej wielkości pełny JSON.parse kosztuje ułamek milisekundy CPU; większe migawki sprawdzamy tylko pobieżnie. */
const FULL_VALIDATION_CHARS = 256 * 1024;
const ACCOUNTS_PER_IP_PER_DAY = 20;
const DAY_MS = 86_400_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sync_accounts (
    user_id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL DEFAULT 0,
    write_id TEXT,
    snapshot_size INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_snapshot_chunks (
    user_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, revision, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_rate_limits (
    bucket TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

interface AccountRow {
  user_id: string;
  revision: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Tabele powstają same przy pierwszym zapytaniu w danej instancji (bez ręcznych migracji).
const schemaReady = new WeakMap<D1Database, Promise<void>>();

export function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.batch(SCHEMA.map(sql => db.prepare(sql))).then(() => undefined);
    ready.catch(() => schemaReady.delete(db));
    schemaReady.set(db, ready);
  }
  return ready;
}

export function respond(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function respondRaw(body: string, status = 200): Response {
  return new Response(body, { status, headers: JSON_HEADERS });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return respond({ error, ...extra }, status, headers);
}

export function methodNotAllowed(allowed: string): Response {
  return fail(405, 'method-not-allowed', {}, { Allow: allowed });
}

/** Kod odzyskiwania: Crockford Base32 (wielkie litery i cyfry), znormalizowany przez aplikację. */
export function readSecret(request: Request): string | null {
  const match = /^Bearer\s+([0-9A-Z]{20,64})$/.exec((request.headers.get('Authorization') ?? '').trim());
  return match ? match[1] : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Dzienny limit na adres IP (np. zakładanie kont). Przechowujemy tylko skrót IP i dnia, nie sam adres. */
export async function consumeDailyQuota(db: D1Database, kind: string, request: Request, limit: number): Promise<boolean> {
  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const bucket = `${kind}:${(await sha256Hex(`${ip}|${new Date(now).toISOString().slice(0, 10)}`)).slice(0, 32)}`;
  const counter = await db.prepare(
    `INSERT INTO sync_rate_limits (bucket, hits, expires_at) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits`,
  ).bind(bucket, now + 2 * DAY_MS).first<{ hits: number }>();
  return (counter?.hits ?? 0) <= limit;
}

function parseRevision(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

/** Migawka: {"format":"momentum-sync","schemaVersion":1,…,"storage":{…}} — obiekt storage zawsze na końcu. */
function looksLikeSnapshot(body: string): boolean {
  if (!body.startsWith(BODY_PREFIX) || !body.endsWith('}}') || !body.includes('"storage":{')) return false;
  if (body.length > FULL_VALIDATION_CHARS) return true;
  try {
    const parsed: unknown = JSON.parse(body);
    const storage = (parsed as { storage?: unknown }).storage;
    return !!storage && typeof storage === 'object' && !Array.isArray(storage);
  } catch {
    return false;
  }
}

function findAccount(db: D1Database, keyHash: string): Promise<AccountRow | null> {
  return db.prepare(
    'SELECT user_id, revision, chunk_count, created_at, updated_at, last_seen_at FROM sync_accounts WHERE key_hash = ?1',
  ).bind(keyHash).first<AccountRow>();
}

function conflict(account: Pick<AccountRow, 'revision' | 'updated_at'>): Response {
  return fail(409, 'conflict', { revision: account.revision, updatedAt: account.updated_at });
}

/** Zakłada konto dla kodu (idempotentnie). Limit nowych kont na adres IP chroni darmowy limit D1. */
async function createAccount(db: D1Database, keyHash: string, request: Request): Promise<Response> {
  const existing = await findAccount(db, keyHash);
  if (existing) return respond({ userId: existing.user_id, revision: existing.revision, createdAt: existing.created_at, created: false });

  if (!await consumeDailyQuota(db, 'create', request, ACCOUNTS_PER_IP_PER_DAY)) return fail(429, 'rate-limited', {}, { 'Retry-After': '86400' });

  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  await db.batch([
    db.prepare('DELETE FROM sync_rate_limits WHERE expires_at < ?1').bind(now),
    db.prepare(
      `INSERT INTO sync_accounts (user_id, key_hash, revision, created_at, updated_at, last_seen_at)
       VALUES (?1, ?2, 0, ?3, ?3, ?3) ON CONFLICT(key_hash) DO NOTHING`,
    ).bind(crypto.randomUUID(), keyHash, timestamp),
  ]);
  const account = await findAccount(db, keyHash);
  if (!account) return fail(500, 'server-error');
  return respond({ userId: account.user_id, revision: account.revision, createdAt: account.created_at, created: true }, 201);
}

async function deleteAccount(db: D1Database, keyHash: string): Promise<Response> {
  const account = await findAccount(db, keyHash);
  if (!account) return fail(404, 'account-not-found');
  await db.batch([
    db.prepare('DELETE FROM sync_snapshot_chunks WHERE user_id = ?1').bind(account.user_id),
    db.prepare('DELETE FROM sync_accounts WHERE user_id = ?1').bind(account.user_id),
  ]);
  return respond({ deleted: true });
}

/** Zapisuje datę ostatniej aktywności najwyżej raz na dobę (bez zapisu przy każdym odpytaniu). */
function touchAccount(db: D1Database, account: AccountRow, context: SyncContext): void {
  const now = Date.now();
  const lastSeen = Date.parse(account.last_seen_at);
  if (Number.isFinite(lastSeen) && now - lastSeen < DAY_MS) return;
  const update = db.prepare('UPDATE sync_accounts SET last_seen_at = ?1 WHERE user_id = ?2')
    .bind(new Date(now).toISOString(), account.user_id).run().then(() => undefined, () => undefined);
  if (context.waitUntil) context.waitUntil(update);
}

async function getSnapshot(db: D1Database, keyHash: string, url: URL, context: SyncContext): Promise<Response> {
  const sinceParam = url.searchParams.get('since');
  const since = parseRevision(sinceParam);
  if (sinceParam !== null && since === null) return fail(400, 'invalid-revision');

  const account = await findAccount(db, keyHash);
  if (!account) return fail(404, 'account-not-found');
  touchAccount(db, account, context);
  if (since !== null && since === account.revision) {
    return respond({ revision: account.revision, updatedAt: account.updated_at, unchanged: true });
  }
  if (account.revision === 0) return respond({ revision: 0, updatedAt: null, snapshot: null });

  // Konto i fragmenty czytamy w jednej transakcji, aby równoległy PUT nie wymieszał rewizji.
  const [accountResult, chunkResult] = await db.batch([
    db.prepare('SELECT revision, updated_at, chunk_count FROM sync_accounts WHERE user_id = ?1').bind(account.user_id),
    db.prepare(
      `SELECT c.data AS data FROM sync_snapshot_chunks c
       JOIN sync_accounts a ON a.user_id = c.user_id AND a.revision = c.revision
       WHERE a.user_id = ?1 ORDER BY c.idx`,
    ).bind(account.user_id),
  ]);
  const current = accountResult?.results?.[0] as Pick<AccountRow, 'revision' | 'updated_at' | 'chunk_count'> | undefined;
  const chunks = (chunkResult?.results ?? []) as { data: string }[];
  if (!current) return fail(404, 'account-not-found');
  if (current.revision === 0) return respond({ revision: 0, updatedAt: null, snapshot: null });
  if (chunks.length === 0 || chunks.length !== current.chunk_count) return fail(500, 'snapshot-incomplete');

  // Bez JSON.parse: migawka jest już poprawnym JSON-em, więc tylko ją doklejamy.
  const head = `{"revision":${current.revision},"updatedAt":${JSON.stringify(current.updated_at)},"snapshot":`;
  return respondRaw(`${head}${chunks.map(chunk => chunk.data).join('')}}`);
}

async function putSnapshot(db: D1Database, keyHash: string, url: URL, request: Request): Promise<Response> {
  const base = parseRevision(url.searchParams.get('base'));
  if (base === null) return fail(400, 'invalid-revision');
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_SNAPSHOT_BYTES) return fail(413, 'too-large', { limit: MAX_SNAPSHOT_BYTES });

  const account = await findAccount(db, keyHash);
  if (!account) return fail(404, 'account-not-found');
  const body = await request.text();
  if (body.length > MAX_SNAPSHOT_BYTES) return fail(413, 'too-large', { limit: MAX_SNAPSHOT_BYTES });
  if (!looksLikeSnapshot(body)) return fail(400, 'invalid-snapshot');
  if (account.revision !== base) return conflict(account);

  const chunks: string[] = [];
  for (let offset = 0; offset < body.length; offset += CHUNK_CHARS) chunks.push(body.slice(offset, offset + CHUNK_CHARS));
  const revision = base + 1;
  const writeId = crypto.randomUUID();
  const now = new Date().toISOString();
  // Wstawienie fragmentów i sprzątanie starych wykonuje się tylko wtedy, gdy TEN zapis
  // podbił rewizję (write_id). Cały batch D1 jest jedną transakcją: wszystko albo nic.
  const ownsRevision = 'EXISTS (SELECT 1 FROM sync_accounts WHERE user_id = ?1 AND write_id = ?2)';
  const results = await db.batch([
    db.prepare(
      `UPDATE sync_accounts SET revision = ?1, write_id = ?2, snapshot_size = ?3, chunk_count = ?4,
       updated_at = ?5, last_seen_at = ?5 WHERE user_id = ?6 AND revision = ?7`,
    ).bind(revision, writeId, body.length, chunks.length, now, account.user_id, base),
    ...chunks.map((data, index) => db.prepare(
      `INSERT OR REPLACE INTO sync_snapshot_chunks (user_id, revision, idx, data)
       SELECT ?1, ?3, ?4, ?5 WHERE ${ownsRevision}`,
    ).bind(account.user_id, writeId, revision, index, data)),
    db.prepare(
      `DELETE FROM sync_snapshot_chunks WHERE user_id = ?1 AND revision <> ?3 AND ${ownsRevision}`,
    ).bind(account.user_id, writeId, revision),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const latest = await findAccount(db, keyHash);
    return latest ? conflict(latest) : fail(404, 'account-not-found');
  }
  return respond({ revision, updatedAt: now, size: body.length });
}

/** Jedyny punkt wejścia API: /api/health, /api/account (POST, DELETE), /api/snapshot (GET, PUT). */
export async function handleSyncRequest(request: Request, env: SyncEnv, context: SyncContext = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  const db = env.DB;

  if (path === '/api/health') {
    if (method !== 'GET') return methodNotAllowed('GET');
    if (!db) return fail(503, 'database-not-configured');
    try {
      await ensureSchema(db);
      return respond({ ok: true, version: SYNC_SCHEMA_VERSION });
    } catch (error) {
      console.error('[momentum-sync] health', error);
      return fail(503, 'database-unavailable');
    }
  }
  if (path !== '/api/account' && path !== '/api/snapshot') return fail(404, 'not-found');
  const allowed = path === '/api/account' ? ['POST', 'DELETE'] : ['GET', 'PUT'];
  if (!allowed.includes(method)) return methodNotAllowed(allowed.join(', '));
  if (!db) return fail(503, 'database-not-configured');
  const secret = readSecret(request);
  if (!secret) return fail(401, 'unauthorized');

  try {
    await ensureSchema(db);
    const keyHash = await sha256Hex(secret);
    if (path === '/api/account') {
      return method === 'POST' ? await createAccount(db, keyHash, request) : await deleteAccount(db, keyHash);
    }
    return method === 'GET' ? await getSnapshot(db, keyHash, url, context) : await putSnapshot(db, keyHash, url, request);
  } catch (error) {
    console.error('[momentum-sync]', error);
    return fail(500, 'server-error');
  }
}
