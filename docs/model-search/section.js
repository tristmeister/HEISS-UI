import { createIndex, search } from './search.js';
const stylesheet = new URL('./section.css', import.meta.url).href;
const defaultCatalog = new URL('../models/model-support-search.json', import.meta.url).href;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icons = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  out: '<path d="M8 16 16 8m-7 0h7v7"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
const EASE = 'cubic-bezier(.16,1,.3,1)';
const PAGE = 20;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let sharedCatalog;
function loadCatalog(url, signal) {
  const get = init => fetch(url, init).then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json(); });
  if (url === defaultCatalog) return sharedCatalog ||= get().catch(error => { sharedCatalog = undefined; throw error; });
  return get({ signal });
}
function civitaiUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'civitai.com' && /^\/models\/\d+$/.test(url.pathname) ? url.href : ''; } catch { return ''; }
}

export class HeissModelSearch extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this.family = ''; this.limit = PAGE; }
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.shadowRoot.innerHTML = `<style>.ms{visibility:hidden}.ms.is-ready{visibility:visible}</style><link rel="stylesheet" href="${stylesheet}"><section class="ms" aria-labelledby="ms-title">
      <header class="intro"><p class="label">Models</p><h2 id="ms-title">Got a model in mind?</h2><p class="lead">Every family here runs in HEISS UI. Search the most popular checkpoints on Civitai to find yours.</p></header>
      <div class="field">${icon('search')}<span class="token" hidden><span class="token-name"></span><button type="button" class="token-x" aria-label="Remove family filter">${icon('close')}</button></span><input id="ms-query" type="search" placeholder="DreamShaper, Pony, Wan 2.2…" autocomplete="off" spellcheck="false" aria-label="Search models" aria-controls="ms-results"><button type="button" class="clear" aria-label="Clear search" tabindex="-1">${icon('close')}</button><kbd aria-hidden="true">/</kbd></div>
      <div class="stage" id="ms-results" aria-busy="true"><div class="view home"></div><div class="view found" hidden><div class="matches"></div><div class="list-head"><span class="list-title"></span><span class="count"></span></div><ul class="list" role="list"></ul><button type="button" class="more" hidden>Show more</button><div class="empty" hidden></div></div><div class="view loading">${'<span></span>'.repeat(4)}</div></div>
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>`;
    const $ = selector => this.shadowRoot.querySelector(selector);
    this.$ = $;
    const style = $('link'), show = () => $('.ms').classList.add('is-ready');
    if (style.sheet) show(); else { style.addEventListener('load', show, { once: true }); style.addEventListener('error', show, { once: true }); }
    this.input = $('#ms-query'); this.stage = $('.stage'); this.list = $('.list');
    this.events = new AbortController(); const options = { signal: this.events.signal };
    this.input.addEventListener('input', event => { if (event.isComposing) return; this.limit = PAGE; this.schedule(); }, options);
    this.input.addEventListener('keydown', event => this.fieldKey(event), options);
    this.shadowRoot.addEventListener('click', event => this.click(event), options);
    this.stage.addEventListener('keydown', event => this.stageKey(event), options);
    document.addEventListener('keydown', event => {
      const origin = event.composedPath()[0];
      if (!event.defaultPrevented && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !origin.matches?.('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); this.input.focus(); }
    }, options);
    this.load();
  }
  disconnectedCallback() { this.events?.abort(); this.request?.abort(); cancelAnimationFrame(this.frame); this.initialized = false; }
  schedule() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.render()); }

  async load() {
    this.request?.abort(); this.request = new AbortController();
    this.stage.setAttribute('aria-busy', 'true');
    this.showView('loading');
    try {
      this.data = await loadCatalog(this.getAttribute('catalog-url') || defaultCatalog, this.request.signal);
      if (!this.isConnected) return;
      if (!Array.isArray(this.data.families)) throw new Error('Invalid catalog');
      this.index = createIndex(this.data);
      this.total = this.data.families.reduce((sum, f) => sum + f.checkpoints.length, 0);
      this.$('.home').innerHTML = ['image', 'video'].map(kind => `<div class="group"><p class="group-title">${kind === 'image' ? 'Image' : 'Video'}</p><div class="pills">${this.data.families.filter(f => f.kind === kind).map(f => this.pill(f)).join('')}</div></div>`).join('');
      this.render();
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.$('.home').innerHTML = '<div class="empty"><h3>The models didn’t load.</h3><p>Check your connection and try again.</p><button type="button" class="soft" data-retry>Try Again</button></div>';
      this.showView('home');
    } finally { this.stage.setAttribute('aria-busy', 'false'); }
  }

  fieldKey(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); this.actions()[0]?.focus(); }
    else if (event.key === 'Escape' && (this.input.value || this.family)) { event.preventDefault(); this.reset(); }
    else if (event.key === 'Backspace' && !this.input.value && this.family && this.input.selectionStart === 0) { this.setFamily(''); }
    else if (event.key === 'Enter') { event.preventDefault(); this.actions()[0]?.click(); }
  }
  stageKey(event) {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    const actions = this.actions(), current = actions.indexOf(this.shadowRoot.activeElement);
    if (current < 0) return;
    event.preventDefault();
    if (event.key === 'Escape' || (event.key === 'ArrowUp' && current === 0)) this.input.focus();
    else actions[Math.min(actions.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }
  actions() { return [...this.stage.querySelectorAll('.view:not([hidden]) :is(.pill,.row,.open,.more:not([hidden]))')]; }

  click(event) {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.matches('.clear')) { this.reset(); this.input.focus(); }
    else if (target.matches('.token-x')) { this.setFamily(''); this.input.focus(); }
    else if (target.dataset.family) { this.input.value = ''; this.setFamily(target.dataset.family); this.input.focus({ preventScroll: true }); }
    else if (target.matches('.more')) { const from = this.limit; this.limit += PAGE; this.render(); this.list.children[from]?.querySelector('.row')?.focus(); }
    else if (target.matches('.row[aria-expanded]')) this.toggleNote(target);
    else if (target.hasAttribute('data-retry')) this.load();
  }
  reset() { this.input.value = ''; this.limit = PAGE; this.setFamily(''); }
  setFamily(id) {
    this.family = id; this.limit = PAGE;
    const token = this.$('.token'), family = this.data?.families.find(f => f.id === id);
    token.hidden = !family;
    if (family) {
      this.$('.token-name').textContent = family.label;
      if (!still()) token.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
    }
    this.input.placeholder = family ? `Search ${family.label}` : 'DreamShaper, Pony, Wan 2.2…';
    this.render();
  }
  toggleNote(row) {
    const open = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(open));
    row.parentElement.classList.toggle('is-open', open);
  }

  pill(family, active = false) {
    return `<button type="button" class="pill${active ? ' is-active' : ''}" data-family="${esc(family.id)}">${esc(family.label)}</button>`;
  }
  row(entry) {
    const c = entry.checkpoint, href = civitaiUrl(c.url);
    const li = document.createElement('li');
    li.dataset.key = entry.key;
    const meta = `${esc(c.creator || 'Unknown creator')}<span class="fam"><span class="dot">·</span>${esc(entry.family.label)}</span>`;
    const body = `<span class="row-text"><span class="name">${esc(c.name)}</span><span class="meta">${meta}</span></span>${c.nsfw ? '<span class="tag">NSFW</span>' : ''}`;
    if (!href) li.innerHTML = `<div class="row is-static">${body}</div>`;
    else if (!c.nsfw) li.innerHTML = `<a class="row" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${body}<span class="go" aria-label="Opens Civitai">${icon('out')}</span></a>`;
    else li.innerHTML = `<button type="button" class="row" aria-expanded="false">${body}<span class="go">${icon('chevron')}</span></button><div class="note"><div><p>Heads up, this page on Civitai shows NSFW images.</p><a class="open" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open Civitai ${icon('out')}</a></div></div>`;
    return li;
  }

  showView(name) {
    const views = { home: this.$('.home'), found: this.$('.found'), loading: this.$('.loading') };
    for (const [key, view] of Object.entries(views)) {
      const visible = key === name;
      if (visible && view.hidden && !still()) view.animate([{ opacity: 0, filter: 'blur(4px)', transform: 'translateY(6px)' }, { opacity: 1, filter: 'none', transform: 'none' }], { duration: 420, easing: EASE });
      view.hidden = !visible;
    }
  }

  render() {
    if (!this.index) return;
    const query = this.input.value.trim();
    const from = this.stage.getBoundingClientRect().height;
    this.$('.field').classList.toggle('has-value', !!query || !!this.family);
    const home = !query && !this.family;
    let announcement;
    if (home) {
      this.showView('home');
      announcement = `${this.data.families.length} model families.`;
    } else {
      const results = search(this.index, query, { family: this.family });
      const families = this.family ? [] : results.filter(e => e.type === 'family');
      const checkpoints = results.filter(e => e.type === 'checkpoint');
      const familyKey = families.map(e => e.key).join();
      const matches = this.$('.matches');
      if (matches.dataset.key !== familyKey) {
        matches.dataset.key = familyKey;
        matches.innerHTML = `<p class="group-title">Families</p><div class="pills">${families.slice(0, 8).map(e => this.pill(e.family)).join('')}</div>`;
        if (familyKey && !still()) matches.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE });
      }
      matches.hidden = !families.length;
      this.$('.list-head').hidden = !checkpoints.length;
      this.$('.list-title').textContent = this.family ? 'Checkpoints' : 'Best matches';
      this.$('.count').textContent = checkpoints.length.toLocaleString('en-US');
      this.patch(checkpoints.slice(0, this.limit));
      this.list.hidden = !checkpoints.length;
      this.list.classList.toggle('in-family', !!this.family);
      const more = this.$('.more');
      more.hidden = checkpoints.length <= this.limit;
      more.textContent = `Show more`;
      const empty = this.$('.empty');
      empty.hidden = !!checkpoints.length;
      if (!checkpoints.length) {
        const label = this.family ? this.data.families.find(f => f.id === this.family)?.label : '';
        empty.innerHTML = this.family && !query
          ? `<h3>${esc(label)} is built in.</h3><p>No popular checkpoints listed yet, but any ${esc(label)} model runs.</p>`
          : families.length
            ? `<h3>That family is built in.</h3><p>Pick it above to see its popular checkpoints.</p>`
            : `<h3>Nothing for “${esc(query)}”.</h3><p>Try its family, like SDXL or Flux. If the family is here, HEISS UI runs it.</p>`;
      }
      this.showView('found');
      announcement = checkpoints.length ? `${checkpoints.length} checkpoints.` : 'No checkpoints found.';
    }
    this.$('[role=status]').textContent = announcement;
    this.resize(from);
  }

  // Keyed update: rows that stay slide to their new place, new rows fade in, so typing never flashes.
  patch(entries) {
    const motion = !still();
    const before = new Map();
    for (const li of this.list.children) before.set(li.dataset.key, { li, top: motion ? li.getBoundingClientRect().top : 0 });
    const next = entries.map(entry => before.get(entry.key)?.li || this.row(entry));
    this.list.replaceChildren(...next);
    if (!motion) return;
    let fresh = 0;
    for (const li of next) {
      const old = before.get(li.dataset.key);
      if (old) {
        const dy = old.top - li.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
      } else if (fresh < 14) {
        li.animate([{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 380, delay: fresh++ * 24, easing: EASE, fill: 'backwards' });
      }
    }
  }
  resize(from) {
    if (still()) return;
    this.heightAnimation?.cancel();
    const to = this.stage.getBoundingClientRect().height;
    if (Math.abs(to - from) < 2) return;
    this.heightAnimation = this.stage.animate([{ height: `${from}px`, overflow: 'clip' }, { height: `${to}px`, overflow: 'clip' }], { duration: 440, easing: EASE });
  }
}
if (!customElements.get('heiss-model-search')) customElements.define('heiss-model-search', HeissModelSearch);
