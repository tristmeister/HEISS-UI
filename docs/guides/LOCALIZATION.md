# Interface languages

Choose **Settings → General → Language → Interface language** to switch between
English and Russian (**Русский**). The choice is saved in this browser and shared
with its other HEISS UI tabs. Changing it updates mounted components, including
memoized gallery tiles, without reloading the page or clearing a prompt draft.
On first use, the first supported browser language is selected, falling back to
English. A blocked local storage still permits session-only language changes.

Only presentation text is translated. Prompts and negative prompts, model and
workflow names supplied by users, file paths, API identifiers, and generation
parameters are opaque data. Exported workflows and prompts prepared for an AI
agent remain unchanged. Model cards, server diagnostics and third-party messages
without a catalog entry remain in their original language.

## Adding a message

Use `t('English source text')` from `src/i18n/core.js` at the presentation site.
Pass variable data separately, for example:

```tsx
t('Missing {0} node{1}', { 0: count, 1: count === 1 ? '' : 's' })
```

Add the matching key to `src/i18n/ru.js`. Variables use `{0}`, `{1}` or named
placeholders; they are inserted once as plain text, never HTML. A translation
must not invent placeholders or translate their contents. English-only plural
suffix placeholders may be omitted in Russian. For count-sensitive messages,
use `one`, `few`, `many` and `other` forms selected by `Intl.PluralRules`.

Components using `t()` subscribe with `useLanguage()` from `src/i18n/react.ts`.
Translate static labels when rendering, rather than while initializing a module,
so a live language change updates them. Never pass translated values to API
option fields such as model filenames, sampler names or job-status identifiers.

Run `node --test scripts/localization.test.js`, `npm test` and `npm run build`.
Check both languages in the desktop and phone layouts, settings, workflow
gallery, tooltips and accessible labels. Check that a draft and selected model
survive a language change; no GPU generation is needed for these checks.
