import { DIRS, computeStats, escapeHtml } from './model.js';

const NODE_W = 200;
const NODE_H = 116;
const GAP_X = 26;
const GAP_Y = 78;
const PAD = 46;

const DIR_COLORS = { A: '#3f5c2c', B: '#7c6a33', C: '#6a5730' };

const STAR = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4-5.7-3.1-5.7 3.1 1.2-6.4L2.8 9.4l6.4-.9L12 2.6z"/></svg>`;
const CHEV_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const CHEV_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>`;

export class TreeView {
  constructor(host, opts) {
    this.host = host;
    this.partners = opts.partners;
    this.idx = opts.idx;
    this.ownerId = opts.ownerId;
    this.rootId = opts.rootId;
    this.selectedId = opts.selectedId;
    this.expanded = new Set(opts.expanded || []);
    this.onSelect = opts.onSelect || (() => {});
    this.onToggle = opts.onToggle || (() => {});
    this.onFree = opts.onFree || (() => {});
    this.onZoom = opts.onZoom || (() => {});
    this.view = { x: 0, y: 0, s: 1 };
    this.autoFit = true;
    this.nodes = [];
    this.free = [];
    this.edges = [];
    this.sizes = new Map();
    this.pointer = null;
    this.abort = new AbortController();
    this.raf = 0;
  }

  mount() {
    this.host.innerHTML = `
      <div class="tree-surface">
        <svg class="tree-links" aria-hidden="true"></svg>
        <div class="tree-nodes"></div>
      </div>`;
    this.surface = this.host.querySelector('.tree-surface');
    this.svg = this.host.querySelector('.tree-links');
    this.nodesHost = this.host.querySelector('.tree-nodes');
    this.bind();
    this.build();
    this.host.classList.add('is-ready');
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(this.host);
    requestAnimationFrame(() => this.fit(false));
  }

  destroy() {
    this.observer?.disconnect();
    this.abort.abort();
    cancelAnimationFrame(this.raf);
  }

  bind() {
    const signal = this.abort.signal;

    this.host.addEventListener('click', (e) => {
      const toggle = e.target.closest('.tnode__toggle');
      if (toggle) {
        e.stopPropagation();
        this.onToggle(Number(toggle.closest('.tnode').dataset.id));
        return;
      }
      const node = e.target.closest('.tnode');
      if (!node) return;
      if (node.dataset.free === '1') {
        this.onFree(Number(node.dataset.parent), node.dataset.dir);
        return;
      }
      this.onSelect(Number(node.dataset.id));
    }, { signal });

    this.host.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const node = e.target.closest('.tnode');
      if (!node) return;
      e.preventDefault();
      if (node.dataset.free === '1') this.onFree(Number(node.dataset.parent), node.dataset.dir);
      else this.onSelect(Number(node.dataset.id));
    }, { signal });

    this.host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.tnode')) return;
      e.preventDefault();
      this.host.setPointerCapture(e.pointerId);
      this.pointer = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
      this.host.classList.add('is-grabbing');
    }, { signal });

    this.host.addEventListener('pointermove', (e) => {
      if (!this.pointer) return;
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true;
      this.view.x = this.pointer.vx + dx;
      this.view.y = this.pointer.vy + dy;
      this.autoFit = false;
      this.apply(false);
    }, { signal });

    const end = () => {
      if (!this.pointer) return;
      this.pointer = null;
      this.host.classList.remove('is-grabbing');
    };
    this.host.addEventListener('pointerup', end, { signal });
    this.host.addEventListener('pointercancel', end, { signal });

    this.host.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0016);
        this.zoomAt(e.clientX, e.clientY, factor);
      } else {
        this.view.x -= e.deltaX;
        this.view.y -= e.deltaY;
        this.autoFit = false;
        this.apply(false);
      }
    }, { passive: false, signal });

    this.host.addEventListener('dblclick', () => this.fit(true), { signal });
  }

  onResize() {
    if (!this.host.clientWidth) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      if (this.autoFit) this.fit(false);
    });
  }

  visibleChildren(id) {
    if (!this.expanded.has(id)) return [];
    const isRoot = id === this.rootId;
    const out = [];
    const kids = this.idx.children.get(id);
    if (!kids) return out;
    for (const d of DIRS) {
      const child = kids[d];
      if (child) out.push({ dir: d, child });
      else if (isRoot) out.push({ dir: d, child: null });
    }
    return out;
  }

  measure(id) {
    if (this.sizes.has(id)) return this.sizes.get(id);
    const children = this.visibleChildren(id);
    let width = NODE_W;
    if (children.length) {
      const total = children.reduce((sum, c) => sum + (c.child ? this.measure(c.child) : NODE_W), 0) +
        GAP_X * (children.length - 1);
      width = Math.max(NODE_W, total);
    }
    this.sizes.set(id, width);
    return width;
  }

  build() {
    this.sizes.clear();
    this.nodes = [];
    this.free = [];
    this.edges = [];
    this.measure(this.rootId);
    const width = this.sizes.get(this.rootId) || NODE_W;
    this.place(this.rootId, 0, 0, 0, width);

    const all = [...this.nodes, ...this.free];
    const minX = Math.min(...all.map((n) => n.x));
    const minY = Math.min(...all.map((n) => n.y));
    const maxX = Math.max(...all.map((n) => n.x + NODE_W));
    const maxY = Math.max(...all.map((n) => n.y + NODE_H));
    const dx = -minX + PAD;
    const dy = -minY + PAD;
    for (const n of all) { n.x += dx; n.y += dy; }
    for (const e of this.edges) {
      e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy;
    }
    this.world = { w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
    this.render();
  }

  place(id, left, top, depth, width) {
    const children = this.visibleChildren(id);
    const widths = children.map((c) => (c.child ? this.measure(c.child) : NODE_W));
    const total = widths.reduce((a, b) => a + b, 0) + GAP_X * (children.length - 1);
    let cursor = left + (width - total) / 2;
    const childTop = top + NODE_H + GAP_Y;

    const slots = [];
    for (let i = 0; i < children.length; i++) {
      const cw = widths[i];
      slots.push({ child: children[i], cursor, cw, center: cursor + cw / 2 });
      cursor += cw + GAP_X;
    }

    // Родитель стоит над средней веткой: при трёх направлениях это B,
    // как в классической схеме тринара, а не над центром всей ширины.
    let anchor;
    if (!slots.length) anchor = left + width / 2;
    else if (slots.length === 1) anchor = slots[0].center;
    else if (slots.length === 3) anchor = slots[1].center;
    else anchor = (slots[Math.floor((slots.length - 1) / 2)].center + slots[Math.ceil((slots.length - 1) / 2)].center) / 2;

    const x = anchor - NODE_W / 2;
    this.nodes.push({ id, x, y: top, depth });
    if (!slots.length) return;

    for (const slot of slots) {
      const cx = slot.center - NODE_W / 2;
      this.edges.push({ x1: anchor, y1: top + NODE_H, x2: slot.center, y2: childTop });
      if (slot.child.child) {
        this.place(slot.child.child, slot.cursor, childTop, depth + 1, slot.cw);
      } else {
        this.free.push({ parent: id, dir: slot.child.dir, x: cx, y: childTop });
      }
    }
  }

  render() {
    const paths = this.edges.map((e) => {
      const d = `M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + 36}, ${e.x2} ${e.y2 - 36}, ${e.x2} ${e.y2}`;
      return `<path d="${d}"/>`;
    }).join('');
    this.svg.setAttribute('width', this.world.w);
    this.svg.setAttribute('height', this.world.h);
    this.svg.setAttribute('viewBox', `0 0 ${this.world.w} ${this.world.h}`);
    this.svg.innerHTML = paths;

    const nodesHtml = this.nodes.map((n) => this.nodeHtml(n)).join('');
    const freeHtml = this.free.map((f) => this.freeHtml(f)).join('');
    this.nodesHost.innerHTML = nodesHtml + freeHtml;
    this.nodesHost.style.width = `${this.world.w}px`;
    this.nodesHost.style.height = `${this.world.h}px`;
    this.surface.style.width = `${this.world.w}px`;
    this.surface.style.height = `${this.world.h}px`;
  }

  nodeHtml(n) {
    const p = this.idx.byId.get(n.id);
    if (!p) return '';
    const isOwner = n.id === this.ownerId;
    const selected = n.id === this.selectedId;
    const st = computeStats(n.id, this.idx);
    const counts = DIRS.map((d) =>
      `<span class="ncount" title="Партнёров в направлении ${d}"><i>${d}</i><b>${st.byDir[d].count}</b></span>`
    ).join('');
    const hasChildren = DIRS.some((d) => this.idx.children.get(n.id)?.[d]);
    const open = this.expanded.has(n.id);
    const badge = isOwner
      ? `<span class="tnode__badge tnode__badge--owner">${STAR}</span>`
      : `<span class="tnode__badge" style="background:${DIR_COLORS[p.dir] || '#3f5c2c'}">${escapeHtml(p.dir || '')}</span>`;
    const sub = isOwner ? '<div class="tnode__sub">Это вы</div>' : '';
    const toggle = hasChildren
      ? `<button class="tnode__toggle" type="button" aria-label="${open ? 'Свернуть' : 'Развернуть'} ${escapeHtml(p.name)}" title="${open ? 'Свернуть' : 'Развернуть'}">${open ? CHEV_UP : CHEV_DOWN}</button>`
      : '';
    return `<div class="tnode${isOwner ? ' is-owner' : ''}${selected ? ' is-selected' : ''}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px" role="button" tabindex="0" aria-label="${escapeHtml(p.name)}${isOwner ? ', это вы' : ''}">
      ${badge}
      <div class="tnode__name">${escapeHtml(p.name)}</div>
      ${sub}
      <div class="tnode__counts">${counts}</div>
      ${toggle}
    </div>`;
  }

  freeHtml(f) {
    return `<div class="tnode tnode--free" data-free="1" data-parent="${f.parent}" data-dir="${f.dir}" style="left:${f.x}px;top:${f.y}px" role="button" tabindex="0" aria-label="Свободное место в направлении ${f.dir}">
      <span class="tnode__badge" style="background:${DIR_COLORS[f.dir]};">${f.dir}</span>
      <div class="tnode__free-title">Свободно</div>
      <div class="tnode__free-sub">место не занято</div>
      <span class="tnode__free-plus" aria-hidden="true">+</span>
    </div>`;
  }

  apply(animate = true) {
    if (!this.surface) return;
    if (animate) {
      this.host.classList.add('is-animating');
      clearTimeout(this.animTimer);
      this.animTimer = setTimeout(() => this.host.classList.remove('is-animating'), 320);
    } else {
      this.host.classList.remove('is-animating');
    }
    this.surface.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.s})`;
    this.onZoom(this.view.s);
  }

  fit(animate = true) {
    const vw = this.host.clientWidth;
    const vh = this.host.clientHeight;
    if (!vw || !vh) return;
    const s = Math.min((vw - 6) / this.world.w, (vh - 6) / this.world.h, 1);
    const scale = Math.max(0.3, Math.min(1, s));
    this.view = {
      s: scale,
      x: (vw - this.world.w * scale) / 2,
      y: (vh - this.world.h * scale) / 2
    };
    this.autoFit = true;
    this.apply(animate);
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = Math.max(0.3, Math.min(1.8, this.view.s * factor));
    if (next === this.view.s) return;
    const wx = (px - this.view.x) / this.view.s;
    const wy = (py - this.view.y) / this.view.s;
    this.view.s = next;
    this.view.x = px - wx * next;
    this.view.y = py - wy * next;
    this.autoFit = false;
    this.apply(false);
  }

  zoomBy(factor) {
    const rect = this.host.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  setExpanded(set) {
    this.expanded = new Set(set);
    this.build();
    this.fit(true);
  }

  setSelection(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    for (const el of this.nodesHost.querySelectorAll('.tnode[data-id]')) {
      el.classList.toggle('is-selected', Number(el.dataset.id) === id);
    }
  }
}
