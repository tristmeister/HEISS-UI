import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { translate, supportedLanguage } from '../src/i18n/core.js';
import { ru } from '../src/i18n/ru.js';

test('English remains an identity translation and unknown Russian messages fall back safely', () => {
  assert.equal(translate('Settings', {}, 'en'), 'Settings');
  assert.equal(translate('Not yet translated {name}', { name: 'Wan 2.2' }, 'ru'), 'Not yet translated Wan 2.2');
  assert.equal(translate('constructor', {}, 'ru'), 'constructor');
  assert.equal(translate('__proto__', {}, 'ru'), '__proto__');
});

test('interpolation never translates or recursively evaluates user data', () => {
  const content = 'Settings {1} <script>alert(1)</script> C:\\models\\猫.safetensors';
  assert.equal(translate('{0}. Open smart upscale setup', { 0: content }, 'ru'), `${content}. Открыть настройки повышения разрешения`);
  assert.equal(translate('{missing} {known}', { known: '$& {missing}' }, 'en'), '{missing} $& {missing}');
});

test('Russian model counts use one, few and many including teens and compound counts', () => {
  for (const [count, word] of [[0,'моделей'],[1,'модель'],[2,'модели'],[5,'моделей'],[11,'моделей'],[12,'моделей'],[21,'модель'],[22,'модели'],[25,'моделей']]) {
    assert.equal(translate('{0} models', { 0: count }, 'ru'), `${count} ${word}`);
  }
});

test('catalog translations cannot invent interpolation variables or contain draft markers', () => {
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
  for (const [source, translation] of Object.entries(ru)) {
    const allowed = placeholders(source);
    for (const text of typeof translation === 'string' ? [translation] : Object.values(translation)) {
      assert.equal(typeof text, 'string', source);
      assert.ok(!/\[HEISS_|\uFFFD/.test(text), source);
      for (const variable of placeholders(text)) assert.ok(allowed.has(variable), `${source}: unexpected {${variable}}`);
      // English plural suffixes such as model{1} are deliberately omitted in Russian.
      for (const variable of allowed) {
        const suffix = new RegExp(`[a-z]\\{${variable}\\}`, 'i').test(source);
        if (!suffix) assert.ok(placeholders(text).has(variable), `${source}: missing {${variable}}`);
      }
    }
  }
});

test('locale parsing accepts regional Russian/English without accepting unsupported languages', () => {
  assert.equal(supportedLanguage('ru-RU'), 'ru');
  assert.equal(supportedLanguage('RU_ru'), 'ru');
  assert.equal(supportedLanguage('en-GB'), 'en');
  assert.equal(supportedLanguage('fr'), null);
});

test('first launch respects browser language even with unavailable storage or an empty languages list', () => {
  const moduleUrl = new URL('../src/i18n/core.js', import.meta.url).href;
  for (const languages of [[], ['de-DE', 'ru-RU', 'en']]) {
    const code = `
      import assert from 'node:assert/strict';
      Object.defineProperty(globalThis,'navigator',{value:{languages:${JSON.stringify(languages)},language:'ru-RU'},configurable:true});
      globalThis.localStorage = {getItem:()=>{throw Error('Storage blocked')}};
      const i18n = await import(${JSON.stringify(moduleUrl)});
      assert.equal(i18n.getLanguage(),'ru');
      assert.equal(i18n.t('Settings'),'Настройки');
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
  }
});

test('language changes persist, update document language and notify mounted consumers without reloading', () => {
  const moduleUrl = new URL('../src/i18n/core.js', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    const values = new Map([['heiss-ui-language', 'en'], ['heiss-ui-draft', '{"prompt":"Original prompt"}']]);
    const handlers = new Map();
    globalThis.localStorage = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
    globalThis.document = {documentElement:{lang:''}};
    globalThis.window = {addEventListener:(name,fn)=>handlers.set(name,fn)};
    const i18n = await import(${JSON.stringify(moduleUrl)});
    let notifications = 0;
    const unsubscribe = i18n.subscribeLanguage(()=>notifications++);
    assert.equal(i18n.setLanguage('ru'),true);
    assert.equal(i18n.t('Settings'),'Настройки');
    assert.equal(document.documentElement.lang,'ru');
    assert.equal(values.get('heiss-ui-language'),'ru');
    assert.equal(values.get('heiss-ui-draft'),'{"prompt":"Original prompt"}');
    assert.equal(i18n.setLanguage('ru'),true);
    assert.equal(notifications,1);
    handlers.get('storage')({key:'heiss-ui-language',newValue:'en'});
    assert.equal(i18n.getLanguage(),'en');
    assert.equal(notifications,2);
    assert.equal(i18n.setLanguage('xx'),false);
    unsubscribe();
    i18n.setLanguage('ru');
    assert.equal(notifications,2);
    localStorage.setItem=()=>{throw Error('Storage blocked')};
    assert.equal(i18n.setLanguage('en'),true);
    assert.equal(i18n.getLanguage(),'en');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
});
