/**
 * Prompts to start from: three per kind of model on an empty gallery, and a
 * larger pool for "Surprise me". Written for what each family is good at
 * (Krea 2: photographs and light; Flux: objects, places and lettering; SDXL:
 * short, concrete scenes), and kept varied and safe to show anyone.
 */

const byFamily: Record<string, string[]> = {
  krea: [
    'A fisherman mending nets on a quiet harbour at dawn, soft mist over the water, film photograph',
    'Close portrait of an old woman laughing in warm window light, freckles and fine lines, natural colour',
    'A small bakery on a rainy Paris street at night, glowing windows reflected in wet cobblestones'
  ],
  flux: [
    'A ceramic teapot shaped like a sleeping fox on a linen tablecloth, soft studio light, product photo',
    'A hand-painted wooden sign that reads "Open late" above a tiny ramen shop, warm neon glow, night',
    'A lighthouse on a cliff under a sky full of northern lights, long exposure, wide landscape'
  ],
  sdxl: [
    'A cozy reading nook with a window seat, rain outside, warm lamp light, detailed interior photo',
    'Portrait of a red fox in a snowy forest at golden hour, shallow depth of field',
    'An astronaut tending a vegetable garden on Mars, cinematic lighting, dust in the air'
  ],
  other: [
    'A glass greenhouse full of tropical plants at golden hour, light rays through the leaves',
    'A paper boat drifting down a rain-filled street gutter, macro photograph, reflections',
    'A quiet mountain lake at sunrise with a single red canoe, mist on the water'
  ],
  video: [
    'Waves rolling onto a black sand beach at sunset, slow camera push forward',
    'A hot air balloon rising over misty hills at dawn, gentle drift to the right',
    'Steam curling from a cup of coffee on a windowsill as rain streaks the glass'
  ]
};

const surprise = [
  'A tiny cabin inside a snow globe on a wooden desk, warm light glowing from its windows',
  'An old library where the books are growing like plants, ivy on the shelves, morning light',
  'A street market in Marrakech at dusk, lanterns, spices piled high, vivid colours',
  'A jellyfish made of stained glass floating through a dark ocean, glowing softly',
  'A vintage red bicycle leaning against a sunflower field, late summer afternoon',
  'A cat wearing a tiny knitted scarf, sitting on a stack of books, soft window light',
  'A futuristic train crossing a stone viaduct over a green valley, clouds below',
  'An underwater city with coral towers and schools of silver fish, sun rays from above',
  'A chef plating a colourful dessert in a busy restaurant kitchen, motion and steam',
  'A treehouse village connected by rope bridges in a giant redwood forest, fog',
  'A desert road at night with a single diner lit in pink neon, stars overhead',
  'A porcelain doll-sized tea party set on a mossy tree stump, tiny mushrooms around it',
  'A koi pond in autumn, red maple leaves floating on the dark water, top-down view',
  'An old sailing ship caught in a storm, huge waves, lightning on the horizon',
  'A cozy ramen bar in Tokyo, steam rising, a single customer, rain on the window',
  'A field of lavender in Provence with a stone farmhouse, long evening shadows',
  'A snowy owl in flight against a pale winter sky, every feather sharp',
  'A retro-futuristic living room from the 1970s, orange sofa, sunken floor, city view',
  'A watercolour painting of a harbour town with pastel houses and small boats',
  'A giant tortoise carrying a small garden on its shell, walking through a meadow',
  'A bowl of fresh fruit on a marble counter, morning sun, editorial food photo',
  'A lone astronaut sitting on the edge of a crater, Earth rising in the distance'
];

/** Which set a model family draws from. */
function setFor(family = '', kind = 'image') {
  if (kind === 'video') return 'video';
  if (/krea/.test(family)) return 'krea';
  if (/flux|ideogram|qwen|ernie/.test(family)) return 'flux';
  if (/sd(xl|15|2)|checkpoint|auraflow|anima|lumina/.test(family)) return 'sdxl';
  return 'other';
}

export function starterPromptsFor(family = '', kind = 'image') {
  return byFamily[setFor(family, kind)];
}

/** A good prompt, never the one already in the box. */
export function surprisePrompt(current = '', kind = 'image') {
  const pool = kind === 'video' ? byFamily.video : [...surprise, ...byFamily.other];
  const choices = pool.filter((text) => text !== current.trim());
  return choices[Math.floor(Math.random() * choices.length)] || pool[0];
}
