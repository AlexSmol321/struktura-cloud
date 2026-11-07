import {
  DIRS, buildIndex, computeStats, levelOf, directionOf, pathTo, placementFor,
  searchPartners, accountTotals, recentRegistrations, lastAccrual,
  fmtNum, fmtMoney, fmtCompact, fmtDate, plural, initials, statusTone, todayISO,
  pointsOf, operationLabel, escapeHtml
} from './model.js';
import { createSeed, STATUSES, APP_VERSION } from './seed.js';
import { TreeView } from './tree.js';
import { buildXlsx } from './xlsx.js';
import { buildReportSheets } from './report.js';
import * as files from './files.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const e = escapeHtml;
const IC = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

const state = createSeed();
const ui = {
  page: 'tree',
  selectedId: state.settings.ownerId,
  focusId: state.settings.ownerId,
  expanded: new Set(),
  panelOpen: true,
  partnerDir: 'all',
  partnerLevel: 'all',
  partnerQ: '',
  partnerSort: { key: 'level', dir: 'asc' },
  opsFilter: 'all',
  opsQ: ''
};

let idx = buildIndex(state.partners);
let treeView = null;
let saveTimer = null;
let modalAbort = null;
let searchActive = -1;
let searchItems = [];

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (files.isDesktop()) {
    try {
      await Neutralino.init();
      await Neutralino.window.setTitle('Структура — учёт партнёров MLM');
    } catch {}
  }
  const forceReset = new URLSearchParams(location.search).get('reset') === '1';
  const saved = forceReset ? null : await files.loadPersisted();
  if (saved) {
    const normalized = normalizeData(saved);
    if (normalized) {
      state.partners = normalized.partners;
      state.operations = normalized.operations;
      state.settings = normalized.settings;
      state.meta = { ...state.meta, ...(normalized.meta || {}) };
    }
  }
  idx = buildIndex(state.partners);
  resetUi();
  applyDemoQuery();
  renderShell();
  renderPage();
  updateChrome();
  bindShell();
  queueSave();
  window.__app = { state, ui, go, focusPartner, openInTree, openAddModal, renderPage, treeView: () => treeView };
}

function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw.data && Array.isArray(raw.data.partners) ? raw.data : raw;
  if (!Array.isArray(data.partners) || !data.partners.length) return null;
  const seen = new Set();
  const partners = [];
  for (const p of data.partners) {
    if (!p || typeof p.id !== 'number' || !p.name || seen.has(p.id)) continue;
    seen.add(p.id);
    partners.push({
      id: p.id,
      name: String(p.name),
      sponsor: typeof p.sponsor === 'number' ? p.sponsor : null,
      dir: ['A', 'B', 'C'].includes(p.dir) ? p.dir : null,
      since: /^\d{4}-\d{2}-\d{2}$/.test(p.since || '') ? p.since : todayISO(),
      phone: String(p.phone || ''),
      email: String(p.email || ''),
      volume: Math.max(0, Number(p.volume) || 0),
      sets: Math.max(0, Number(p.sets) || 0),
      status: STATUSES.includes(p.status) ? p.status : 'Старт',
      note: String(p.note || '')
    });
  }
  if (!partners.length) return null;
  const ownerId = data.settings?.ownerId;
  if (!partners.some((p) => p.id === ownerId)) return null;
  const slots = new Set();
  for (const p of partners) {
    if (p.id !== ownerId && (p.sponsor == null || !seen.has(p.sponsor) || !p.dir)) return null;
    if (p.id !== ownerId) {
      const key = `${p.sponsor}:${p.dir}`;
      if (slots.has(key)) return null;
      slots.add(key);
    }
  }
  const operations = Array.isArray(data.operations)
    ? data.operations.filter((o) => o && o.id && o.type && Number.isFinite(Number(o.amount))).map((o) => ({
      ...o,
      amount: Number(o.amount),
      status: o.status === 'pending' ? 'pending' : 'done'
    }))
    : [];
  return {
    partners,
    operations,
    settings: { ownerId },
    meta: data.meta || {}
  };
}

function resetUi() {
  ui.selectedId = state.settings.ownerId;
  ui.focusId = state.settings.ownerId;
  ui.expanded = defaultExpandedFor(state.settings.ownerId);
  ui.panelOpen = true;
  ui.partnerDir = 'all';
  ui.partnerLevel = 'all';
  ui.partnerQ = '';
  ui.partnerSort = { key: 'level', dir: 'asc' };
  ui.opsFilter = 'all';
  ui.opsQ = '';
}

function defaultExpandedFor(id) {
  const set = new Set([id]);
  const kids = idx.children.get(id);
  if (kids) {
    const first = kids.A || kids.B || kids.C;
    if (first) set.add(first);
  }
  return set;
}

function applyDemoQuery() {
  const q = new URLSearchParams(location.search);
  const page = q.get('page');
  if (['overview', 'tree', 'partners', 'account', 'settings'].includes(page)) ui.page = page;
  const focus = Number(q.get('focus'));
  if (focus && idx.byId.has(focus)) {
    ui.focusId = focus;
    ui.expanded = defaultExpandedFor(focus);
  }
  const select = Number(q.get('select'));
  if (select && idx.byId.has(select)) ui.selectedId = select;
  const expand = q.get('expand');
  if (expand) {
    if (expand === 'all') {
      ui.expanded = new Set([...idx.byId.keys()].filter((id) => DIRS.some((d) => idx.children.get(id)?.[d])));
    } else if (expand === 'none') {
      ui.expanded = new Set([ui.focusId]);
    } else {
      const ids = expand.split(',').map(Number).filter((id) => idx.byId.has(id));
      ui.expanded = new Set([ui.focusId, ...ids]);
    }
  }
  if (q.get('panel') === '0') ui.panelOpen = false;
  const modal = q.get('modal');
  if (modal) {
    setTimeout(() => {
      if (modal === 'add') {
        openAddModal({
          sponsorId: Number(q.get('sponsor')) || ui.selectedId,
          dir: q.get('dir') || undefined,
          prefill: {
            name: q.get('name') || '',
            phone: q.get('phone') || '',
            email: q.get('email') || ''
          }
        });
      } else if (modal === 'transfer') openTransferModal();
      else if (modal === 'withdraw') openWithdrawModal();
    }, 260);
  }
}

/* ------------------------------------------------------------------ shell */

const NAV = [
  { group: 'Работа', items: [
    ['overview', 'Обзор', 'overview'],
    ['tree', 'Структура', 'tree'],
    ['partners', 'Партнёры', 'users']
  ] },
  { group: 'Финансы', items: [['account', 'Лицевой счёт', 'wallet']] },
  { group: 'Система', items: [['settings', 'Настройки', 'settings']] }
];

function navItem(page, label, icon, badge = '') {
  return `<button class="nav__item" data-nav="${page}" type="button">
    ${IC(icon)}<span>${label}</span>${badge ? `<span class="nav__count" id="nav-count">${badge}</span>` : ''}
  </button>`;
}

function shellHtml() {
  const owner = idx.byId.get(state.settings.ownerId);
  const nav = NAV.map((g) => `
    <div class="nav__label">${g.group}</div>
    ${g.items.map(([page, label, icon]) => navItem(page, label, icon, page === 'tree' ? String(computeStats(owner.id, idx).partnersBelow) : '')).join('')}
  `).join('');

  return `
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand__mark" src="icons/appIcon.png" alt="">
        <div class="brand__text">
          <div class="brand__name">Структура</div>
          <div class="brand__sub">учёт партнёров MLM</div>
        </div>
      </div>
      <nav class="nav">${nav}</nav>
      <div class="sidebar__spacer"></div>
      <div class="offline">${IC('lock')}<span>Облачный режим.<br>Данные синхронизируются с сервером.</span></div>
      <div class="me">
        <div class="avatar" id="me-avatar">${e(initials(owner.name))}</div>
        <div class="me__text">
          <div class="me__name" id="me-name">${e(owner.name)}</div>
          <div class="me__meta" id="me-meta">ID ${owner.id} · ${e(owner.status)}</div>
        </div>
        <span class="me__dot" title="Доступно"></span>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="page-head">
          <div class="page-title" id="page-title">Структура</div>
          <div class="page-sub" id="page-sub"></div>
        </div>
        <div class="topbar__actions">
          <div class="search">
            <div class="search__field">
              ${IC('search')}
              <input id="search-input" type="text" placeholder="ФИО, телефон, ID" autocomplete="off" spellcheck="false">
              <kbd>${IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
            </div>
            <div class="search__results" id="search-results" hidden></div>
          </div>
          <button class="btn btn--ghost" type="button" data-action="backup" title="Скачать резервную копию">${IC('db')}<span class="btn__label">Бэкап</span></button>
          <button class="btn btn--ghost" type="button" data-action="export" title="Выгрузить в Excel">${IC('excel')}<span class="btn__label">Excel</span></button>
          <button class="btn btn--primary" type="button" data-action="add">${IC('plus')}<span>Партнёр</span></button>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
}

function renderShell() {
  $('#app').innerHTML = shellHtml();
}

function updateChrome() {
  const owner = idx.byId.get(state.settings.ownerId);
  const root = computeStats(owner.id, idx);
  const page = ui.page;
  const meta = pageMeta();
  const title = $('#page-title');
  if (title) title.textContent = meta.title;
  const sub = $('#page-sub');
  if (sub) sub.textContent = meta.sub;
  $$('.nav__item').forEach((el) => el.classList.toggle('is-active', el.dataset.nav === page));
  const count = $('#nav-count');
  if (count) count.textContent = root.partnersBelow;
  const meName = $('#me-name');
  if (meName) meName.textContent = owner.name;
  const meMeta = $('#me-meta');
  if (meMeta) meMeta.textContent = `ID ${owner.id} · ${owner.status}`;
  const meAvatar = $('#me-avatar');
  if (meAvatar) meAvatar.textContent = initials(owner.name);
  document.title = meta.title === 'Структура' ? 'Структура — учёт партнёров MLM' : `${meta.title} — Структура MLM`;
}

function pageMeta() {
  const owner = idx.byId.get(state.settings.ownerId);
  const root = computeStats(owner.id, idx);
  const focus = idx.byId.get(ui.focusId) || owner;
  switch (ui.page) {
    case 'overview':
      return { title: 'Обзор', sub: `Сводка на ${fmtDate(todayISO())}` };
    case 'partners':
      return { title: 'Партнёры', sub: `${root.partnersBelow} ${plural(root.partnersBelow, ['человек', 'человека', 'человек'])} · ${fmtMoney(root.volume)}` };
    case 'account':
      return { title: 'Лицевой счёт', sub: 'Начисления, переводы и вывод средств' };
    case 'settings':
      return { title: 'Настройки', sub: 'Профиль, данные и о программе' };
    default:
      return {
        title: 'Структура',
        sub: focus.id === owner.id
          ? `Тринар · ${root.partnersBelow} ${plural(root.partnersBelow, ['партнёр', 'партнёра', 'партнёров'])}`
          : `Структура: ${focus.name}`
      };
  }
}

/* ------------------------------------------------------------------ routing */

function go(page) {
  if (!['overview', 'tree', 'partners', 'account', 'settings'].includes(page)) return;
  closeModal();
  hideSearch();
  ui.page = page;
  renderPage();
  updateChrome();
  const content = $('#content');
  if (content) content.scrollTop = 0;
}

function renderPage() {
  if (treeView) {
    treeView.destroy();
    treeView = null;
  }
  const content = $('#content');
  if (!content) return;
  if (ui.page === 'tree') content.innerHTML = treePageHtml();
  else if (ui.page === 'overview') content.innerHTML = overviewHtml();
  else if (ui.page === 'partners') content.innerHTML = partnersPageHtml();
  else if (ui.page === 'account') content.innerHTML = accountPageHtml();
  else content.innerHTML = settingsPageHtml();
  content.scrollTop = 0;
  updateChrome();
  bindPage();
  if (ui.page === 'tree') requestAnimationFrame(mountTree);
}

function mountTree() {
  const host = $('#tree-canvas');
  if (!host) return;
  treeView = new TreeView(host, {
    partners: state.partners,
    idx,
    ownerId: state.settings.ownerId,
    rootId: ui.focusId,
    selectedId: ui.selectedId,
    expanded: ui.expanded,
    onSelect: (id) => setSelected(id),
    onToggle: (id) => toggleExpand(id),
    onFree: (parentId, dir) => openAddModal({ sponsorId: parentId, dir }),
    onZoom: (scale) => {
      const label = $('#zoom-label');
      if (label) label.textContent = `${Math.round(scale * 100)}%`;
    }
  });
  treeView.mount();
  updateCollapseLabel();
}

/* ------------------------------------------------------------------ tree page */

function treePageHtml() {
  const owner = idx.byId.get(state.settings.ownerId);
  const focus = idx.byId.get(ui.focusId) || owner;
  const st = computeStats(focus.id, idx);
  const isOwnerFocus = focus.id === owner.id;
  const dirs = DIRS.map((d) => `
    <div class="sum-dir">
      <span class="dir-badge dir-badge--${d.toLowerCase()}">${d}</span>
      <div class="sum-dir__text">
        <b>${st.byDir[d].count}</b>
        <span>${fmtMoney(st.byDir[d].volume)}</span>
      </div>
    </div>`).join('');

  const focusChip = isOwnerFocus ? '' : `
    <button class="focus-chip" type="button" data-action="focus" data-id="${owner.id}" title="Вернуться ко всей структуре">
      ${IC('chev-left')}<span>${e(focus.name)}</span>
    </button>`;

  const collapseLabel = ui.expanded.size > 1 ? 'Свернуть' : 'Развернуть';

  return `<div class="page page--tree">
    <section class="summary card">
      <div class="summary__main">
        <div class="sum-label">${isOwnerFocus ? 'Всего в структуре' : 'В структуре'}</div>
        <div class="sum-value">${st.partnersBelow} <span>${plural(st.partnersBelow, ['партнёр', 'партнёра', 'партнёров'])}</span></div>
      </div>
      <div class="summary__dirs">${dirs}</div>
      <div class="summary__right">
        <div class="sum-mini"><span>Наборов</span><b>${st.sets}</b></div>
        <div class="sum-mini"><span>Оборот</span><b>${fmtMoney(st.volume)}</b></div>
      </div>
    </section>

    <div class="workspace${ui.panelOpen ? '' : ' is-panel-closed'}" id="workspace">
      <section class="canvas-card card">
        <div class="canvas-head">
          <div class="canvas-head__left">
            <span class="canvas-title">Тринар</span>
            ${focusChip}
          </div>
          <div class="canvas-tools">
            <div class="zoom">
              <button type="button" data-action="zoom-out" aria-label="Уменьшить">−</button>
              <span class="zoom__label" id="zoom-label">100%</span>
              <button type="button" data-action="zoom-in" aria-label="Увеличить">+</button>
            </div>
            <button class="tool" type="button" data-action="fit">По размеру</button>
            <button class="tool" type="button" data-action="collapse" id="collapse-btn">${collapseLabel}</button>
            <button class="icon-btn" type="button" data-action="panel-toggle" aria-label="${ui.panelOpen ? 'Скрыть карточку' : 'Показать карточку'}" title="${ui.panelOpen ? 'Скрыть карточку' : 'Показать карточку'}">${IC('panel')}</button>
          </div>
        </div>
        <div class="canvas-wrap" id="tree-canvas"></div>
        <div class="canvas-hint">${IC('info', 'ic ic--sm')} Перетаскивайте мышью · Ctrl + колесо — масштаб</div>
        <div class="canvas-legend">
          <span class="dot dot--a"></span>A
          <span class="dot dot--b"></span>B
          <span class="dot dot--c"></span>C
          <span class="sep"></span>
          <span>пунктир — свободное место</span>
        </div>
      </section>
      <aside class="card panel" id="partner-panel">${panelHtml()}</aside>
    </div>
  </div>`;
}

function panelHtml() {
  const owner = idx.byId.get(state.settings.ownerId);
  const p = idx.byId.get(ui.selectedId) || owner;
  const isOwner = p.id === owner.id;
  const st = computeStats(p.id, idx);
  const dir = directionOf(p.id, owner.id, idx);
  const level = levelOf(p.id, owner.id, idx);
  const sponsor = p.sponsor != null ? idx.byId.get(p.sponsor) : null;

  const actions = isOwner
    ? `<button class="btn btn--primary btn--wide" type="button" data-action="add" data-sponsor="${p.id}">${IC('plus')}Зарегистрировать партнёра</button>`
    : `<button class="btn btn--primary" type="button" data-action="add" data-sponsor="${p.id}">${IC('plus')}Новый под ним</button>
       <button class="btn btn--secondary" type="button" data-action="focus" data-id="${p.id}">${IC('tree')}Его структура</button>`;

  const mini = isOwner ? `
    <div class="panel__section">
      <div class="mini-stats">
        <div class="mini-stat"><b>${st.partnersBelow}</b><span>партнёров</span></div>
        <div class="mini-stat"><b>${st.sets}</b><span>наборов</span></div>
        <div class="mini-stat"><b>${fmtCompact(st.volume)}</b><span>оборот</span></div>
      </div>
    </div>` : '';

  const kv = isOwner ? `
    <div class="kv">
      <div><dt>Регистрация</dt><dd>${fmtDate(p.since)}</dd></div>
      <div><dt>Телефон</dt><dd>${e(p.phone || '—')}</dd></div>
      <div><dt>E-mail</dt><dd title="${e(p.email)}">${e(p.email || '—')}</dd></div>
      <div><dt>Наборов</dt><dd>${p.sets}</dd></div>
    </div>` : `
    <div class="kv">
      <div><dt>Направление</dt><dd><span class="dir-badge dir-badge--${(dir || 'A').toLowerCase()}">${dir || '—'}</span>${dir ? ` ${dir}` : ''}</dd></div>
      <div><dt>Уровень от вас</dt><dd>${level ?? '—'}</dd></div>
      <div><dt>Спонсор</dt><dd title="${e(sponsor?.name || '')}">${e(sponsor?.name || '—')}</dd></div>
      <div><dt>Регистрация</dt><dd>${fmtDate(p.since)}</dd></div>
      <div><dt>Телефон</dt><dd>${e(p.phone || '—')}</dd></div>
      <div><dt>E-mail</dt><dd title="${e(p.email)}">${e(p.email || '—')}</dd></div>
      <div><dt>Наборов</dt><dd>${p.sets}</dd></div>
    </div>`;

  return `
    <div class="panel__head">
      <span class="eyebrow">${isOwner ? 'Ваш профиль' : 'Карточка партнёра'}</span>
      <button class="panel__close" type="button" data-action="panel-close" aria-label="Скрыть карточку">${IC('x')}</button>
    </div>
    <div class="person">
      <div class="avatar avatar--lg">${e(initials(p.name))}</div>
      <div class="person__text">
        <div class="person__name">${e(p.name)}</div>
        <div class="person__meta">
          <span class="num">ID ${p.id}</span><span class="dot"></span>
          <span class="chip chip--${statusTone(p.status)}">${e(p.status)}</span>
        </div>
      </div>
    </div>
    <div class="panel__actions">${actions}</div>
    ${mini}
    <div class="panel__section">
      <div class="panel__section-label">${isOwner ? 'Структура и объёмы' : 'Направления и объёмы'}</div>
      ${dirTableHtml(st, isOwner)}
    </div>
    <div class="panel__section">
      <div class="panel__section-label">${isOwner ? 'Контакты' : 'Партнёр'}</div>
      ${kv}
    </div>
    <div class="panel__note">${IC('info')}<span>${isOwner
      ? 'Демонстрационные данные. Данные синхронизируются с сервером.'
      : 'Демонстрационные данные. Новый партнёр встанет в выбранном направлении, а при занятом месте — переливом ниже.'}</span></div>`;
}

function dirTableHtml(st, isOwner) {
  const rows = DIRS.map((d) => `
    <tr>
      <td><span class="dir-badge dir-badge--${d.toLowerCase()}">${d}</span></td>
      <td>${st.byDir[d].count}</td>
      <td>${fmtNum(st.byDir[d].volume)}</td>
      <td>${fmtNum(st.byDir[d].points)}</td>
    </tr>`).join('');
  return `<table class="dir-table">
    <thead><tr><th></th><th>партнёров</th><th>оборот, ₽</th><th>баллы</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="is-personal"><td class="personal-label">личные</td><td>—</td><td>${fmtNum(st.personal.volume)}</td><td>${fmtNum(st.personal.points)}</td></tr>
      <tr class="is-total"><td>${isOwner ? 'Вся структура' : 'Всего в ветке'}</td><td>${st.partnersBelow}</td><td>${fmtNum(isOwner ? st.volume : st.volumeBelow)}</td><td>${fmtNum(isOwner ? st.points : pointsOf(st.volumeBelow))}</td></tr>
    </tbody>
  </table>`;
}

function renderPanel() {
  const panel = $('#partner-panel');
  if (panel) panel.innerHTML = panelHtml();
}

function setSelected(id) {
  if (!idx.byId.has(id)) return;
  ui.selectedId = id;
  if (!ui.panelOpen) {
    ui.panelOpen = true;
    const ws = $('#workspace');
    if (ws) ws.classList.remove('is-panel-closed');
    const toggle = $('[data-action="panel-toggle"]');
    if (toggle) {
      toggle.setAttribute('aria-label', 'Скрыть карточку');
      toggle.setAttribute('title', 'Скрыть карточку');
    }
    setTimeout(() => treeView?.fit(true), 260);
  }
  treeView?.setSelection(id);
  renderPanel();
}

function togglePanel() {
  ui.panelOpen = !ui.panelOpen;
  const ws = $('#workspace');
  if (ws) ws.classList.toggle('is-panel-closed', !ui.panelOpen);
  const btn = $('[data-action="panel-toggle"]');
  if (btn) {
    btn.setAttribute('aria-label', ui.panelOpen ? 'Скрыть карточку' : 'Показать карточку');
    btn.setAttribute('title', ui.panelOpen ? 'Скрыть карточку' : 'Показать карточку');
  }
  if (!ui.panelOpen) {
    const panel = $('#partner-panel');
    if (panel) panel.innerHTML = panelHtml();
  }
  setTimeout(() => treeView?.fit(true), 240);
}

function closePanel() {
  if (ui.panelOpen) togglePanel();
}

function toggleExpand(id) {
  if (ui.expanded.has(id)) ui.expanded.delete(id);
  else ui.expanded.add(id);
  treeView?.setExpanded(ui.expanded);
  updateCollapseLabel();
}

function toggleCollapseAll() {
  const expandable = [...idx.byId.keys()].filter((id) => DIRS.some((d) => idx.children.get(id)?.[d]));
  const openCount = [...ui.expanded].filter((id) => expandable.includes(id)).length;
  ui.expanded = openCount > 1 ? new Set([ui.focusId]) : new Set(expandable);
  treeView?.setExpanded(ui.expanded);
  updateCollapseLabel();
}

function updateCollapseLabel() {
  const btn = $('#collapse-btn');
  if (!btn) return;
  const expandable = [...idx.byId.keys()].filter((id) => DIRS.some((d) => idx.children.get(id)?.[d]));
  const openCount = [...ui.expanded].filter((id) => expandable.includes(id)).length;
  btn.textContent = openCount > 1 ? 'Свернуть' : 'Развернуть';
}

function focusPartner(id) {
  if (!idx.byId.has(id)) return;
  ui.focusId = id;
  ui.selectedId = id;
  ui.expanded = defaultExpandedFor(id);
  go('tree');
}

function openInTree(id) {
  if (!idx.byId.has(id)) return;
  const ownerId = state.settings.ownerId;
  const path = pathTo(id, ownerId, idx);
  ui.focusId = ownerId;
  ui.selectedId = id;
  ui.expanded = new Set(path);
  ui.panelOpen = true;
  go('tree');
}

/* ------------------------------------------------------------------ overview */

function overviewHtml() {
  const owner = idx.byId.get(state.settings.ownerId);
  const root = computeStats(owner.id, idx);
  const totals = accountTotals(state.operations);
  const newCount = recentRegistrations(state.partners).length;
  const dirRows = DIRS.map((d) => {
    const share = root.volume ? Math.round((root.byDir[d].volume / root.volume) * 100) : 0;
    return `<div class="hero__dir">
      <span class="dir-badge dir-badge--${d.toLowerCase()}">${d}</span>
      <span class="hero__dir-label">Направление ${d}<b>${root.byDir[d].count} ${plural(root.byDir[d].count, ['партнёр', 'партнёра', 'партнёров'])}</b></span>
      <span class="hero__dir-value">${fmtMoney(root.byDir[d].volume)}</span>
      <span class="hero__bar"><span style="width:${Math.max(share, 3)}%"></span></span>
    </div>`;
  }).join('');

  const leaders = state.partners
    .filter((p) => p.id !== owner.id)
    .map((p) => ({ p, st: computeStats(p.id, idx) }))
    .sort((a, b) => b.st.volumeBelow - a.st.volumeBelow)
    .slice(0, 5)
    .map(({ p, st }, i) => `
      <div class="leader">
        <span class="leader__rank">${i + 1}</span>
        <div class="leader__text">
          <div class="leader__name">${e(p.name)}</div>
          <div class="leader__meta">${directionOf(p.id, owner.id, idx) || '—'} · ${st.partnersBelow} ${plural(st.partnersBelow, ['партнёр', 'партнёра', 'партнёров'])}</div>
        </div>
        <span class="leader__value">${fmtMoney(st.volumeBelow)}</span>
      </div>`).join('');

  const bars = [
    ...DIRS.map((d) => ({
      d,
      label: `Направление ${d}`,
      count: root.byDir[d].count,
      volume: root.byDir[d].volume,
      cls: `bar-fill--${d.toLowerCase()}`
    })),
    { d: 'Л', label: 'Личный объём', count: 0, volume: root.personal.volume, cls: 'bar-fill--personal' }
  ].map((row) => {
    const share = root.volume ? Math.round((row.volume / root.volume) * 100) : 0;
    return `<div class="bar-row">
      <span class="dir-badge${row.d === 'Л' ? '' : ` dir-badge--${row.d.toLowerCase()}`}" ${row.d === 'Л' ? 'style="background:#bf8a1f"' : ''}>${row.d}</span>
      <div class="bar-row__main">
        <div class="bar-row__top"><b>${row.label}</b><span>${row.count ? `${row.count} чел.` : 'личный'}</span></div>
        <div class="bar-track"><div class="bar-fill ${row.cls}" style="width:${Math.max(share, row.volume ? 3 : 0)}%"></div></div>
      </div>
      <div class="bar-row__value">${fmtMoney(row.volume)}</div>
    </div>`;
  }).join('');

  const recent = [...state.partners]
    .filter((p) => p.sponsor != null)
    .sort((a, b) => b.since.localeCompare(a.since))
    .slice(0, 4)
    .map((p) => `
      <div class="mini-row">
        <span class="avatar avatar--sm">${e(initials(p.name))}</span>
        <div class="mini-row__main">
          <div class="mini-row__title">${e(p.name)}</div>
          <div class="mini-row__sub">под ${e(idx.byId.get(p.sponsor)?.name || '—')} · ${directionOf(p.id, owner.id, idx) || '—'}</div>
        </div>
        <div class="mini-row__right">${fmtDate(p.since)}</div>
      </div>`).join('');

  const recentOps = [...state.operations]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 4)
    .map((op) => {
      const incoming = op.type === 'accrual' || op.type === 'transfer_in';
      const icon = op.type === 'accrual' ? 'arrow-right' : op.type === 'payout' ? 'download' : 'transfer';
      return `<div class="mini-row">
        <span class="op-ico${op.type === 'payout' ? ' op-ico--pay' : op.type === 'transfer_out' ? ' op-ico--out' : ''}">${IC(icon)}</span>
        <div class="mini-row__main">
          <div class="mini-row__title">${operationLabel(op)}</div>
          <div class="mini-row__sub">${e(op.comment || '')}</div>
        </div>
        <div class="mini-row__right">
          <div class="mini-row__amount${incoming ? ' is-in' : ''}">${incoming ? '+' : '−'}${fmtMoney(op.amount)}</div>
          <div>${fmtDate(op.date)}</div>
        </div>
      </div>`;
    }).join('');

  return `<div class="page page--overview">
    <section class="hero">
      <div class="hero__left">
        <div class="hero__eyebrow">Сводка на ${fmtDate(todayISO())}</div>
        <div class="hero__value">${fmtNum(root.volume)} <small>₽</small></div>
        <div class="hero__sub">оборот структуры · ${root.partnersBelow} ${plural(root.partnersBelow, ['партнёр', 'партнёра', 'партнёров'])} · ${root.sets} ${plural(root.sets, ['набор', 'набора', 'наборов'])}</div>
        <div class="hero__actions">
          <button class="btn btn--cream" type="button" data-nav="tree">Открыть структуру ${IC('arrow-right')}</button>
          <button class="btn btn--onDark" type="button" data-action="export">${IC('excel')}Выгрузить в Excel</button>
        </div>
      </div>
      <div class="hero__dirs">${dirRows}</div>
    </section>

    <div class="kpis">
      <div class="card kpi">
        <div class="kpi__label">Начислено всего</div>
        <div class="kpi__value">${fmtMoney(totals.accrued)}</div>
        <div class="kpi__foot">за всё время</div>
      </div>
      <div class="card kpi">
        <div class="kpi__label">Выплачено</div>
        <div class="kpi__value">${fmtMoney(totals.paid)}</div>
        <div class="kpi__foot">в обработке ${fmtMoney(totals.pending)}</div>
      </div>
      <div class="card kpi kpi--gold">
        <div class="kpi__label">Доступно к выводу</div>
        <div class="kpi__value">${fmtMoney(totals.available)}</div>
        <div class="kpi__foot"><button class="btn btn--sm btn--ghost" type="button" data-nav="account" style="padding:0;height:auto">Лицевой счёт ${IC('chev-right', 'ic ic--sm')}</button></div>
      </div>
      <div class="card kpi">
        <div class="kpi__label">Новых за 30 дней</div>
        <div class="kpi__value">${newCount}</div>
        <div class="kpi__foot">регистраций в структуре</div>
      </div>
    </div>

    <div class="ov-grid">
      <section class="card">
        <div class="card__head">
          <div><div class="card__title">Оборот по направлениям</div><div class="card__sub">доля в общем обороте структуры</div></div>
          <span class="chip chip--soft">${fmtMoney(root.volume)}</span>
        </div>
        <div class="card__body bars">${bars}</div>
        <div class="card__note">${IC('info', 'ic ic--sm')} Личный объём — ваши собственные покупки, в направления он не входит.</div>
      </section>
      <section class="card">
        <div class="card__head">
          <div><div class="card__title">Лидеры по обороту ветки</div><div class="card__sub">без личного объёма</div></div>
          <span class="chip chip--soft">Топ-5</span>
        </div>
        <div class="card__body leaders">${leaders}</div>
      </section>
    </div>

    <div class="ov-grid2">
      <section class="card">
        <div class="card__head">
          <div><div class="card__title">Последние регистрации</div><div class="card__sub">кто пришёл в структуру</div></div>
          <button class="btn btn--sm btn--ghost" type="button" data-nav="partners">Все партнёры ${IC('chev-right', 'ic ic--sm')}</button>
        </div>
        <div class="card__body mini-list">${recent}</div>
      </section>
      <section class="card">
        <div class="card__head">
          <div><div class="card__title">Последние операции</div><div class="card__sub">начисления, переводы, выводы</div></div>
          <button class="btn btn--sm btn--ghost" type="button" data-nav="account">Лицевой счёт ${IC('chev-right', 'ic ic--sm')}</button>
        </div>
        <div class="card__body mini-list">${recentOps}</div>
      </section>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ partners */

function partnersPageHtml() {
  return `<div class="page page--partners">
    <div class="toolbar">
      <div class="segmented" id="dir-filter">
        ${['all', 'A', 'B', 'C'].map((d) => `<button type="button" data-dir-filter="${d}" class="${ui.partnerDir === d ? 'is-active' : ''}">${d === 'all' ? 'Все' : `Направление ${d}`}</button>`).join('')}
      </div>
      <select class="select" id="level-filter" aria-label="Уровень">
        <option value="all">Все уровни</option>
        ${[0, 1, 2, 3, 4].map((l) => `<option value="${l}" ${ui.partnerLevel === String(l) ? 'selected' : ''}>${l === 0 ? 'Вы (0)' : `Уровень ${l}`}</option>`).join('')}
      </select>
      <div class="toolbar__search">
        ${IC('search')}
        <input class="input input--search" id="partners-q" type="text" placeholder="ФИО, телефон, ID" value="${e(ui.partnerQ)}" autocomplete="off">
      </div>
      <button class="btn btn--secondary btn--sm" type="button" data-action="export">${IC('excel')}Excel</button>
      <button class="btn btn--primary btn--sm" type="button" data-action="add">${IC('plus')}Добавить</button>
    </div>
    <div class="card" id="partners-card">
      <div id="partners-table-wrap">${partnersTableHtml()}</div>
    </div>
  </div>`;
}

function filteredPartners() {
  const ownerId = state.settings.ownerId;
  const q = ui.partnerQ.trim().toLowerCase();
  let rows = state.partners.map((p) => ({
    p,
    st: computeStats(p.id, idx),
    level: levelOf(p.id, ownerId, idx) ?? 0,
    dir: directionOf(p.id, ownerId, idx)
  }));
  if (ui.partnerDir !== 'all') rows = rows.filter((r) => r.dir === ui.partnerDir);
  if (ui.partnerLevel !== 'all') rows = rows.filter((r) => r.level === Number(ui.partnerLevel));
  if (q) {
    const digits = q.replace(/\D/g, '');
    rows = rows.filter((r) => {
      const p = r.p;
      if (p.name.toLowerCase().includes(q)) return true;
      if (String(p.id).includes(q)) return true;
      if ((p.email || '').toLowerCase().includes(q)) return true;
      if (digits.length >= 3 && (p.phone || '').replace(/\D/g, '').includes(digits)) return true;
      return false;
    });
  }
  const key = ui.partnerSort.key;
  const dir = ui.partnerSort.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let v = 0;
    if (key === 'name') v = a.p.name.localeCompare(b.p.name, 'ru');
    else if (key === 'level') v = a.level - b.level;
    else if (key === 'since') v = a.p.since.localeCompare(b.p.since);
    else if (key === 'volume') v = a.st.volumeBelow - b.st.volumeBelow;
    else if (key === 'count') v = a.st.partnersBelow - b.st.partnersBelow;
    return v * dir || a.p.id - b.p.id;
  });
  return rows;
}

function sortMark(key) {
  if (ui.partnerSort.key !== key) return '';
  return `<span class="sort">${ui.partnerSort.dir === 'asc' ? '▲' : '▼'}</span>`;
}

function partnersTableHtml() {
  const rows = filteredPartners();
  const ownerId = state.settings.ownerId;
  const total = state.partners.length;
  const root = computeStats(ownerId, idx);
  const body = rows.map(({ p, st, level, dir }) => {
    const isOwner = p.id === ownerId;
    const sponsor = p.sponsor != null ? idx.byId.get(p.sponsor) : null;
    return `<tr data-action="open-in-tree" data-id="${p.id}">
      <td>
        <div class="cell-person">
          <span class="avatar avatar--sm">${e(initials(p.name))}</span>
          <div class="cell-person__text">
            <div class="cell-person__name">${e(p.name)}${isOwner ? '<span class="chip chip--olive">вы</span>' : ''}</div>
            <div class="cell-person__meta">ID ${p.id}${p.phone ? ` · ${e(p.phone)}` : ''}</div>
          </div>
        </div>
      </td>
      <td>${dir ? `<span class="dir-badge dir-badge--${dir.toLowerCase()}">${dir}</span>` : '<span class="muted">—</span>'}</td>
      <td class="num">${level}</td>
      <td class="muted-cell">${e(sponsor?.name || '—')}</td>
      <td class="nowrap">${fmtDate(p.since)}</td>
      <td class="num strong">${fmtMoney(st.volumeBelow)}</td>
      <td class="num">${st.partnersBelow}</td>
      <td><span class="chip chip--${statusTone(p.status)}">${e(p.status)}</span></td>
      <td class="num">${IC('chev-right', 'ic ic--sm')}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="table">
      <thead><tr>
        <th class="sortable" data-sort="name">Партнёр ${sortMark('name')}</th>
        <th>Направление</th>
        <th class="sortable" data-sort="level">Уровень ${sortMark('level')}</th>
        <th>Спонсор</th>
        <th class="sortable" data-sort="since">Регистрация ${sortMark('since')}</th>
        <th class="sortable" data-sort="volume" style="text-align:right">Оборот ветки ${sortMark('volume')}</th>
        <th class="sortable" data-sort="count" style="text-align:right">Партнёров ${sortMark('count')}</th>
        <th>Статус</th>
        <th></th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="9"><div class="empty">Никого не нашли. Измените фильтр или запрос.</div></td></tr>`}</tbody>
    </table>
  </div>
  <div class="table__foot">
    <span>Показано ${rows.length} из ${total} · оборот структуры ${fmtMoney(root.volume)}</span>
    <span>Нажмите на строку, чтобы открыть партнёра в структуре</span>
  </div>`;
}

function renderPartnersTable() {
  const wrap = $('#partners-table-wrap');
  if (wrap) wrap.innerHTML = partnersTableHtml();
}

function setPartnerFilter(dir) {
  ui.partnerDir = dir;
  $$('#dir-filter button').forEach((b) => b.classList.toggle('is-active', b.dataset.dirFilter === dir));
  renderPartnersTable();
}

/* ------------------------------------------------------------------ account */

function accountPageHtml() {
  const totals = accountTotals(state.operations);
  const last = lastAccrual(state.operations);
  return `<div class="page page--account">
    <div class="account-top">
      <section class="balance">
        <div>
          <div class="balance__label">Лицевой счёт</div>
          <div class="balance__value">${fmtMoney(totals.available)}</div>
          <div class="balance__hint">Доступно к выводу · заявка обрабатывается до 5 рабочих дней</div>
        </div>
        <div class="balance__actions">
          <button class="btn btn--cream" type="button" data-action="withdraw">${IC('download')}Вывести</button>
          <button class="btn btn--onDark" type="button" data-action="transfer">${IC('transfer')}Перевести партнёру</button>
        </div>
      </section>
      <div class="account-kpis">
        <div class="card account-kpi">
          <div class="account-kpi__label">Начислено всего</div>
          <div class="account-kpi__value">${fmtMoney(totals.accrued)}</div>
          <div class="account-kpi__foot">${last ? `последнее — ${fmtDate(last.date)}` : 'пока нет начислений'}</div>
        </div>
        <div class="card account-kpi">
          <div class="account-kpi__label">Выплачено</div>
          <div class="account-kpi__value">${fmtMoney(totals.paid)}</div>
          <div class="account-kpi__foot">за всё время</div>
        </div>
        <div class="card account-kpi">
          <div class="account-kpi__label">В обработке</div>
          <div class="account-kpi__value">${fmtMoney(totals.pending)}</div>
          <div class="account-kpi__foot">заявки на вывод</div>
        </div>
        <div class="card account-kpi">
          <div class="account-kpi__label">Переводы партнёрам</div>
          <div class="account-kpi__value">${fmtMoney(totals.transfersOut)}</div>
          <div class="account-kpi__foot">с лицевого счёта</div>
        </div>
      </div>
    </div>

    <section class="card">
      <div class="card__head ops-head">
        <div><div class="card__title">Операции</div><div class="card__sub">${state.operations.length} записей · демо-режим</div></div>
        <div class="ops-filters">
          <div class="segmented" id="ops-filter">
            ${[['all', 'Все'], ['accrual', 'Начисления'], ['payout', 'Выплаты'], ['transfer', 'Переводы']].map(([k, label]) => `<button type="button" data-ops-filter="${k}" class="${ui.opsFilter === k ? 'is-active' : ''}">${label}</button>`).join('')}
          </div>
          <div class="ops-search">
            ${IC('search')}
            <input class="input" id="ops-q" type="text" placeholder="Поиск по операциям" value="${e(ui.opsQ)}" autocomplete="off">
          </div>
        </div>
      </div>
      <div id="ops-table-wrap">${opsTableHtml()}</div>
    </section>
  </div>`;
}

function filteredOps() {
  const q = ui.opsQ.trim().toLowerCase();
  let list = [...state.operations].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (ui.opsFilter !== 'all') {
    if (ui.opsFilter === 'transfer') list = list.filter((o) => o.type === 'transfer_out' || o.type === 'transfer_in');
    else list = list.filter((o) => o.type === ui.opsFilter);
  }
  if (q) {
    list = list.filter((o) => {
      const partner = o.partnerId ? idx.byId.get(o.partnerId)?.name || '' : '';
      return `${o.comment || ''} ${partner} ${o.amount} ${operationLabel(o)}`.toLowerCase().includes(q);
    });
  }
  return list;
}

function opsTableHtml() {
  const list = filteredOps();
  const rows = list.map((op) => {
    const incoming = op.type === 'accrual' || op.type === 'transfer_in';
    const icon = op.type === 'accrual' ? 'arrow-right' : op.type === 'payout' ? 'download' : 'transfer';
    const partner = op.partnerId ? idx.byId.get(op.partnerId)?.name || '—' : '—';
    const pending = op.type === 'payout' && op.status === 'pending';
    const method = op.method ? ` · ${op.method}` : '';
    return `<tr>
      <td class="nowrap muted-cell">${fmtDate(op.date)}</td>
      <td>
        <div class="op-type">
          <span class="op-ico${op.type === 'payout' ? ' op-ico--pay' : op.type === 'transfer_out' ? ' op-ico--out' : ''}">${IC(icon)}</span>
          <div>
            <div class="strong">${operationLabel(op)}</div>
            <div class="muted" style="font-size:10px">${e(op.comment || '')}${e(method)}</div>
          </div>
        </div>
      </td>
      <td class="muted-cell">${e(partner)}</td>
      <td class="num ${incoming ? 'amount-in' : 'amount-out'}">${incoming ? '+' : '−'}${fmtMoney(op.amount)}</td>
      <td>${pending ? '<span class="chip chip--gold">В обработке</span>' : '<span class="chip chip--partner">Выполнено</span>'}</td>
      <td class="num">${pending ? `<button class="btn btn--sm btn--secondary" type="button" data-action="mark-paid" data-id="${op.id}">Отметить</button>` : ''}</td>
    </tr>`;
  }).join('');

  return `<div class="table-wrap">
    <table class="table">
      <thead><tr><th>Дата</th><th>Операция</th><th>Партнёр</th><th style="text-align:right">Сумма</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6"><div class="empty">Операций пока нет.</div></td></tr>`}</tbody>
    </table>
  </div>
  <div class="table__foot">
    <span>Показано ${list.length} из ${state.operations.length}</span>
    <span>Демо: выплаты не отправляются в банк, заявки отмечаются вручную</span>
  </div>`;
}

function renderOpsTable() {
  const wrap = $('#ops-table-wrap');
  if (wrap) wrap.innerHTML = opsTableHtml();
}

/* ------------------------------------------------------------------ settings */

function settingsPageHtml() {
  const owner = idx.byId.get(state.settings.ownerId);
  const storage = files.getStorageLabel();
  return `<div class="page page--settings">
    <div class="settings-grid">
      <section class="card settings-card">
        <h3>Профиль</h3>
        <div class="hint">Это ваша карточка в структуре: имя, контакты и ID.</div>
        <form id="profile-form" class="form-grid" autocomplete="off">
          <div class="field field--full">
            <label for="profile-name">Имя и фамилия</label>
            <input class="input" id="profile-name" name="name" value="${e(owner.name)}" required>
          </div>
          <div class="field">
            <label for="profile-phone">Телефон</label>
            <input class="input" id="profile-phone" name="phone" value="${e(owner.phone)}">
          </div>
          <div class="field">
            <label for="profile-email">E-mail</label>
            <input class="input" id="profile-email" name="email" type="email" value="${e(owner.email)}">
          </div>
          <div class="field field--full" style="flex-direction:row;align-items:center;justify-content:space-between">
            <div class="hint">ID ${owner.id} · ${owner.status} · регистрация ${fmtDate(owner.since)}</div>
            <button class="btn btn--primary btn--sm" type="submit">${IC('check')}Сохранить</button>
          </div>
        </form>
      </section>

      <section class="card settings-card">
        <h3>Данные</h3>
        <div class="hint">Данные хранятся на сервере. Резервная копия — обычный файл JSON.</div>
        <div class="settings-list">
          <div class="settings-row">
            <div class="settings-row__main">
              <div class="settings-row__title">Хранилище</div>
              <div class="settings-row__sub">${e(storage)}</div>
            </div>
            <span class="chip chip--olive">облако</span>
          </div>
          <button class="btn btn--secondary btn--wide" type="button" data-action="backup">${IC('download')}Скачать резервную копию</button>
          <button class="btn btn--secondary btn--wide" type="button" data-action="restore">${IC('upload')}Восстановить из копии</button>
          <button class="btn btn--danger btn--wide" type="button" data-action="reset">${IC('refresh')}Сбросить демо-данные</button>
        </div>
      </section>

      <section class="card settings-card">
        <h3>О программе</h3>
        <div class="hint">«Структура» — облачный учёт партнёров MLM.</div>
        <div class="settings-list">
          <div class="hotkey"><span>Версия</span><b>${APP_VERSION}</b></div>
          <div class="hotkey"><span>Платформа</span><b>браузер</b></div>
          <div class="hotkey"><span>Интернет</span><b>нужен</b></div>
          <div class="hotkey"><span>Данные</span><b>на сервере</b></div>
          <div class="hotkey"><span>Обновление</span><b>автоматически</b></div>
        </div>
      </section>

      <section class="card settings-card">
        <h3>Горячие клавиши</h3>
        <div class="hint">Ускоряют работу со структурой.</div>
        <div class="settings-list">
          <div class="hotkey"><span>Поиск партнёра</span><kbd>${IS_MAC ? '⌘ K' : 'Ctrl K'}</kbd></div>
          <div class="hotkey"><span>Масштаб схемы</span><kbd>Ctrl + колесо</kbd></div>
          <div class="hotkey"><span>Перемещение схемы</span><kbd>перетаскивание</kbd></div>
          <div class="hotkey"><span>Вписать схему</span><kbd>0</kbd></div>
          <div class="hotkey"><span>Закрыть окно / поиск</span><kbd>Esc</kbd></div>
        </div>
      </section>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ page bindings */

function bindPage() {
  if (ui.page === 'partners') {
    $('#partners-q')?.addEventListener('input', (ev) => {
      ui.partnerQ = ev.target.value;
      renderPartnersTable();
    });
    $('#level-filter')?.addEventListener('change', (ev) => {
      ui.partnerLevel = ev.target.value;
      renderPartnersTable();
    });
  }
  if (ui.page === 'account') {
    $('#ops-q')?.addEventListener('input', (ev) => {
      ui.opsQ = ev.target.value;
      renderOpsTable();
    });
  }
  if (ui.page === 'settings') {
    $('#profile-form')?.addEventListener('submit', saveProfile);
  }
}

function saveProfile(ev) {
  ev.preventDefault();
  const form = ev.currentTarget;
  const name = form.elements.name.value.trim();
  if (name.length < 3) {
    toast('Укажите имя и фамилию', 'error');
    return;
  }
  const owner = idx.byId.get(state.settings.ownerId);
  owner.name = name;
  owner.phone = form.elements.phone.value.trim();
  owner.email = form.elements.email.value.trim();
  idx = buildIndex(state.partners);
  queueSave();
  renderPage();
  updateChrome();
  toast('Профиль сохранён');
}

/* ------------------------------------------------------------------ persistence */

function snapshot() {
  return {
    meta: { ...state.meta, savedAt: new Date().toISOString(), version: 1 },
    settings: { ownerId: state.settings.ownerId },
    partners: state.partners,
    operations: state.operations
  };
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    files.persist(snapshot()).catch(() => {});
  }, 300);
}

/* ------------------------------------------------------------------ actions */

function bindShell() {
  document.addEventListener('click', (ev) => {
    const navEl = ev.target.closest('[data-nav]');
    if (navEl) {
      ev.preventDefault();
      go(navEl.dataset.nav);
      return;
    }

    const dirBtn = ev.target.closest('[data-dir-filter]');
    if (dirBtn) {
      setPartnerFilter(dirBtn.dataset.dirFilter);
      return;
    }

    const opsBtn = ev.target.closest('[data-ops-filter]');
    if (opsBtn) {
      ui.opsFilter = opsBtn.dataset.opsFilter;
      $$('#ops-filter button').forEach((b) => b.classList.toggle('is-active', b.dataset.opsFilter === ui.opsFilter));
      renderOpsTable();
      return;
    }

    const sortEl = ev.target.closest('[data-sort]');
    if (sortEl) {
      const key = sortEl.dataset.sort;
      if (ui.partnerSort.key === key) ui.partnerSort.dir = ui.partnerSort.dir === 'asc' ? 'desc' : 'asc';
      else ui.partnerSort = { key, dir: key === 'name' ? 'asc' : 'desc' };
      renderPartnersTable();
      return;
    }

    const el = ev.target.closest('[data-action]');
    if (el) {
      ev.preventDefault();
      handleAction(el);
      return;
    }

    if (!ev.target.closest('.search')) hideSearch();
  });

  const search = $('#search-input');
  search?.addEventListener('input', () => renderSearch());
  search?.addEventListener('focus', () => {
    if (search.value.trim()) renderSearch();
  });
  search?.addEventListener('keydown', (ev) => {
    const items = $$('.search__item', $('#search-results'));
    if (ev.key === 'ArrowDown' && items.length) {
      ev.preventDefault();
      searchActive = Math.min(searchActive + 1, items.length - 1);
      paintSearchActive(items);
    } else if (ev.key === 'ArrowUp' && items.length) {
      ev.preventDefault();
      searchActive = Math.max(searchActive - 1, 0);
      paintSearchActive(items);
    } else if (ev.key === 'Enter') {
      const item = items[searchActive] || items[0];
      if (item) {
        ev.preventDefault();
        chooseSearch(Number(item.dataset.searchId));
      }
    } else if (ev.key === 'Escape') {
      hideSearch();
    }
  });

  $('#search-results')?.addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-search-id]');
    if (item) chooseSearch(Number(item.dataset.searchId));
  });

  document.addEventListener('keydown', (ev) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      $('#search-input')?.focus();
      $('#search-input')?.select();
      return;
    }
    if (ev.key === 'Escape') {
      if ($('#modal-root')?.firstElementChild) {
        closeModal();
        return;
      }
      if (!$('#search-results')?.hidden) {
        hideSearch();
        return;
      }
    }
    if (!typing && ui.page === 'tree' && ev.key === '0') {
      ev.preventDefault();
      treeView?.fit(true);
    }
  });

  window.addEventListener('beforeunload', () => {
    files.persist(snapshot()).catch(() => {});
  });
}

function handleAction(el) {
  const action = el.dataset.action;
  switch (action) {
    case 'add':
      openAddModal({ sponsorId: Number(el.dataset.sponsor) || ui.selectedId });
      break;
    case 'export':
      exportExcel();
      break;
    case 'backup':
      downloadBackup();
      break;
    case 'restore':
      restoreBackup();
      break;
    case 'reset':
      resetDemo();
      break;
    case 'focus':
      focusPartner(Number(el.dataset.id));
      break;
    case 'open-in-tree':
      openInTree(Number(el.dataset.id));
      break;
    case 'panel-toggle':
      togglePanel();
      break;
    case 'panel-close':
      closePanel();
      break;
    case 'fit':
      treeView?.fit(true);
      break;
    case 'zoom-in':
      treeView?.zoomBy(1.14);
      break;
    case 'zoom-out':
      treeView?.zoomBy(1 / 1.14);
      break;
    case 'collapse':
      toggleCollapseAll();
      break;
    case 'transfer':
      openTransferModal();
      break;
    case 'withdraw':
      openWithdrawModal();
      break;
    case 'mark-paid':
      markPaid(el.dataset.id);
      break;
    case 'modal-close':
      closeModal();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ search */

function renderSearch() {
  const input = $('#search-input');
  const box = $('#search-results');
  if (!input || !box) return;
  const q = input.value.trim();
  if (!q) {
    hideSearch();
    return;
  }
  const results = searchPartners(q, state.partners, 8);
  searchItems = results;
  searchActive = results.length ? 0 : -1;
  if (!results.length) {
    box.innerHTML = `<div class="search__empty">Ничего не нашли. Попробуйте ФИО, телефон или ID.</div>`;
    box.hidden = false;
    return;
  }
  const ownerId = state.settings.ownerId;
  box.innerHTML = results.map((p, i) => `
    <button class="search__item${i === 0 ? ' is-active' : ''}" type="button" data-search-id="${p.id}">
      <span class="avatar avatar--sm">${e(initials(p.name))}</span>
      <span class="search__item-main">
        <span class="search__item-name">${e(p.name)}</span>
        <span class="search__item-meta">ID ${p.id} · ${directionOf(p.id, ownerId, idx) || '—'} · ${levelOf(p.id, ownerId, idx) ?? 0} уровень</span>
      </span>
      <span class="chip chip--${statusTone(p.status)}">${e(p.status)}</span>
    </button>`).join('');
  box.hidden = false;
}

function paintSearchActive(items) {
  items.forEach((el, i) => el.classList.toggle('is-active', i === searchActive));
  items[searchActive]?.scrollIntoView({ block: 'nearest' });
}

function hideSearch() {
  const box = $('#search-results');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  searchActive = -1;
}

function chooseSearch(id) {
  const input = $('#search-input');
  if (input) input.value = '';
  hideSearch();
  openInTree(id);
}

/* ------------------------------------------------------------------ modals */

function openModal({ title, sub = '', body, footer = '', wide = false, onMount }) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay">
    <div class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${e(title)}">
      <div class="modal__head">
        <div>
          <div class="modal__title">${e(title)}</div>
          ${sub ? `<div class="modal__sub">${sub}</div>` : ''}
        </div>
        <button class="modal__close" type="button" data-action="modal-close" aria-label="Закрыть">${IC('x')}</button>
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>
  </div>`;
  const overlay = root.firstElementChild;
  overlay.addEventListener('mousedown', (ev) => {
    if (ev.target === overlay) closeModal();
  });
  modalAbort = new AbortController();
  onMount?.(overlay, modalAbort.signal);
  setTimeout(() => {
    const focusEl = overlay.querySelector('[autofocus], input:not([type=hidden]), select, textarea');
    focusEl?.focus();
  }, 60);
}

function closeModal() {
  modalAbort?.abort();
  modalAbort = null;
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
}

function toast(message, tone = 'ok') {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast${tone === 'error' ? ' toast--error' : ''}`;
  el.innerHTML = `${IC(tone === 'error' ? 'alert' : 'check')}<span>${e(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'opacity .18s ease, transform .18s ease';
    setTimeout(() => el.remove(), 200);
  }, 3400);
}

function confirmDialog({ title, text, confirmLabel = 'Подтвердить', danger = false, onConfirm }) {
  openModal({
    title,
    body: `<div class="confirm-text">${text}</div>`,
    footer: `<button class="btn btn--secondary" type="button" data-action="modal-close">Отмена</button>
      <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" id="confirm-ok">${confirmLabel}</button>`,
    onMount: (overlay) => {
      overlay.querySelector('#confirm-ok')?.addEventListener('click', () => {
        closeModal();
        onConfirm();
      });
    }
  });
}

/* ------------------------------------------------------------------ add partner */

function nextPartnerId() {
  return Math.max(...state.partners.map((p) => p.id), 100000) + 1;
}

function openAddModal({ sponsorId, dir, prefill = {} } = {}) {
  const ownerId = state.settings.ownerId;
  const sponsor = idx.byId.has(sponsorId) ? sponsorId : ui.selectedId || ownerId;
  const initialDir = DIRS.includes(dir) ? dir : 'A';
  const sponsorPartner = idx.byId.get(sponsor);
  const today = todayISO();

  const body = `<form id="add-form" class="form-grid" autocomplete="off" novalidate>
    <div class="field field--full">
      <label for="add-name">ФИО <span class="req">*</span></label>
      <input class="input" id="add-name" name="name" placeholder="Иванова Анна Сергеевна" value="${e(prefill.name || '')}" maxlength="80">
      <div class="field__error" data-error-for="name">Укажите имя и фамилию</div>
    </div>
    <div class="field">
      <label for="add-phone">Телефон</label>
      <input class="input" id="add-phone" name="phone" placeholder="+7 900 000-00-00" value="${e(prefill.phone || '')}" maxlength="30">
    </div>
    <div class="field">
      <label for="add-email">E-mail</label>
      <input class="input" id="add-email" name="email" type="email" placeholder="name@example.ru" value="${e(prefill.email || '')}" maxlength="80">
    </div>
    <div class="field field--full">
      <label for="add-sponsor-search">Спонсор <span class="req">*</span></label>
      <div class="combo" id="add-sponsor-combo">
        <input class="input combo__input" id="add-sponsor-search" type="text" placeholder="Начните вводить ФИО или ID" autocomplete="off" spellcheck="false">
        <input type="hidden" id="add-sponsor" value="${sponsor}">
        <div class="combo__list" hidden></div>
      </div>
      <div class="field__hint">Можно выбрать любого партнёра. Если место занято, новичок встанет переливом ниже по выбранному направлению.</div>
      <div class="field__error" data-error-for="sponsor">Выберите спонсора из списка</div>
    </div>
    <div class="field field--full">
      <label>Направление <span class="req">*</span></label>
      <div class="dir-choices" id="add-dir">
        ${DIRS.map((d) => `<button class="dir-choice${d === initialDir ? ' is-active' : ''}" type="button" data-dir="${d}">
          <span class="dir-badge dir-badge--${d.toLowerCase()}">${d}</span>
          <span class="dir-choice__text"><b>${d}</b><span data-dir-count="${d}">— в направлении</span></span>
        </button>`).join('')}
      </div>
    </div>
    <div class="field field--full" id="add-hint-wrap"></div>
    <div class="field">
      <label for="add-since">Дата регистрации</label>
      <input class="input" id="add-since" name="since" type="date" value="${today}" max="${today}">
    </div>
    <div class="field">
      <label for="add-volume">Личный объём, ₽</label>
      <input class="input" id="add-volume" name="volume" type="number" min="0" step="1" value="0">
    </div>
    <div class="field">
      <label for="add-sets">Наборов</label>
      <select class="input" id="add-sets" name="sets">
        ${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === 1 ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="add-status">Статус</label>
      <select class="input" id="add-status" name="status">
        ${STATUSES.map((s) => `<option value="${s}" ${s === 'Старт' ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="field field--full">
      <label for="add-note">Заметка</label>
      <input class="input" id="add-note" name="note" placeholder="Например: пришёл с вебинара" maxlength="120">
    </div>
    <div class="form-error" id="add-error"></div>
  </form>`;

  openModal({
    title: 'Новый партнёр',
    sub: `Спонсор: ${e(sponsorPartner?.name || '')} · ID ${sponsor}`,
    body,
    wide: true,
    footer: `<div class="hint">Данные сохранятся на сервере. Новичок появится в структуре сразу.</div>
      <button class="btn btn--secondary" type="button" data-action="modal-close">Отмена</button>
      <button class="btn btn--primary" type="submit" form="add-form">${IC('check')}Зарегистрировать</button>`,
    onMount: (overlay, signal) => {
      const combo = overlay.querySelector('#add-sponsor-combo');
      const hidden = overlay.querySelector('#add-sponsor');
      const dirWrap = overlay.querySelector('#add-dir');
      let currentDir = initialDir;

      const setHint = () => {
        const sponsorIdNow = Number(hidden.value);
        const hintWrap = overlay.querySelector('#add-hint-wrap');
        const counts = {};
        if (idx.byId.has(sponsorIdNow)) {
          const st = computeStats(sponsorIdNow, idx);
          for (const d of DIRS) counts[d] = st.byDir[d].count;
        }
        for (const d of DIRS) {
          const el = overlay.querySelector(`[data-dir-count="${d}"]`);
          if (el) el.textContent = idx.byId.has(sponsorIdNow) ? `${counts[d]} в направлении` : '— в направлении';
        }
        if (!idx.byId.has(sponsorIdNow)) {
          hintWrap.innerHTML = `<div class="place-hint place-hint--empty">${IC('info')}<div>Выберите спонсора — покажу, куда встанет новичок.</div></div>`;
          return;
        }
        const pl = placementFor(sponsorIdNow, currentDir, idx);
        const parent = idx.byId.get(pl.parentId);
        const via = pl.hops
          ? ` · <span class="tag">перелив</span> через ${pl.hops} ${plural(pl.hops, ['партнёра', 'партнёра', 'партнёров'])}`
          : '';
        hintWrap.innerHTML = `<div class="place-hint">${IC('arrow-right')}<div>Свободное место: <b>${e(parent?.name || '')}</b> · направление <b>${currentDir}</b>${via}</div></div>`;
      };

      const initialSponsor = Number(overlay.querySelector('#add-sponsor').value) || null;
      setupCombo(combo, {
        initialId: initialSponsor,
        signal,
        excludeId: null,
        onChange: () => setHint()
      });

      dirWrap.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-dir]');
        if (!btn) return;
        currentDir = btn.dataset.dir;
        dirWrap.querySelectorAll('.dir-choice').forEach((b) => b.classList.toggle('is-active', b === btn));
        setHint();
      }, { signal });

      setHint();

      const form = overlay.querySelector('#add-form');
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = form.elements.name.value.trim();
        const sponsorId = Number(hidden.value);
        const err = overlay.querySelector('#add-error');
        form.querySelectorAll('.field').forEach((f) => f.classList.remove('has-error'));
        err.classList.remove('is-visible');

        let bad = false;
        if (name.length < 3) {
          form.querySelector('#add-name')?.closest('.field')?.classList.add('has-error');
          bad = true;
        }
        if (!idx.byId.has(sponsorId)) {
          combo.closest('.field')?.classList.add('has-error');
          bad = true;
        }
        if (bad) {
          err.textContent = 'Проверьте имя и спонсора: без них регистрация невозможна.';
          err.classList.add('is-visible');
          return;
        }

        const pl = placementFor(sponsorId, currentDir, idx);
        const partner = {
          id: nextPartnerId(),
          name,
          sponsor: pl.parentId,
          dir: pl.dir,
          since: form.elements.since.value || todayISO(),
          phone: form.elements.phone.value.trim(),
          email: form.elements.email.value.trim(),
          volume: Math.max(0, Number(form.elements.volume.value) || 0),
          sets: Math.max(0, Math.min(5, Number(form.elements.sets.value) || 0)),
          status: form.elements.status.value,
          note: form.elements.note.value.trim()
        };
        state.partners.push(partner);
        idx = buildIndex(state.partners);
        const path = pathTo(partner.id, state.settings.ownerId, idx);
        ui.selectedId = partner.id;
        ui.panelOpen = true;
        if (!path.includes(ui.focusId)) ui.focusId = state.settings.ownerId;
        for (const id of path) ui.expanded.add(id);
        ui.expanded.add(partner.id);
        queueSave();
        closeModal();
        go('tree');
        toast(`Партнёр зарегистрирован: ${partner.name}`);
      }, { signal });
    }
  });
}

/* ------------------------------------------------------------------ combobox */

function setupCombo(root, { initialId, signal, excludeId = null, onChange }) {
  const input = root.querySelector('.combo__input');
  const hidden = root.querySelector('input[type="hidden"]');
  const list = root.querySelector('.combo__list');
  let active = -1;
  let options = [];

  const dirOf = (p) => directionOf(p.id, state.settings.ownerId, idx) || '—';
  const levelOfP = (p) => levelOf(p.id, state.settings.ownerId, idx) ?? 0;

  const select = (id, silent = false) => {
    const p = idx.byId.get(id);
    if (!p) return;
    hidden.value = String(id);
    input.value = `${p.name} · ${id}`;
    list.hidden = true;
    if (!silent) onChange?.(id);
  };

  const render = (query) => {
    const q = (query || '').trim();
    let items;
    if (!q) {
      items = [...state.partners].filter((p) => p.id !== excludeId)
        .sort((a, b) => levelOfP(a) - levelOfP(b) || a.name.localeCompare(b.name, 'ru'))
        .slice(0, 30);
    } else {
      items = searchPartners(q, state.partners, 30).filter((p) => p.id !== excludeId);
    }
    options = items;
    active = items.length ? 0 : -1;
    if (!items.length) {
      list.innerHTML = `<div class="combo__empty">Ничего не нашли</div>`;
    } else {
      list.innerHTML = items.map((p, i) => `
        <button class="combo__item${i === 0 ? ' is-active' : ''}" type="button" data-id="${p.id}">
          <span class="avatar avatar--sm">${e(initials(p.name))}</span>
          <span class="combo__item-text">
            <span class="combo__item-name">${e(p.name)}</span>
            <span class="combo__item-meta">ID ${p.id} · ${dirOf(p)} · ${levelOfP(p)} ур.</span>
          </span>
        </button>`).join('');
    }
    list.hidden = false;
  };

  const paint = () => {
    [...list.querySelectorAll('.combo__item')].forEach((el, i) => el.classList.toggle('is-active', i === active));
    list.querySelector('.combo__item.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('focus', () => {
    render(hidden.value ? '' : input.value);
  }, { signal });
  input.addEventListener('input', () => {
    hidden.value = '';
    onChange?.(null);
    render(input.value);
  }, { signal });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = Math.min(active + 1, options.length - 1);
      paint();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = Math.max(active - 1, 0);
      paint();
    } else if (ev.key === 'Enter') {
      if (options[active]) {
        ev.preventDefault();
        select(options[active].id);
      }
    } else if (ev.key === 'Escape') {
      list.hidden = true;
    }
  }, { signal });
  list.addEventListener('mousedown', (ev) => {
    const item = ev.target.closest('[data-id]');
    if (!item) return;
    ev.preventDefault();
    select(Number(item.dataset.id));
  }, { signal });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement)) list.hidden = true;
    }, 140);
  }, { signal });
  document.addEventListener('click', (ev) => {
    if (!root.contains(ev.target)) list.hidden = true;
  }, { signal });

  if (initialId) select(initialId, true);
}

/* ------------------------------------------------------------------ transfers */

function openTransferModal() {
  const ownerId = state.settings.ownerId;
  const totals = accountTotals(state.operations);
  const body = `<form id="transfer-form" class="form-grid" autocomplete="off" novalidate>
    <div class="field field--full">
      <label for="transfer-partner-search">Кому перевести <span class="req">*</span></label>
      <div class="combo" id="transfer-combo">
        <input class="input combo__input" id="transfer-partner-search" type="text" placeholder="ФИО, телефон или ID партнёра" autocomplete="off" spellcheck="false">
        <input type="hidden" id="transfer-partner" value="">
        <div class="combo__list" hidden></div>
      </div>
      <div class="field__error" data-error-for="partner">Выберите партнёра из списка</div>
    </div>
    <div class="field">
      <label for="transfer-amount">Сумма, ₽ <span class="req">*</span></label>
      <input class="input" id="transfer-amount" type="number" min="0" step="1" placeholder="0" autofocus>
      <div class="field__hint">Доступно: ${fmtMoney(totals.available)}</div>
    </div>
    <div class="field">
      <label for="transfer-comment">Комментарий</label>
      <input class="input" id="transfer-comment" type="text" placeholder="Например: на рекламу" maxlength="80">
    </div>
    <div class="field field--full">
      <div class="place-hint">${IC('info')}<div>Перевод уменьшит доступный остаток и появится в операциях. В демо деньги не покидают программу.</div></div>
    </div>
    <div class="form-error" id="transfer-error"></div>
  </form>`;
  openModal({
    title: 'Перевести партнёру',
    sub: `С лицевого счёта · доступно ${fmtMoney(totals.available)}`,
    body,
    footer: `<button class="btn btn--secondary" type="button" data-action="modal-close">Отмена</button>
      <button class="btn btn--primary" type="submit" form="transfer-form">${IC('transfer')}Перевести</button>`,
    onMount: (overlay, signal) => {
      const combo = overlay.querySelector('#transfer-combo');
      setupCombo(combo, { initialId: null, signal, excludeId: ownerId, onChange: () => {} });
      const form = overlay.querySelector('#transfer-form');
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const partnerId = Number(overlay.querySelector('#transfer-partner').value);
        const amount = Math.round(Number(overlay.querySelector('#transfer-amount').value) || 0);
        const err = overlay.querySelector('#transfer-error');
        err.classList.remove('is-visible');
        if (!idx.byId.has(partnerId)) {
          combo.closest('.field').classList.add('has-error');
          err.textContent = 'Выберите получателя из списка.';
          err.classList.add('is-visible');
          return;
        }
        if (amount <= 0) {
          err.textContent = 'Сумма должна быть больше нуля.';
          err.classList.add('is-visible');
          return;
        }
        if (amount > totals.available) {
          err.textContent = `Недостаточно средств: доступно ${fmtMoney(totals.available)}.`;
          err.classList.add('is-visible');
          return;
        }
        state.operations.push({
          id: `op-${Date.now()}`,
          date: todayISO(),
          type: 'transfer_out',
          amount,
          status: 'done',
          partnerId,
          comment: overlay.querySelector('#transfer-comment').value.trim() || 'Перевод партнёру'
        });
        queueSave();
        closeModal();
        renderPage();
        updateChrome();
        toast(`Переведено ${fmtMoney(amount)} — ${idx.byId.get(partnerId)?.name || ''}`);
      }, { signal });
    }
  });
}

function openWithdrawModal() {
  const totals = accountTotals(state.operations);
  const body = `<form id="withdraw-form" class="form-grid" autocomplete="off" novalidate>
    <div class="field">
      <label for="withdraw-amount">Сумма, ₽ <span class="req">*</span></label>
      <input class="input" id="withdraw-amount" type="number" min="0" step="1" placeholder="0" autofocus>
      <div class="field__hint">Доступно: ${fmtMoney(totals.available)}</div>
    </div>
    <div class="field">
      <label for="withdraw-method">Куда вывести</label>
      <select class="input" id="withdraw-method">
        <option>Карта •• 4417</option>
        <option>Расчётный счёт</option>
      </select>
    </div>
    <div class="field field--full">
      <label for="withdraw-comment">Комментарий</label>
      <input class="input" id="withdraw-comment" type="text" placeholder="Необязательно" maxlength="80">
    </div>
    <div class="field field--full">
      <div class="place-hint">${IC('info')}<div>Заявка попадёт в операции со статусом «В обработке». В демо выплата не отправляется в банк.</div></div>
    </div>
    <div class="form-error" id="withdraw-error"></div>
  </form>`;
  openModal({
    title: 'Вывести средства',
    sub: `Доступно ${fmtMoney(totals.available)} · обработка до 5 рабочих дней`,
    body,
    footer: `<button class="btn btn--secondary" type="button" data-action="modal-close">Отмена</button>
      <button class="btn btn--primary" type="submit" form="withdraw-form">${IC('download')}Создать заявку</button>`,
    onMount: (overlay, signal) => {
      const form = overlay.querySelector('#withdraw-form');
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const amount = Math.round(Number(overlay.querySelector('#withdraw-amount').value) || 0);
        const err = overlay.querySelector('#withdraw-error');
        err.classList.remove('is-visible');
        if (amount <= 0) {
          err.textContent = 'Сумма должна быть больше нуля.';
          err.classList.add('is-visible');
          return;
        }
        if (amount > totals.available) {
          err.textContent = `Недостаточно средств: доступно ${fmtMoney(totals.available)}.`;
          err.classList.add('is-visible');
          return;
        }
        state.operations.push({
          id: `op-${Date.now()}`,
          date: todayISO(),
          type: 'payout',
          amount,
          status: 'pending',
          method: overlay.querySelector('#withdraw-method').value,
          comment: overlay.querySelector('#withdraw-comment').value.trim() || 'Заявка на вывод'
        });
        queueSave();
        closeModal();
        renderPage();
        updateChrome();
        toast(`Заявка на вывод ${fmtMoney(amount)} создана`);
      }, { signal });
    }
  });
}

function markPaid(id) {
  const op = state.operations.find((o) => o.id === id);
  if (!op) return;
  op.status = 'done';
  queueSave();
  renderPage();
  updateChrome();
  toast(`Выплата ${fmtMoney(op.amount)} отмечена выполненной`);
}

/* ------------------------------------------------------------------ files */

async function exportExcel() {
  try {
    const sheets = buildReportSheets(state);
    const bytes = buildXlsx(sheets, {
      title: `Структура MLM — ${idx.byId.get(state.settings.ownerId)?.name || ''}`,
      creator: 'Структура'
    });
    const filename = `struktura-otchet-${todayISO()}.xlsx`;
    const path = await files.saveBinary(bytes, filename);
    if (path) {
      const short = path.split(/[\\/]/).pop() || path;
      toast(files.isDesktop() ? `Excel сохранён: ${short}` : `Excel скачан: ${short}`);
    }
  } catch (err) {
    console.error(err);
    toast('Не удалось выгрузить Excel', 'error');
  }
}

async function downloadBackup() {
  try {
    const payload = {
      app: 'struktura-mlm',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: snapshot()
    };
    const filename = `struktura-backup-${todayISO()}.json`;
    const path = await files.saveText(JSON.stringify(payload, null, 2), filename);
    if (path) toast('Резервная копия сохранена');
  } catch (err) {
    console.error(err);
    toast('Не удалось сохранить копию', 'error');
  }
}

async function restoreBackup() {
  try {
    const text = await files.openTextFile();
    if (!text) return;
    const parsed = JSON.parse(text);
    const normalized = normalizeData(parsed);
    if (!normalized) {
      toast('Файл не похож на резервную копию', 'error');
      return;
    }
    confirmDialog({
      title: 'Восстановить данные?',
      text: `В копии <b>${normalized.partners.length}</b> партнёров и <b>${normalized.operations.length}</b> операций. Текущие данные будут заменены.`,
      confirmLabel: 'Восстановить',
      danger: true,
      onConfirm: () => {
        state.partners = normalized.partners;
        state.operations = normalized.operations;
        state.settings = normalized.settings;
        state.meta = { ...state.meta, ...(normalized.meta || {}) };
        idx = buildIndex(state.partners);
        resetUi();
        queueSave();
        ui.page = 'overview';
        renderPage();
        updateChrome();
        toast('Данные восстановлены из резервной копии');
      }
    });
  } catch (err) {
    console.error(err);
    toast('Не удалось прочитать файл', 'error');
  }
}

function resetDemo() {
  confirmDialog({
    title: 'Сбросить демо-данные?',
    text: 'Все изменения структуры, операции и профиль вернутся к демонстрационному набору. Текущие данные будут потеряны.',
    confirmLabel: 'Сбросить',
    danger: true,
    onConfirm: () => {
      const seed = createSeed();
      state.partners = seed.partners;
      state.operations = seed.operations;
      state.settings = seed.settings;
      state.meta = seed.meta;
      idx = buildIndex(state.partners);
      resetUi();
      queueSave();
      ui.page = 'overview';
      renderPage();
      updateChrome();
      toast('Демо-данные восстановлены');
    }
  });
}

/* ------------------------------------------------------------------ start */

boot().catch((err) => {
  console.error(err);
  const app = $('#app');
  if (app) {
    app.innerHTML = `<div style="padding:40px;font-family:system-ui;color:#23281c">
      <h2>Не удалось запустить программу</h2>
      <p style="color:#7d8172">${e(err?.message || String(err))}</p>
    </div>`;
  }
});
