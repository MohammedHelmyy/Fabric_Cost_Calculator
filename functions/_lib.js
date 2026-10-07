import { importPKCS8, SignJWT } from 'jose';

const API = 'https://api.github.com';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export function text(message, status = 400, headers = {}) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

function requireEnv(env, keys) {
  const missing = keys.filter(key => !env[key]);
  if (missing.length) throw new Error(`Missing Cloudflare settings: ${missing.join(', ')}`);
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function derLength(length) {
  if (length < 128) return Uint8Array.of(length);
  const bytes = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 255);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag, content) {
  return concatBytes(Uint8Array.of(tag), derLength(content.length), content);
}

function pkcs8Pem(value) {
  const pem = value.replace(/\\n/g, '\n').trim();
  if (pem.startsWith('-----BEGIN PRIVATE KEY-----')) return pem;
  if (!pem.startsWith('-----BEGIN RSA PRIVATE KEY-----')) {
    throw new Error('GitHub App private key must be an RSA PEM key.');
  }

  const encoded = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const pkcs1 = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const algorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  const privateKeyInfo = der(0x30, concatBytes(Uint8Array.of(0x02, 0x01, 0x00), algorithm, der(0x04, pkcs1)));
  const base64 = btoa(Array.from(privateKeyInfo, byte => String.fromCharCode(byte)).join(''));
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
}

async function appJwt(env) {
  requireEnv(env, ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY']);
  const key = await importPKCS8(pkcs8Pem(env.GITHUB_APP_PRIVATE_KEY), 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
    .setIssuer(env.GITHUB_APP_ID)
    .setExpirationTime('9m')
    .sign(key);
}

let cachedInstallationToken;

async function installationToken(env) {
  requireEnv(env, ['GITHUB_INSTALLATION_ID']);
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60000) return cachedInstallationToken.value;
  const jwt = await appJwt(env);
  const response = await fetch(`${API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  });
  if (!response.ok) throw new Error(`GitHub could not issue an installation token (${response.status}).`);
  const result = await response.json();
  cachedInstallationToken = { value: result.token, expiresAt: Date.parse(result.expires_at) || Date.now() + 50 * 60 * 1000 };
  return cachedInstallationToken.value;
}

function repoPath(env) {
  requireEnv(env, ['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH']);
  return `${API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/settings.json?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
}

export async function readRepoSettings(env) {
  const token = await installationToken(env);
  const response = await fetch(repoPath(env), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  });
  if (!response.ok) throw new Error(`GitHub could not read settings.json (${response.status}).`);
  const file = await response.json();
  const content = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
  return { settings: JSON.parse(new TextDecoder().decode(content)), sha: file.sha };
}

export async function writeRepoSettings(env, settings, sha, login) {
  const token = await installationToken(env);
  const url = repoPath(env).split('?')[0];
  const bytes = new TextEncoder().encode(`${JSON.stringify(settings, null, 2)}\n`);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ message: `Update calculator settings by ${login}`, content: btoa(binary), sha, branch: env.GITHUB_BRANCH })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`GitHub could not publish settings (${response.status}): ${result.message || 'unknown error'}`);
  return { sha: result.content.sha, commit: result.commit.sha };
}

export function validateSettings(value) {
  const fail = message => ({ error: message });
  const isRecord = item => item && typeof item === 'object' && !Array.isArray(item);
  const validName = item => typeof item === 'string' && item.length <= 80;
  const validMoney = item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1000000000;
  const validId = item => (typeof item === 'string' && item.length > 0 && item.length <= 64) || (Number.isSafeInteger(item) && item >= 0);
  if (!isRecord(value)) return fail('Settings must be an object.');
  if (!Array.isArray(value.mats) || value.mats.length > 500) return fail('Fabric list is invalid or too large.');
  if (!Array.isArray(value.printMethods) || value.printMethods.length > 100) return fail('Print type list is invalid or too large.');
  if (!Array.isArray(value.extras) || value.extras.length > 100) return fail('Processing list is invalid or too large.');
  if (!validMoney(value.profit) || !validMoney(value.meters)) return fail('Profit or meter count is invalid.');

  const validateRows = (rows, fields, label) => {
    const ids = new Set();
    for (const row of rows) {
      if (!isRecord(row) || !validId(row.id) || !validName(row.name)) return `${label} contains an invalid name or ID.`;
      if (ids.has(String(row.id))) return `${label} IDs must be unique.`;
      ids.add(String(row.id));
      for (const field of fields) if (!validMoney(row[field])) return `${label} contains an invalid ${field}.`;
    }
    return null;
  };
  const matsError = validateRows(value.mats, ['cost', 'shrink'], 'Fabric list');
  if (matsError) return fail(matsError);
  if (value.mats.some(row => row.shrink > 90)) return fail('Fabric shrinkage cannot exceed 90%.');
  const printError = validateRows(value.printMethods, ['price'], 'Print type list');
  if (printError) return fail(printError);
  if (value.printMethods.some(row => String(row.id) === 'none')) return fail('A print type cannot use the reserved ID "none".');
  const extraError = validateRows(value.extras, ['price'], 'Processing list');
  if (extraError) return fail(extraError);
  if (!Array.isArray(value.selectedExtras) || value.selectedExtras.some(id => !value.extras.some(row => String(row.id) === String(id)))) {
    return fail('Selected processing references an item that does not exist.');
  }
  if (value.print !== 'none' && !value.printMethods.some(row => String(row.id) === String(value.print))) return fail('Selected print type does not exist.');
  if (value.sel !== 0 && !value.mats.some(row => row.id === value.sel)) return fail('Selected fabric does not exist.');

  return {
    version: 1,
    profit: value.profit,
    mats: value.mats.map(({ id, name, cost, shrink }) => ({ id, name, cost, shrink })),
    printMethods: value.printMethods.map(({ id, name, price }) => ({ id, name, price })),
    extras: value.extras.map(({ id, name, price }) => ({ id, name, price })),
    selectedExtras: value.selectedExtras,
    sel: value.sel,
    print: value.print,
    meters: value.meters,
    nextId: Number.isSafeInteger(value.nextId) && value.nextId > 0 ? value.nextId : 1,
    nextExtraId: Number.isSafeInteger(value.nextExtraId) && value.nextExtraId > 0 ? value.nextExtraId : 1,
    nextPrintId: Number.isSafeInteger(value.nextPrintId) && value.nextPrintId > 0 ? value.nextPrintId : 1
  };
}

function cookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const item = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function toBase64Url(value) {
  return btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
}

async function sessionKey(env) {
  requireEnv(env, ['SESSION_SECRET']);
  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters long.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSession(login, env) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ login, exp: Date.now() + 8 * 60 * 60 * 1000 })).reduce((out, byte) => out + String.fromCharCode(byte), ''));
  const key = await sessionKey(env);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return `${payload}.${toBase64Url(Array.from(signature, byte => String.fromCharCode(byte)).join(''))}`;
}

export async function verifySession(request, env) {
  const [payload, signature, extra] = cookie(request, 'calculator_session').split('.');
  if (!payload || !signature || extra) return null;
  try {
    const key = await sessionKey(env);
    const signatureBytes = Uint8Array.from(fromBase64Url(signature), char => char.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(payload))) return null;
    const decoded = Uint8Array.from(fromBase64Url(payload), char => char.charCodeAt(0));
    const session = JSON.parse(new TextDecoder().decode(decoded));
    return typeof session.login === 'string' && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function sessionCookie(value, maxAge = 8 * 60 * 60) {
  return `calculator_session=${encodeURIComponent(value)}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function isAllowed(login, env) {
  const allowed = (env.ALLOWED_GITHUB_USERS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(login.toLowerCase());
}

export function requiredEnv(env, keys) {
  requireEnv(env, keys);
}