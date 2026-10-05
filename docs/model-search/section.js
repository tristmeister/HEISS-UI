import { createIndex, normalize, search } from './search.js';
const stylesheet = new URL('./section.css', import.meta.url).href;
const defaultCatalog = new URL('../models/model-support-search.json', import.meta.url).href;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icons = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><circle cx="9" cy="10" r="1.3"/><path d="m4 17 5-4.5 3.5 3 2.5-2L20 17"/>',
  out: '<path d="M8 16 16 8m-7 0h7v7"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
const EASE = 'cubic-bezier(.16,1,.3,1)';
const BATCH = 30;
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
  constructor() { super(); this.attachShadow({ mode: 'open' }); this.limit = BATCH; }
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.shadowRoot.innerHTML = `<style>.ms{visibility:hidden}.ms.is-ready{visibility:visible}</style><link rel="stylesheet" href="${stylesheet}"><section class="ms" aria-labelledby="ms-title">
      <header class="intro"><p class="label">Models</p><h2 id="ms-title">Your model already works.</h2><p class="lead">28 model families run out of the box. Search for yours, or find a popular checkpoint from Civitai.</p></header>
      <div class="search-wrap"><div class="mq" aria-hidden="true"></div><div class="frame"><div class="field">${icon('search')}<input id="ms-query" type="search" placeholder="Search built-in models" autocomplete="off" spellcheck="false" aria-label="Search models" aria-controls="ms-results"><button type="button" class="clear" aria-label="Clear search" tabindex="-1">${icon('close')}</button><kbd aria-hidden="true">/</kbd></div><span class="handles" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></div>
      <div class="stage" id="ms-results" aria-busy="true"><div class="view home"></div><div class="view found" hidden><div class="list-head"><span class="list-title"></span><span class="count"></span></div><ul class="list" role="list"><li class="sentinel" aria-hidden="true" hidden></li></ul><div class="empty" hidden></div><p class="fine">Families are tested. Single checkpoints aren’t, so the odd one may need an extra file.</p></div><div class="view loading">${'<span></span>'.repeat(4)}</div></div>
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>`;
    const $ = selector => this.shadowRoot.querySelector(selector);
    this.$ = $;
    const style = $('link'), show = () => $('.ms').classList.add('is-ready');
    if (style.sheet) show(); else { style.addEventListener('load', show, { once: true }); style.addEventListener('error', show, { once: true }); }
    this.input = $('#ms-query'); this.stage = $('.stage'); this.list = $('.list');
    this.events = new AbortController(); const options = { signal: this.events.signal };
    this.input.addEventListener('input', event => { if (event.isComposing) return; this.limit = BATCH; this.schedule(); }, options);
    this.input.addEventListener('keydown', event => this.fieldKey(event), options);
    this.shadowRoot.addEventListener('click', event => this.click(event), options);
    this.stage.addEventListener('keydown', event => this.stageKey(event), options);
    document.addEventListener('keydown', event => {
      const origin = event.composedPath()[0];
      if (!event.defaultPrevented && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !origin.matches?.('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); this.input.focus(); }
    }, options);
    this.sentinel = this.list.querySelector('.sentinel');
    this.observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) this.loadMore(); }, { root: this.list, rootMargin: '0px 0px 320px 0px' });
    this.observer.observe(this.sentinel);
    this.visibility = new IntersectionObserver(([entry]) => { this.onScreen = entry.isIntersecting; this.$('.mq').classList.toggle('is-paused', !entry.isIntersecting); });
    this.visibility.observe(this);
    this.load();
  }
  disconnectedCallback() { this.observer?.disconnect(); this.visibility?.disconnect(); clearInterval(this.heat); this.events?.abort(); this.request?.abort(); cancelAnimationFrame(this.frame); this.initialized = false; }
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
      this.buildMarquee();
      this.total = this.data.families.reduce((sum, f) => sum + f.checkpoints.length, 0);
      this.render();
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.$('.home').innerHTML = '<div class="empty"><h3>The models didn’t load.</h3><p>Check your connection and try again.</p><button type="button" class="soft" data-retry>Try Again</button></div>';
      this.showView('home');
    } finally { this.stage.setAttribute('aria-busy', 'false'); }
  }

  fieldKey(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); this.actions()[0]?.focus(); }
    else if (event.key === 'Escape' && this.input.value) { event.preventDefault(); this.reset(); }
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
  actions() { return [...this.stage.querySelectorAll('.view:not([hidden]) :is(.row,.open)')]; }

  click(event) {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.matches('.clear')) { this.reset(); this.input.focus(); }
    else if (target.matches('.row[aria-expanded]')) this.toggleNote(target);
    else if (target.hasAttribute('data-retry')) this.load();
  }
  reset() { this.input.value = ''; this.limit = BATCH; this.render(); }
  toggleNote(row) {
    const open = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(open));
    row.parentElement.classList.toggle('is-open', open);
  }

  row(entry) {
    const c = entry.checkpoint, href = civitaiUrl(c.url);
    const li = document.createElement('li');
    li.dataset.key = entry.key;
    const meta = `${esc(c.creator || 'Unknown creator')}<span class="fam"><span class="dot">·</span>${esc(entry.family.label)}</span>`;
    const body = `<span class="row-text"><span class="name">${esc(c.name)}</span><span class="meta">${meta}</span></span><span class="tags">${entry.family.references ? `<span class="tag refs" role="img" aria-label="Takes reference images" title="Takes reference images">${icon('image')}</span>` : ''}${c.nsfw ? '<span class="tag">NSFW</span>' : ''}<span class="tag works">${icon('check')}Works</span></span>`;
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
    this.$('.field').classList.toggle('has-value', !!query);
    this.glow(query);
    const home = !query;
    let announcement;
    if (home) {
      this.showView('home');
      announcement = `${this.data.families.length} model families.`;
    } else {
      const results = search(this.index, query);
      const families = results.filter(e => e.type === 'family');
      const checkpoints = results.filter(e => e.type === 'checkpoint');
      this.$('.list-head').hidden = !checkpoints.length;
      this.$('.list-title').textContent = 'Best matches';
      this.$('.count').textContent = checkpoints.length.toLocaleString('en-US');
      const sig = query;
      if (sig !== this.sig) { this.sig = sig; this.limit = BATCH; this.list.scrollTop = 0; }
      this.checkpoints = checkpoints;
      this.patch(checkpoints.slice(0, this.limit));
      this.list.hidden = !checkpoints.length;
      const empty = this.$('.empty');
      empty.hidden = !!checkpoints.length;
      if (!checkpoints.length) {
        empty.innerHTML = families.length
          ? `<h3>${esc(families[0].family.label)} is built in.</h3><p>No popular checkpoints listed yet, but its models run.</p>`
          : `<h3>Nothing for “${esc(query)}”.</h3><p>Try its family, like SDXL or Flux. If the family is built in, HEISS UI runs it.</p>`;
      }
      this.showView('found');
      announcement = checkpoints.length ? `${checkpoints.length} checkpoints.` : 'No checkpoints found.';
    }
    this.$('[role=status]').textContent = announcement;
    this.resize(from);
  }

  // Background drift: family names and short popular checkpoints, four rows in alternating directions.
  buildMarquee() {
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
    const families = shuffle(this.data.families.map(f => ({ text: f.label, family: true })));
    const checkpoints = shuffle(this.data.families.flatMap(f => f.checkpoints.slice(0, 10))
      .filter(c => !c.nsfw && c.name.length >= 3 && c.name.length <= 18 && /^[\p{L}\p{N} .+'-]+$/u.test(c.name))
      .map(c => ({ text: c.name })));
    const rows = [[], [], [], []];
    const pool = [];
    for (let i = 0; pool.length < 96 && (families.length || checkpoints.length); i++) pool.push(i % 3 === 0 && families.length ? families.pop() : checkpoints.pop() || families.pop());
    pool.forEach((tag, i) => rows[i % 4].push(tag));
    const tag = t => `<span class="mq-tag${t.family ? ' is-family' : ''}" data-n="${esc(normalize(t.text).replace(/ /g, ''))}">${esc(t.text)}</span>`;
    const mq = this.$('.mq');
    mq.innerHTML = rows.map((items, r) => {
      const set = `<span class="mq-set">${items.map(tag).join('')}</span>`;
      return `<div class="mq-row" style="--dur:${[150, 190, 170, 210][r]}s;--dir:${r % 2 ? 'reverse' : 'normal'}"><div class="mq-track">${set}${set}</div></div>`;
    }).join('');
    this.tags = [...mq.querySelectorAll('.mq-tag')];
    requestAnimationFrame(() => mq.classList.add('is-on'));
    if (still()) return;
    // Now and then one tag warms up, the way the cup steams.
    clearInterval(this.heat);
    this.heat = setInterval(() => {
      if (!this.onScreen || document.hidden || this.input.value) return;
      const hot = this.tags[Math.floor(Math.random() * this.tags.length)];
      hot.classList.add('is-hot');
      setTimeout(() => hot.classList.remove('is-hot'), 2600);
    }, 1100);
  }
  glow(query) {
    if (!this.tags) return;
    const q = normalize(query).replace(/ /g, '');
    this.$('.mq').classList.toggle('is-searching', !!q);
    for (const t of this.tags) t.classList.toggle('is-match', q.length > 1 && t.dataset.n.includes(q));
  }
  // Smart loading: the next batch is appended when the end scrolls near, so nothing already shown is rebuilt.
  loadMore() {
    if (!this.checkpoints || this.limit >= this.checkpoints.length) return;
    this.limit += BATCH;
    this.patch(this.checkpoints.slice(0, this.limit));
  }
  // Keyed update: rows that stay slide to their new place, new rows fade in, so typing never flashes.
  patch(entries) {
    const motion = !still();
    const kids = [...this.list.children].filter(li => li !== this.sentinel);
    const append = kids.length <= entries.length && kids.every((li, i) => li.dataset.key === entries[i].key);
    if (append) {
      const rows = entries.slice(kids.length).map(entry => this.row(entry));
      this.sentinel.before(...rows);
      if (motion) rows.slice(0, 8).forEach((li, i) => li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 20, easing: EASE, fill: 'backwards' }));
    } else {
      const before = new Map();
      kids.forEach((li, i) => before.set(li.dataset.key, { li, top: motion && i < 14 ? li.getBoundingClientRect().top : null }));
      const next = entries.map(entry => before.get(entry.key)?.li || this.row(entry));
      this.list.replaceChildren(...next, this.sentinel);
      if (motion) {
        let fresh = 0;
        next.slice(0, 14).forEach(li => {
          const old = before.get(li.dataset.key);
          if (old) {
            if (old.top === null) return;
            const dy = old.top - li.getBoundingClientRect().top;
            if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: EASE });
          } else li.animate([{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 380, delay: fresh++ * 24, easing: EASE, fill: 'backwards' });
        });
      }
    }
    this.sentinel.hidden = entries.length >= this.checkpoints.length;
    this.list.append(this.sentinel);
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
