/**
 * Web Push bez zewnętrznych bibliotek (WebCrypto w Workerze):
 *  - szyfrowanie treści: RFC 8291 (Message Encryption for Web Push) + RFC 8188 (aes128gcm),
 *  - uwierzytelnienie serwera: VAPID (RFC 8292), JWT ES256.
 * Klucze VAPID generuje serwer sam (worker/push.ts) i trzyma w D1.
 */

const encoder = new TextEncoder();

export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export interface PushSubscriptionKeys {
  /** Klucz publiczny ECDH przeglądarki (P-256, 65 bajtów, base64url). */
  p256dh: string;
  /** Sekret uwierzytelniający (16 bajtów, base64url). */
  auth: string;
}

/** Szyfruje treść dla jednej subskrypcji (jeden rekord aes128gcm). `options` służą wyłącznie testom (wektory RFC). */
export async function encryptPushPayload(
  plaintext: Uint8Array<ArrayBuffer>, keys: PushSubscriptionKeys,
  options: { serverKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer> } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(keys.p256dh);
  const authSecret = base64UrlDecode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length < 16) throw new Error('Invalid subscription keys');
  const serverKeys = options.serverKeys
    ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));
  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(authSecret, ecdhSecret, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  // RFC 8188 §2.2–2.3
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Jedyny (ostatni) rekord: dane || 0x02 (ogranicznik końca, bez dodatkowego dopełnienia).
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidKeys {
  /** Klucz publiczny (65 bajtów, base64url) — przeglądarka podaje go jako applicationServerKey. */
  publicKey: string;
  privateJwk: JsonWebKey;
  /** „sub” w JWT: adres https aplikacji (wymagane m.in. przez Apple). */
  subject: string;
}

export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: base64UrlEncode(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    subject,
  };
}

const jwtCache = new Map<string, { token: string; expires: number }>();

/** Nagłówek Authorization: vapid t=<JWT ES256>, k=<klucz publiczny>. JWT ważny 12 h, ponownie używany w obrębie instancji. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const cacheKey = `${audience}|${keys.publicKey}`;
  const cached = jwtCache.get(cacheKey);
  if (cached && cached.expires - now > 60 * 60_000) return `vapid t=${cached.token}, k=${keys.publicKey}`;
  const expires = now + 12 * 60 * 60_000;
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(expires / 1000), sub: keys.subject })));
  const signingKey = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto zwraca podpis w formacie r||s (64 bajty) — dokładnie tak, jak wymaga JWS ES256.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(`${header}.${claims}`));
  const token = `${header}.${claims}.${base64UrlEncode(signature)}`;
  jwtCache.set(cacheKey, { token, expires });
  return `vapid t=${token}, k=${keys.publicKey}`;
}

export interface PushTarget extends PushSubscriptionKeys {
  endpoint: string;
}

export interface PushResult {
  status: number;
  ok: boolean;
  /** Subskrypcja wygasła lub została cofnięta (404/410) — urządzenie należy usunąć. */
  gone: boolean;
}

export async function sendWebPush(
  target: PushTarget, payload: unknown, vapid: VapidKeys,
  options: { ttl?: number; fetcher?: typeof fetch } = {},
): Promise<PushResult> {
  const body = await encryptPushPayload(encoder.encode(JSON.stringify(payload)), target);
  const response = await (options.fetcher ?? fetch)(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(Math.max(60, Math.round(options.ttl ?? 3600))),
      Urgency: 'high',
    },
    body,
  });
  try { await response.body?.cancel(); } catch { /* odpowiedź bez treści */ }
  return { status: response.status, ok: response.ok, gone: response.status === 404 || response.status === 410 };
}
