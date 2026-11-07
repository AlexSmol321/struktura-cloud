import { DIRECTIONS } from './seed.js';

export const DIRS = DIRECTIONS;

export const pointsOf = (volume) => Math.round((Number(volume) || 0) / 100);

const nf = new Intl.NumberFormat('ru-RU');

export function fmtNum(n) {
  return nf.format(Math.round(Number(n) || 0));
}

export function fmtMoney(n) {
  return `${fmtNum(n)} ₽`;
}

export function fmtCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1).replace('.', ',')} млн ₽`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)} тыс. ₽`;
  return fmtMoney(v);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function statusTone(status) {
  return {
    'Старт': 'start',
    'Партнёр': 'partner',
    'Серебро': 'silver',
    'Золото': 'gold',
    'Платина': 'platinum'
  }[status] || 'partner';
}

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildIndex(partners) {
  const byId = new Map(partners.map((p) => [p.id, p]));
  const children = new Map(partners.map((p) => [p.id, { A: null, B: null, C: null }]));
  for (const p of partners) {
    if (p.sponsor != null && children.has(p.sponsor) && p.dir && children.get(p.sponsor)[p.dir] === null) {
      children.get(p.sponsor)[p.dir] = p.id;
    }
  }
  return { byId, children };
}

// Сводка по ветке: партнёры, оборот, баллы, наборы — включая самого партнёра.
export function computeStats(rootId, idx) {
  const memo = new Map();

  function rec(id) {
    if (memo.has(id)) return memo.get(id);
    const p = idx.byId.get(id);
    if (!p) return null;
    const byDir = {};
    let below = 0, volumeBelow = 0, setsBelow = 0;
    for (const d of DIRS) {
      const cid = idx.children.get(id)[d];
      const sub = cid ? rec(cid) : null;
      byDir[d] = {
        id: cid,
        count: sub ? sub.count : 0,
        volume: sub ? sub.volume : 0,
        points: sub ? sub.points : 0,
        sets: sub ? sub.sets : 0
      };
      if (sub) {
        below += sub.count;
        volumeBelow += sub.volume;
        setsBelow += sub.sets;
      }
    }
    const personal = { volume: Number(p.volume) || 0, points: pointsOf(p.volume) };
    const res = {
      id,
      personal,
      byDir,
      count: below + 1,
      partnersBelow: below,
      volume: volumeBelow + personal.volume,
      volumeBelow,
      points: pointsOf(volumeBelow + personal.volume),
      sets: setsBelow + (Number(p.sets) || 0)
    };
    memo.set(id, res);
    return res;
  }

  return rec(rootId);
}

export function levelOf(id, ownerId, idx) {
  let cur = id;
  let level = 0;
  const seen = new Set();
  while (cur != null && cur !== ownerId) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const p = idx.byId.get(cur);
    if (!p) return null;
    cur = p.sponsor;
    level += 1;
    if (level > 100) return null;
  }
  return cur === ownerId ? level : null;
}

export function directionOf(id, ownerId, idx) {
  let cur = id;
  let lastDir = null;
  const seen = new Set();
  while (cur != null && cur !== ownerId) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const p = idx.byId.get(cur);
    if (!p) return null;
    lastDir = p.dir;
    cur = p.sponsor;
  }
  return cur === ownerId ? lastDir : null;
}

// Цепочка от владельца до партнёра (включая обоих).
export function pathTo(id, ownerId, idx) {
  const out = [];
  let cur = id;
  const seen = new Set();
  while (cur != null) {
    if (seen.has(cur)) return [];
    seen.add(cur);
    out.push(cur);
    if (cur === ownerId) break;
    const p = idx.byId.get(cur);
    cur = p ? p.sponsor : null;
  }
  return out.reverse();
}

// Куда встанет новичок: идём по выбранному направлению, пока место занято.
export function placementFor(sponsorId, dir, idx) {
  let cur = sponsorId;
  let hops = 0;
  while (idx.children.get(cur)?.[dir]) {
    cur = idx.children.get(cur)[dir];
    hops += 1;
    if (hops > 100) break;
  }
  return { parentId: cur, dir, hops };
}

export function searchPartners(query, partners, limit = 8) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const scored = [];
  for (const p of partners) {
    const name = p.name.toLowerCase();
    const phone = (p.phone || '').replace(/\D/g, '');
    const email = (p.email || '').toLowerCase();
    let score = 0;
    if (String(p.id) === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (digits.length >= 3 && phone.includes(digits)) score = 50;
    else if (email.includes(q)) score = 40;
    if (score) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'ru'));
  return scored.slice(0, limit).map((x) => x.p);
}

export function accountTotals(operations) {
  let accrued = 0, paid = 0, pending = 0, transfersOut = 0, transfersIn = 0;
  for (const op of operations) {
    const amount = Number(op.amount) || 0;
    if (op.type === 'accrual') accrued += amount;
    else if (op.type === 'payout') {
      if (op.status === 'pending') pending += amount;
      else paid += amount;
    } else if (op.type === 'transfer_out') transfersOut += amount;
    else if (op.type === 'transfer_in') transfersIn += amount;
  }
  const available = accrued + transfersIn - paid - pending - transfersOut;
  return { accrued, paid, pending, transfersOut, transfersIn, available };
}

export function lastAccrual(operations) {
  return operations
    .filter((o) => o.type === 'accrual')
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1) || null;
}

export function recentRegistrations(partners, days = 30) {
  const now = new Date(todayISO());
  return [...partners]
    .filter((p) => p.sponsor != null)
    .filter((p) => {
      const d = new Date(p.since);
      return (now - d) / 86400000 <= days;
    })
    .sort((a, b) => b.since.localeCompare(a.since));
}

export function operationLabel(op) {
  return {
    accrual: 'Начисление',
    payout: 'Вывод средств',
    transfer_out: 'Перевод партнёру',
    transfer_in: 'Перевод от партнёра'
  }[op.type] || 'Операция';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
