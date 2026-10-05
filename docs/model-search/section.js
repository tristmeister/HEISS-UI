import { createIndex, search } from './search.js';
const stylesheet = new URL('./section.css', import.meta.url).href;
const defaultCatalog = new URL('../models/model-support-search.json', import.meta.url).href;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  external: '<path d="M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="m10 9 5 3-5 3Z"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
let sharedCatalog;
function loadCatalog(url, signal) {
  if (url === defaultCatalog) return sharedCatalog ||= fetch(url).then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json(); }).catch(error => { sharedCatalog = undefined; throw error; });
  return fetch(url, { signal }).then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json(); });
}
export class HeissModelSearch extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this.kind = 'all'; this.family = ''; this.limit = 8; }
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.shadowRoot.innerHTML = `<style>.search-section{visibility:hidden}.search-section.is-ready{visibility:visible}</style><link rel="stylesheet" href="${stylesheet}"><section class="search-section" aria-labelledby="title">
      <header class="intro"><span class="eyebrow"><i></i> YOUR MODELS, AT HOME</span><h2 id="title">Got a model in mind?</h2><p>Find its family. Find your favorite checkpoint.<br class="desktop-break"> See where it fits in HEISS UI.</p></header>
      <div class="search-shell"><div class="search-field">${icon('search')}<label class="sr-only" for="query">Search model families and checkpoints</label><input id="query" type="search" placeholder="Try Krea 2, DreamShaper, or a model filename…" autocomplete="off" spellcheck="false" aria-label="Search model families and checkpoints" aria-describedby="search-hint" aria-controls="results"><button class="clear icon-button" type="button" aria-label="Clear search" hidden>${icon('close')}</button><kbd class="shortcut" aria-hidden="true">/</kbd></div>
      <div class="tools"><div class="segments" role="group" aria-label="Model type"><button data-kind="all" aria-pressed="true">All models</button><button data-kind="image" aria-pressed="false">Image</button><button data-kind="video" aria-pressed="false">Video</button></div><label class="adult-toggle"><input id="adult" type="checkbox"><span class="switch" aria-hidden="true"></span><span>Include NSFW</span></label></div></div>
      <div class="examples" id="search-hint"><span>Try a favorite</span><button data-query="DreamShaper">DreamShaper</button><button data-query="Krea 2">Krea 2</button><button data-query="Pony">Pony</button><button data-query="Wan 2.2">Wan 2.2</button></div>
      <div class="result-area" aria-busy="true"><div class="result-bar"><span id="result-heading">Getting the model catalog…</span><span class="count"></span></div><div id="results"><div class="loading"><span></span><span></span><span></span></div></div></div>
      <div class="bottom-note"><span class="dot"></span><p>Family support is built in. Individual checkpoints may need their own files or nodes.</p></div>
      <details class="about"><summary>What does a match mean? <span>+</span></summary><p>All 28 listed families are supported by HEISS UI. Checkpoint matches come from a Civitai popularity snapshot; they haven’t all been tested individually, and some source groupings may be imperfect. A missing result doesn’t mean your model is unsupported. NSFW labels are Civitai’s labels for the linked model, not a guarantee about every image on its page.</p></details>
      <p class="sr-only" id="announcement" role="status" aria-live="polite" aria-atomic="true"></p>
      <dialog aria-labelledby="adult-title"><form method="dialog"><div class="dialog-icon">${icon('external')}</div><span class="eyebrow">LEAVING HEISS UI</span><h3 id="adult-title">This page is marked NSFW.</h3><p class="dialog-name"></p><p>Civitai may show adult images. Open this model only if you’re comfortable seeing that content.</p><div class="dialog-actions"><button class="cancel" value="cancel">Stay here</button><a class="continue" target="_blank" rel="noopener noreferrer">Open Civitai ${icon('external')}</a></div></form></dialog>
    </section>`;
    const $ = selector => this.shadowRoot.querySelector(selector);
    this.$ = $;
    const style = $('link');
    const show = () => $('.search-section').classList.add('is-ready');
    if (style.sheet) show(); else { style.addEventListener('load', show, { once:true }); style.addEventListener('error', show, { once:true }); }
    this.input = $('#query'); this.results = $('#results');
    this.events = new AbortController(); const options = { signal: this.events.signal };
    this.input.addEventListener('input', event => { if (event.isComposing) return; clearTimeout(this.timer); this.timer = setTimeout(() => { this.limit = 8; this.render(); }, 65); }, options);
    this.input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); this.results.querySelector('.result-action')?.focus(); }
      if (event.key === 'Escape') { this.input.value = ''; this.family = ''; this.limit = 8; this.render(); }
    }, options);
    $('#adult').addEventListener('change', () => { this.limit = 8; this.render(); }, options);
    this.shadowRoot.addEventListener('click', event => this.click(event), options);
    this.results.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
      const actions = [...this.results.querySelectorAll('.result-action')];
      const current = actions.indexOf(this.shadowRoot.activeElement);
      if (current < 0) return;
      event.preventDefault();
      if (event.key === 'Escape' || event.key === 'ArrowUp' && current === 0) this.input.focus();
      else actions[Math.min(actions.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    }, options);
    document.addEventListener('keydown', event => {
      const origin = event.composedPath()[0];
      if (!event.defaultPrevented && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !origin.matches?.('input,textarea,select,[contenteditable="true"]') && !this.$('dialog').open) { event.preventDefault(); this.input.focus(); }
    }, options);
    this.load();
  }
  disconnectedCallback() { this.events?.abort(); this.request?.abort(); clearTimeout(this.timer); this.initialized = false; }
  async load() {
    this.request?.abort(); this.request = new AbortController();
    this.$('.result-area').setAttribute('aria-busy', 'true');
    try {
      this.data = await loadCatalog(this.getAttribute('catalog-url') || defaultCatalog, this.request.signal);
      if (!this.isConnected) return;
      if (!Array.isArray(this.data.families)) throw new Error('Invalid catalog');
      this.index = createIndex(this.data); this.render();
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.$('#result-heading').textContent = 'The catalog couldn’t load';
      this.results.innerHTML = '<div class="empty"><h3>Let’s try that again.</h3><p>Check your connection and reload the model catalog.</p><button class="soft-button" data-retry>Retry</button></div>';
    } finally { this.$('.result-area').setAttribute('aria-busy', 'false'); }
  }
  click(event) {
    const button = event.target.closest('button,a'); if (!button) return;
    if (button.matches('.clear')) { this.input.value = ''; this.family = ''; this.limit = 8; this.render(); this.input.focus(); }
    if (button.dataset.kind) { this.kind = button.dataset.kind; this.family = ''; this.limit = 8; this.shadowRoot.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); this.render(); }
    if (button.dataset.query) { this.input.value = button.dataset.query; this.family = ''; this.limit = 8; this.render(); this.input.focus(); }
    if (button.dataset.family) { this.family = button.dataset.family; this.input.value = ''; this.limit = 8; this.render(); this.$('[data-back]')?.focus(); }
    if (button.hasAttribute('data-back')) { this.family = ''; this.input.value = ''; this.limit = 8; this.render(); this.input.focus(); }
    if (button.hasAttribute('data-more')) { this.limit += 12; this.render(); this.results.querySelector(`[data-position="${this.limit - 12}"]`)?.focus(); }
    if (button.hasAttribute('data-browse')) { this.browseAll = !this.browseAll; this.render(); this.$('[data-browse]')?.focus(); }
    if (button.hasAttribute('data-retry')) this.load();
    if (button.dataset.adult) {
      const entry = this.index.find(e => e.key === button.dataset.adult);
      if (!entry) return;
      this.$('.dialog-name').textContent = entry.name;
      this.$('.continue').href = entry.checkpoint.url;
      this.$('dialog').showModal(); this.$('.cancel').focus();
    }
    if (button.matches('.continue')) this.$('dialog').close();
  }
  familyCard(entry) {
    const f = entry.family;
    return `<button class="family-card result-action" data-family="${esc(f.id)}"><span class="family-icon">${icon(f.kind)}</span><span class="family-copy"><strong>${esc(f.label)}</strong><span>${f.kind === 'video' ? 'Video' : 'Image'} family <span class="separator">·</span> Built-in support</span></span>${icon('arrow')}</button>`;
  }
  checkpointRow(entry, position) {
    const c = entry.checkpoint;
    let url; try { url = new URL(c.url); } catch { url = null; }
    const valid = url?.protocol === 'https:' && url.hostname === 'civitai.com' && /^\/models\/\d+$/.test(url.pathname);
    const link = !valid ? '' : c.nsfw ? `<button class="visit" data-adult="${esc(entry.key)}" aria-label="Open NSFW Civitai page for ${esc(c.name)}">Civitai ${icon('external')}</button>` : `<a class="visit" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(c.name)} on Civitai in a new tab">Civitai ${icon('external')}</a>`;
    return `<details class="checkpoint"><summary class="result-action" data-position="${position}"><span class="row-icon">${icon('image')}</span><span class="row-copy"><strong>${esc(c.name)}</strong><span>${esc(c.baseModel || entry.family.label)} <span class="separator">·</span> by ${esc(c.creator || 'unknown creator')}${entry.fuzzy ? ' <span class="fuzzy">· Similar match</span>' : ''}</span></span><span class="nsfw ${c.nsfw ? 'yes' : ''}">NSFW: ${c.nsfw ? 'Yes' : 'No'}</span><span class="chevron">${icon('arrow')}</span></summary><div class="checkpoint-detail"><div><span class="detail-label">CATALOG MATCH</span><p>Listed under ${esc(entry.family.label)}. This checkpoint hasn’t been individually verified.</p></div>${link}</div></details>`;
  }
  render() {
    if (!this.index) return;
    const query = this.input.value.trim(), includeNsfw = this.$('#adult').checked;
    const { results, hidden } = search(this.index, query, { includeNsfw, kind: this.kind, family: this.family });
    this.$('.clear').hidden = !query && !this.family;
    this.$('.shortcut').hidden = !!query || !!this.family;
    const home = !query && !this.family;
    this.$('.examples').hidden = !home;
    this.$('.count').textContent = home ? `${results.filter(e => e.type === 'family').length} families` : `${results.length} matches`;
    this.$('#result-heading').textContent = home ? this.kind === 'all' ? 'A good place to start' : `Supported ${this.kind} families` : this.family ? this.data.families.find(f => f.id === this.family).label : results.length ? 'Here’s what we found' : 'No match in this catalog';
    if (home) {
      const favorites = ['krea2', 'flux2_dev', 'sdxl', 'qwen_image_21', 'zimage', 'wan22_14b'];
      const families = results.filter(e => e.type === 'family');
      const shown = this.browseAll || this.kind !== 'all' ? families : favorites.map(id => families.find(e => e.family.id === id)).filter(Boolean);
      this.results.innerHTML = `<div class="family-grid">${shown.map(e => this.familyCard(e)).join('')}</div>${this.kind === 'all' ? `<button class="browse" data-browse>${this.browseAll ? 'Show the essentials' : `Explore all ${this.data.families.length} families`}${icon('arrow')}</button>` : ''}`;
    } else {
      const families = results.filter(e => e.type === 'family');
      const checkpoints = results.filter(e => e.type === 'checkpoint');
      const groups = new Map();
      for (const entry of checkpoints.slice(0, this.limit)) {
        if (!groups.has(entry.family.id)) groups.set(entry.family.id, []);
        groups.get(entry.family.id).push(entry);
      }
      const shown = [...groups.values()].flat();
      let content = this.family ? '<button class="back" data-back>← All model families</button>' : '';
      if (families.length && !this.family) content += `<div class="group-label">SUPPORTED FAMILIES</div><div class="family-grid">${families.slice(0, 4).map(e => this.familyCard(e)).join('')}</div>${families.length > 4 ? `<button class="soft-button" data-family-reveal>Show ${families.length - 4} more families</button>` : ''}`;
      if (checkpoints.length) {
        let previous = '';
        shown.forEach((e, i) => { if (e.family.id !== previous) { content += `<div class="group-label">${esc(e.family.label)} <span>CHECKPOINTS</span></div>`; previous = e.family.id; } content += this.checkpointRow(e, checkpoints.indexOf(e)); });
        if (checkpoints.length > shown.length) content += `<button class="more soft-button" data-more>Show more <span>${shown.length} of ${checkpoints.length}</span>${icon('arrow')}</button>`;
      } else content += `<div class="empty">${icon('search')}<h3>${this.family ? 'The family is supported.' : families.length ? 'Your model family is here.' : 'Still worth a look.'}</h3><p>${this.family || families.length ? 'No visible checkpoint entries here yet. You can still use models in this family with HEISS UI.' : 'Try a shorter name, a creator, or the base model family. This catalog is a starting point, so an unlisted model may still work.'}</p>${!this.family && !families.length ? '<button class="soft-button" data-back>Browse supported families</button>' : ''}</div>`;
      if (hidden) content += `<p class="hidden-note">${hidden} NSFW ${hidden === 1 ? 'entry is' : 'entries are'} hidden. Use “Include NSFW” to show them.</p>`;
      this.results.innerHTML = content;
      this.$('[data-family-reveal]')?.addEventListener('click', event => { event.currentTarget.outerHTML = `<div class="family-grid">${families.slice(4).map(e => this.familyCard(e)).join('')}</div>`; });
    }
    this.$('#announcement').textContent = home ? `${this.data.families.length} supported model families. Browse a family or search a checkpoint.` : `${results.length} matches${hidden ? `, ${hidden} NSFW entries hidden` : ''}.`;
  }
}
if (!customElements.get('heiss-model-search')) customElements.define('heiss-model-search', HeissModelSearch);
