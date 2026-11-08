// Облачная обвязка: пользователь, выход, режим «только просмотр».
const MUTATING = new Set(['add', 'transfer', 'withdraw', 'mark-paid', 'restore', 'reset']);

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function injectUser() {
  const user = window.__WEB_USER__;
  if (!user) return;
  const actions = document.querySelector('.topbar__actions');
  if (!actions || actions.querySelector('.web-user')) return;

  const wrap = document.createElement('div');
  wrap.className = 'web-user';
  wrap.title = `${user.email} · ${user.role === 'owner' ? 'владелец' : 'партнёр'}`;
  wrap.innerHTML = `
    <div class="web-user__avatar">${initials(user.name)}</div>
    <div class="web-user__text">
      <div class="web-user__name"></div>
      <div class="web-user__role">${user.role === 'owner' ? 'Владелец' : 'Партнёр · просмотр'}</div>
    </div>
    <button class="web-user__logout" type="button" title="Выйти">Выйти</button>
  `;
  wrap.querySelector('.web-user__name').textContent = user.name;
  wrap.querySelector('.web-user__logout').addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      location.href = '/login';
    }
  });
  actions.appendChild(wrap);

  if (user.readOnly) {
    document.body.classList.add('web-readonly');
    document.querySelectorAll('#profile-form input').forEach((input) => { input.disabled = true; });
    document.querySelectorAll('#profile-form button[type="submit"]').forEach((button) => button.remove());
  }
}

document.addEventListener('click', (ev) => {
  if (!document.body.classList.contains('web-readonly')) return;
  const el = ev.target.closest('[data-action],[data-free]');
  if (el && (el.dataset.free === '1' || MUTATING.has(el.dataset.action))) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }
}, true);

const root = document.getElementById('app');
if (root) {
  new MutationObserver(injectUser).observe(root, { childList: true, subtree: true });
}
document.addEventListener('DOMContentLoaded', injectUser);
window.addEventListener('load', injectUser);

// Яндекс.Метрика: отдельный hit на переходы внутри SPA.
const METRIKA_ID = 114133114;
function metrikaHit(page) {
  if (typeof window.ym !== 'function') return;
  const url = `${location.origin}${location.pathname}?page=${encodeURIComponent(page)}`;
  window.ym(METRIKA_ID, 'hit', url, { title: document.title });
}
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (!nav) return;
  setTimeout(() => metrikaHit(nav.dataset.nav), 80);
}, true);
