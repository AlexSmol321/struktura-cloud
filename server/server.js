import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSeed } from '../public/js/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 8082);
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, record) {
  const actual = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function seedDb() {
  const workspace = createSeed();
  workspace.meta = { ...workspace.meta, savedAt: new Date().toISOString() };
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    workspace,
    users: [
      { id: 'u-owner', email: 'owner@demo.ru', name: 'Волков Дмитрий', role: 'owner', partnerId: 100001, password: hashPassword('demo1234') },
      { id: 'u-partner', email: 'partner@demo.ru', name: 'Иванова Мария', role: 'partner', partnerId: 100002, password: hashPassword('demo1234') }
    ]
  };
}

function readDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = seedDb();
    writeDb(db);
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

let db = readDb();
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  const user = db.users.find((u) => u.id === session.userId);
  return user ? { sid, user } : null;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    partnerId: user.partnerId,
    readOnly: user.role !== 'owner'
  };
}

function subtreeIds(partners, rootId) {
  const children = new Map();
  for (const p of partners) {
    if (typeof p.sponsor !== 'number') continue;
    if (!children.has(p.sponsor)) children.set(p.sponsor, []);
    children.get(p.sponsor).push(p.id);
  }
  const ids = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const child of children.get(id) || []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
}

function stateFor(user) {
  const ws = db.workspace;
  if (user.role === 'owner') {
    return { user: publicUser(user), state: ws };
  }
  const ids = subtreeIds(ws.partners, user.partnerId);
  const partners = ws.partners.filter((p) => ids.has(p.id));
  const operations = ws.operations.filter((op) => typeof op.partnerId === 'number' && ids.has(op.partnerId));
  return {
    user: publicUser(user),
    state: {
      meta: { ...ws.meta },
      settings: { ...ws.settings, ownerId: user.partnerId },
      partners,
      operations
    }
  };
}

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers
  });
  res.end(payload);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Некорректный JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' || pathname === '/index.html'
    ? path.join(PUBLIC, 'index.html')
    : path.join(PUBLIC, pathname);
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== path.join(PUBLIC, 'index.html')) {
    return send(res, 403, 'Forbidden');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(filePath).toLowerCase();
  send(res, 200, fs.readFileSync(filePath), {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  });
}

function cookieHeader(sid) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`;
}

function requireAuth(req, res) {
  const auth = currentSession(req);
  if (!auth) {
    json(res, 401, { error: 'Требуется вход' });
    return null;
  }
  return auth;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, user.password)) {
      return json(res, 401, { error: 'Неверный e-mail или пароль' });
    }
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { userId: user.id, expires: Date.now() + SESSION_TTL });
    return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': cookieHeader(sid) });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    return json(res, 200, { ok: true }, {
      'Set-Cookie': 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
    });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return json(res, 200, { user: publicUser(auth.user) });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return json(res, 200, stateFor(auth.user));
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (auth.user.role !== 'owner') {
      return json(res, 403, { error: 'Только владелец может менять данные' });
    }
    const body = await readJson(req);
    const state = body.state;
    if (!state || !Array.isArray(state.partners) || !Array.isArray(state.operations) || !state.settings) {
      return json(res, 400, { error: 'Некорректные данные' });
    }
    if (!state.partners.some((p) => p && p.id === state.settings.ownerId)) {
      return json(res, 400, { error: 'Нет владельца структуры' });
    }
    db.workspace = {
      ...db.workspace,
      meta: { ...state.meta, savedAt: new Date().toISOString() },
      settings: state.settings,
      partners: state.partners,
      operations: state.operations
    };
    writeDb(db);
    return json(res, 200, { ok: true, savedAt: db.workspace.meta.savedAt });
  }

  return json(res, 404, { error: 'API не найден' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (pathname === '/login' || pathname === '/login.html') {
      return serveStatic(req, res, '/login.html');
    }

    const demo = pathname.match(/^\/demo\/(owner|partner)$/);
    if (demo) {
      const user = db.users.find((u) => u.role === demo[1]);
      if (!user) return send(res, 404, 'Demo user not found');
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, { userId: user.id, expires: Date.now() + SESSION_TTL });
      return send(res, 302, '', { Location: `/${url.search}`, 'Set-Cookie': cookieHeader(sid) });
    }

    if (pathname === '/' || pathname === '/index.html') {
      const auth = currentSession(req);
      if (!auth) {
        return send(res, 302, '', { Location: '/login' });
      }
      return serveStatic(req, res, '/index.html');
    }

    if (pathname === '/health') {
      return json(res, 200, { ok: true });
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    if (res.headersSent) return;
    return json(res, error.status || 500, { error: error.message || 'Ошибка сервера' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Структура Cloud: http://${HOST}:${PORT}`);
  console.log('Демо-владелец: owner@demo.ru / demo1234');
  console.log('Демо-партнёр:  partner@demo.ru / demo1234');
});
