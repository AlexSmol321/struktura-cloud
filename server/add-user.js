import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const [email, password, role = 'partner', partnerId] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node server/add-user.js <email> <password> <owner|partner> [partnerId]');
  process.exit(2);
}
if (!['owner', 'partner'].includes(role)) {
  console.error('Role must be owner or partner');
  process.exit(2);
}
if (role === 'partner' && !partnerId) {
  console.error('For a partner, partnerId is required (the partner node id)');
  process.exit(2);
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`No database at ${DB_FILE}. Start the server once to seed it.`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const user = {
  id: `u-${crypto.randomBytes(4).toString('hex')}`,
  email: email.trim().toLowerCase(),
  name: role === 'owner' ? 'Владелец' : `Партнёр ${partnerId}`,
  role,
  partnerId: role === 'owner' ? db.workspace.settings.ownerId : Number(partnerId),
  password: { salt, hash }
};
db.users = db.users.filter((u) => u.email.toLowerCase() !== user.email);
db.users.push(user);
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
console.log(`User ${user.email} (${user.role}, partnerId ${user.partnerId}) saved.`);
