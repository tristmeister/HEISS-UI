// Pure search index: created once, with no network work while typing.
export function normalize(value) {
  return String(value || '').replace(/\.(safetensors|ckpt|gguf|pt|bin)$/i, '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const compact = value => normalize(value).replace(/ /g, '');
const extras = { krea2: ['kriya 2', 'kriya2', 'crea 2'], sdxl: ['sd xl', 'stable diffusion extra large', 'noob ai'], flux2_klein_4b: ['klein four billion'], flux2_klein_9b: ['klein nine billion'], wan22_14b_i2v: ['wan image2video'], zimage: ['zimg'] };
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4 || /\d/.test(a)) return false;
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => c === b[i] ? -1 : i).filter(i => i >= 0);
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = 0;
  while (i < short.length && j < long.length) { if (short[i] === long[j]) { i++; j++; } else { j++; if (++skipped > 1) return false; } }
  return true;
}
export function createIndex(data) {
  const entries = [];
  for (const family of data.families) {
    const aliases = [family.label, ...family.aliases, ...(extras[family.id] || [])];
    entries.push(make({ type: 'family', key: family.id, name: family.label, family }, aliases));
    for (const checkpoint of family.checkpoints) entries.push(make({ type: 'checkpoint', key: `${family.id}:${checkpoint.id}:${checkpoint.versionId}`, name: checkpoint.name, family, checkpoint }, [checkpoint.name, checkpoint.searchName, checkpoint.creator, checkpoint.versionName, checkpoint.baseModel, ...(checkpoint.tags || []), ...aliases]));
  }
  return entries;
}
function make(entry, fields) {
  const primary = normalize(entry.name), text = fields.map(normalize).join(' ');
  return { ...entry, primary, compact: compact(entry.name), text, tokens: [...new Set([...text.split(' '), ...fields.map(compact)])], phrases: fields.map(compact) };
}
export function search(index, query, { family = '' } = {}) {
  const q = normalize(query), qc = compact(query), tokens = q.split(' ').filter(Boolean);
  const results = [];
  for (const entry of index) {
    if (family && entry.family.id !== family) continue;
    let score = 0, fuzzy = false;
    if (q) {
      if (entry.compact === qc) score = 1000;
      else if (entry.phrases.some(p => p === qc)) score = 900;
      else if (entry.compact.startsWith(qc)) score = 800;
      else if (entry.phrases.some(p => p.includes(qc))) score = 650;
      else {
        let total = 0, matched = true;
        for (const token of tokens) {
          if (entry.tokens.includes(token)) total += 60;
          else if (entry.tokens.some(t => t.startsWith(token))) total += 40;
          else if (entry.tokens.some(t => near(token, t))) { total += 15; fuzzy = true; }
          else { matched = false; break; }
        }
        if (!matched) continue;
        score = total;
      }
      if (entry.primary.includes(q)) score += 20;
    }
    results.push({ ...entry, score, fuzzy });
  }
  results.sort((a, b) => b.score - a.score || Number(a.fuzzy) - Number(b.fuzzy) || Number(b.type === 'family') - Number(a.type === 'family'));
  return results;
}
