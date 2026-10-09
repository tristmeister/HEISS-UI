import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { families as runtimeFamilies } from "../server/family-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(root, "docs/models/model-support-search.json");

if (!inputPath) {
  console.error("Usage: node scripts/build-model-support-search.mjs <civitai-export.json> [output.json]");
  process.exit(2);
}

const source = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
if (!Array.isArray(source.families)) throw new Error("Input must contain a families array.");

// Civitai bucket -> HEISS runtime family. Variant buckets are retained as tags.
const bucketFamilies = {
  "Krea 2 (Turbo, Raw)": ["krea2", "Turbo / Raw"],
  "Qwen-Image 2.1": ["qwen_image_21", ""],
  Anima: ["anima", ""],
  "Z-Image (Turbo, Base)": ["zimage", "Turbo / Base"],
  "Flux.2 Dev": ["flux2_dev", ""],
  "Flux.2 Klein 4B": ["flux2_klein_4b", ""],
  "Flux.2 Klein 9B": ["flux2_klein_9b", ""],
  "SDXL NoobAI": ["sdxl", "NoobAI"],
  "SDXL Illustrious": ["sdxl", "Illustrious"],
  "SDXL Pony": ["sdxl", "Pony"],
  "SDXL v-prediction": ["sdxl", "V-prediction"],
  "SDXL DMD2": ["sdxl", "DMD2"],
  "SDXL Hyper": ["sdxl", "Hyper"],
  "SDXL Lightning": ["sdxl", "Lightning"],
  "SDXL Turbo": ["sdxl", "Turbo"],
  "Pony V7": ["auraflow", ""],
  Chroma: ["chroma", ""],
  "Qwen-Image (incl. 2512)": ["qwen_image", ""],
  "Ideogram 4": ["ideogram4", ""],
  MageFlow: ["mage_flow", ""],
  "ERNIE-Image": ["ernie", ""],
  "Lumina Image 2.0 (Neta Lumina, NetaYume)": ["lumina2", "Neta Lumina / NetaYume"],
  "Sana 1.5/Sprint/2K/4K": ["sana", "1.5 / Sprint / 2K / 4K"],
  "HiDream I1": ["hidream", ""],
  "SD 3.5": ["sd3", ""],
  "Flux.1 Dev": ["flux1", "Dev"],
  "Flux.1 Schnell": ["flux1", "Schnell"],
  "Flux.1 de-distilled": ["flux1", "De-distilled"],
  "Pony (general)": ["sdxl", "Pony"],
  "SD 2.1": ["sd2", "2.1"],
  "SD 2.0": ["sd2", "2.0"],
  "SD 1.5": ["sd15", ""],
};

const familyAliases = {
  sd15: ["stable diffusion 1.5", "sd 1.5", "sd15", "sd-1.5"],
  sd2: ["stable diffusion 2", "sd 2.0", "sd 2.1", "sd2"],
  sdxl: ["stable diffusion xl", "sdxl", "sd xl", "pony", "illustrious", "noobai"],
  auraflow: ["pony v7", "auraflow"],
  sd3: ["stable diffusion 3.5", "sd3.5", "sd 3.5"],
  flux1: ["flux", "flux.1", "flux1", "schnell", "dev"],
  flux2_dev: ["flux.2", "flux2", "flux 2 dev"],
  flux2_klein_4b: ["flux.2 klein 4b", "flux2 klein 4b", "klein 4b"],
  flux2_klein_9b: ["flux.2 klein 9b", "flux2 klein 9b", "klein 9b"],
  chroma: ["chroma"],
  hidream: ["hidream", "hi dream"],
  qwen_image: ["qwen image", "qwen-image"],
  qwen_image_21: ["qwen image 2.1", "qwen-image 2.1", "qwen 2.1"],
  zimage: ["z-image", "z image", "zimage", "z image turbo"],
  krea2: ["krea 2", "krea2"],
  anima: ["anima"],
  wan21: ["wan 2.1", "wan2.1"],
  wan22_5b: ["wan 2.2 5b", "wan2.2 5b"],
  wan22_14b: ["wan 2.2 14b", "wan2.2 14b"],
  wan22_14b_i2v: ["wan 2.2 image to video", "wan 2.2 i2v"],
  hunyuan15: ["hunyuanvideo 1.5", "hunyuan video 1.5"],
  hunyuan15_i2v: ["hunyuanvideo 1.5 i2v"],
  minimax_h3: ["minimax h3", "h3"],
  lumina2: ["lumina image 2", "neta lumina", "netayume"],
  ideogram4: ["ideogram 4", "ideogram 4.0"],
  mage_flow: ["mageflow", "mage flow"],
  ernie: ["ernie image", "ernie"],
  sana: ["sana", "sana 1.5", "sana sprint"],
};

const promoPhrases = [
  /\bgoes? ancient\b/i,
  /\bis now\b/i,
  /\bnow free\b/i,
  /\bfree (?:release|download|for everyone)\b/i,
  /\b(?:limited time )?sale\b/i,
  /\bavailable now\b/i,
  /\bnew version\b/i,
  /\b(?:download|get it) now\b/i,
  /\bthemed models?\b/i,
  /\bsaved in multiple\b/i,
  /\bavailable in multiple\b/i,
];
const technicalTokens = /\b(?:fp\s?8|fp\s?16|bf\s?16|int\s?8|int\s?4|nvfp\s?4|e4m3fn|safetensors?|gguf|pruned|checkpoints?|model file)\b/gi;
const versionSuffix = /\s+v\d+[a-z][a-z0-9._-]*\s*$/i;
const minorTitleWords = new Set(["a", "an", "and", "as", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

// Small, explicit editorial fixes for labels that cannot be recovered well from
// punctuation cleanup alone. The source title stays in searchName.
const editorialTitles = {
  "2731187:3327244": "Moody Krea 2 Mix (Uncensored)",
  "378527:422648": "SDXL Game Style",
  "1095351:1230336": "3D Niji Style",
  "15899:21142": "Three-Phase Power",
  "100434:107500": "JJJ",
  "1217645:3249278": "SIE",
  "2356447:3318948": "RDBT Anima",
  "958009:3139241": "RedCraft Krea 2",
  "958009:3100874": "RedCraft Z-Image",
  "958009:1517097": "RedCraft Illustrious",
  "958009:2891710": "RedCraft ERNIE",
  "958009:1719149": "RedCraft HiDream",
  "958009:1387169": "RedCraft Flux.1 Dev",
  "958009:1126236": "RedCraft Flux.1 Schnell",
  "370372:413766": "Turbo Fusion Alpha",
  "352226:393925": "URPM Turbo LCM",
  "916130:1025392": "Illusob XL Mahoroba Mix",
  "835655:1023901": "Illustrious XL Personal Merge",
  "369575:633293": "Envy Starlight XL 01 Lightning",
  "638187:819165": "Flux.1 Dev and Schnell",
  "638187:714460": "Flux.1 Dev and Schnell",
  "646328:2660742": "Flux.1 Dev Hybrid",
  "648580:746729": "Flux.1 Schnell",
  "889791:995692": "Flux.1 Lite 8B",
  "730604:816993": "HyperFlux Unchained 8 Step",
  "730767:817164": "HyperFlux Unchained 16 Step",
  "2086049:2903822": "FLUXTRAIT Portrait Mix",
  "2086049:2700952": "FLUXTRAIT Portrait Mix",
  "2675485:3004133": "SNOFS Flux.2 Klein 9B",
  "971926:3281381": "ColorSplash V-Prediction",
  "117463:127305": "Westmix V1",
  "114769:124093": "Westmix V0",
  "798005:892376": "VixenMix Hyper 8 Step",
  "32423:38862": "E621 Rising V2",
  "5415:6298": "Cornflower Stylized",
  "1080969:1213875": "NoobAI Cyberfix V2",
  "1646878:2372907": "Anima Noob Realistic Portrait",
  "1646878:3129527": "Anima Noob Realistic Portrait",
  "1208658:2636888": "Manticore V-Pred Traditional",
  "1277670:2786084": "JANKU NoobAI Illustrious XL",
  "138331:353332": "SDXL Nuclear",
  "238319:268708": "SDXL DPO Fine-Tune",
  "647237:743507": "Flux.1 Dev GGUF",
  "836198:935551": "PornWorks Photo Realistic",
  "666145:745523": "FastFlux Unchained",
  "671478:751812": "FastFlux Unchained",
  "681795:873136": "Ratatoskr Creature Flux.1 Dev",
  "628862:764659": "Flux.1 Dev and Schnell Hybrid",
  "717680:802542": "Flux.1 Dev All-in-One",
  "1813468:2052217": "Flux.1 Dev Lite 8B",
  "1350209:1525264": "Flux.1 Dev All-in-One",
  "705444:789074": "HyperFlux 8 Step",
  "705681:789333": "HyperFlux 16 Step",
  "2350642:2673446": "Klein Foreskin Full",
  "2958896:3372040": "Noct Q Uncensored Realism",
  "2918004:3368572": "MageTrail 2.8B",
  "2242173:2740209": "Dark Beast 5C",
  "2416142:2985440": "SNOFS Flux.2 Klein 9B",
  "2663843:2991260": "SNOFS Flux.2 Klein 9B Distilled",
  "2675358:3015179": "Aisha Flux.2 Klein 9B",
  "2729270:3068238": "Moody Desire Mix",
  "2714538:3049821": "GonzaLomo Klein",
  "2740294:3081682": "X3N0 Flux X",
  "2677470:3006357": "Fascium Klein 9B",
  "2745066:3087610": "Real Dream",
  "2859199:3229556": "Flux.2 Klein 9B",
  "2859281:3229656": "Flux.2 Klein 9B",
  "2581147:2899791": "Flux.2 Klein 9B 4 Step",
  "2368511:2663677": "Unstable Evolution Flux.2 Klein 9B",
  "2526995:3194332": "Ray Klein 9B",
  "2734137:3074181": "Sophie Moone Flux.2 Klein 9B",
  "2967534:3362444": "Noct Q Anime Uncensored",
  "2416142:3333138": "SNOFS Krea 2",
  "2726029:3091481": "Krea 2 Turbo",
  "2515457:2827368": "Z-Image Turbo",
  "2169712:2549032": "Z-Image Turbo Low VRAM",
  "2850880:3244604": "Krea 2 Turbo",
  "2818054:3178594": "Anima Turbo V1.0",
  "2943746:3333112": "Anima Turbo 4S",
  "1790792:2485296": "NetaYume Lumina 2.0",
  "1974437:2377518": "NetaYume Lumina",
  "1489448:1684821": "Illustrious Lumina V0.03",
  "2378608:2674864": "Lumina Image 2.0 All-in-One",
  "459119:511040": "Common Canvas",
  "5575:6489": "E621 Rising 2.1",
  "1185:1219": "Cmodel Upgrade SD 2",
  "1001795:1190742": "NoobAI Cyberfix V-Prediction",
};

function cleanDisplayName(rawName) {
  let value = String(rawName || "").normalize("NFKC").trim();
  value = value.replace(/\.(?:safetensors|ckpt|pt|pth|gguf)$/i, "");

  // Drop an announcement after the underlying model title.
  let cutAt = value.length;
  for (const phrase of promoPhrases) {
    const match = phrase.exec(value);
    if (match && match.index > 0) cutAt = Math.min(cutAt, match.index);
  }
  value = value.slice(0, cutAt);

  // Pipes in Civitai titles commonly separate translations, taglines, or launch copy.
  // Prefer the first segment with Latin letters and retain the raw title for matching.
  if (value.includes("|")) {
    const segments = value.split("|").map((segment) => segment.trim());
    value = segments.find((segment) => /\p{Script=Latin}/u.test(segment)) || segments[0];
  }

  value = value.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/gu, " ");
  value = value.replace(/[_\u4E00-\u9FFF\u3001\u4E28]/g, " ");
  value = value.replace(/฿/g, "B").replace(/^P\s+/i, "");
  value = value.replace(technicalTokens, " ");
  value = value.replace(/\b(?:nsfw|sfw|unlocked|official|experimental|free)\b/gi, " ");
  value = value.replace(/\b(?:lora|locon)\s+merged\b.*$/i, " ");
  value = value.replace(/\b(?:saved|released|available)\s+(?:in\s+)?(?:multiple\s+)?(?:precisions?|formats?)\b.*$/i, " ");
  value = value.replace(/(\p{L})['’](\p{L})/gu, "$1\uE001$2");
  value = value.replace(/(\d)\.(\d)/g, "$1\uE000$2").replace(/[_.]+/g, " ").replace(/\uE000/g, ".").replace(/\p{P}+/gu, " ").replace(/\uE001/g, "'").replace(/\s+/g, " ").trim();
  value = value.replace(versionSuffix, "").trim();
  value = value.replace(/\bKrea\s*2(?:\s*DUAL)?\b/gi, (match) => /dual/i.test(match) ? "Krea 2 Dual" : "Krea 2");
  value = value.replace(/\bZ\s*Image\b/gi, "Z-Image").replace(/\bFlux\s*2\b/gi, "Flux.2").replace(/\bFlux\s*1\b/gi, "Flux.1");
  value = value.replace(/\bSD\s*1\s+5\b/gi, "SD 1.5").replace(/\bSD\s*2\s+([01])\b/gi, "SD 2.$1");
  value = value.replace(/\bQwen\s+3\s+0\s+(\d+\s*B)\b/gi, "Qwen 3.0 $1").replace(/\bQwen\s+Image\s+2\s+1\b/gi, "Qwen Image 2.1");
  value = value.replace(/\bV\s*(\d+)\s+(\d+)\b/gi, "V$1.$2").replace(/\bV\s*Pred(?:iction)?\b/gi, "V-Prediction");
  value = value.replace(/\bnoobai\b/gi, "NoobAI").replace(/noobai(?=[A-Z])/gi, "NoobAI ").replace(/\bqwen\b/gi, "Qwen").replace(/\bsd\b/gi, "SD");
  value = value.replace(/\bsdxl\b/gi, "SDXL").replace(/\bpdxl\b/gi, "PDXL").replace(/\bxl\b/gi, "XL").replace(/\blcm\b/gi, "LCM").replace(/\bdpo\b/gi, "DPO").replace(/\bdmd2\b/gi, "DMD2").replace(/\bvpred\b/gi, "V-Prediction").replace(/\bzimage\b/gi, "Z-Image");
  value = value.split(/(\s+)/).map((part, index, parts) => {
    if (!part || /^\s+$/.test(part)) return part;
    const lower = part.toLocaleLowerCase("en");
    if (minorTitleWords.has(lower) && parts.slice(0, index).some((earlier) => /\S/.test(earlier))) return lower;
    if (/^[a-z][a-z0-9]*$/.test(part)) return part[0].toLocaleUpperCase("en") + part.slice(1);
    return part;
  }).join("");
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(/\buncensored\b/gi, "Uncensored");
  value = value.replace(/\bAll In One\b/gi, "All-in-One");
  return value || String(rawName || "").trim();
}

function resolveGeneral(baseModel) {
  const base = String(baseModel || "").toLocaleLowerCase("en");
  if (["sd 1.5", "sd 1.5 hyper"].includes(base)) return ["sd15", ""];
  if (/^sd 2\./.test(base)) return ["sd2", base.includes("2.1") ? "2.1" : "2.0"];
  if (["sdxl 1.0", "sdxl hyper", "sdxl lightning", "noobai", "illustrious", "pony"].includes(base)) {
    return ["sdxl", base === "sdxl 1.0" ? "" : base.replace(/^sdxl\s*/i, "")];
  }
  if (["flux.1 d", "flux.1 s"].includes(base)) return ["flux1", base.endsWith(" d") ? "Dev" : "Schnell"];
  if (base === "qwen") return ["qwen_image", ""];
  if (base === "z imageturbo") return ["zimage", "Turbo"];
  if (base === "krea 2") return ["krea2", ""];
  if (base === "anima") return ["anima", ""];
  if (base === "ernie") return ["ernie", ""];
  return null;
}

const unknownBuckets = source.families.filter((bucket) => !bucketFamilies[bucket.family] && !bucket.family.endsWith("(general)"));
if (unknownBuckets.length) throw new Error(`Unmapped source buckets: ${unknownBuckets.map((b) => b.family).join(", ")}`);

const merged = new Map();
let rowsSeen = 0;
let adultTrue = 0;
let adultFalse = 0;
let namesChanged = 0;
let shortNames = 0;
let latinlessNames = 0;
let invalidIds = 0;
let unsupportedVersionsSkipped = 0;
for (const bucket of source.families) {
  for (const model of bucket.models || []) {
    rowsSeen += 1;
    const direct = bucketFamilies[bucket.family];
    const resolved = bucket.family.endsWith("(general)") ? resolveGeneral(model.baseModel) : direct;
    if (!resolved) continue;
    const [familyId, variantTag] = resolved;
    if (!runtimeFamilies[familyId]) throw new Error(`Unknown runtime family ${familyId} for ${bucket.family}`);
    // Qwen-Image-Edit is detected by HEISS as a known but unsupported architecture.
    if (familyId === "qwen_image" && /\bedit(?:ing)?\b/i.test(`${model.name || ""} ${model.versionName || ""}`)) {
      unsupportedVersionsSkipped += 1;
      continue;
    }
    if (!Number.isSafeInteger(model.civitaiModelId) || model.civitaiModelId <= 0) {
      invalidIds += 1;
      continue;
    }
    if (typeof model.nsfw !== "boolean") throw new Error(`Civitai NSFW value is missing for model ${model.civitaiModelId}`);
    if (model.nsfw) adultTrue += 1;
    else adultFalse += 1;

    const versionId = Number(model.versionId);
    if (!Number.isSafeInteger(versionId) || versionId <= 0) throw new Error(`Civitai version ID is missing for model ${model.civitaiModelId}`);
    const key = `${familyId}:${model.civitaiModelId}:${versionId}`;
    const cleaned = editorialTitles[`${model.civitaiModelId}:${model.versionId}`] || cleanDisplayName(model.name);
    if (cleaned !== String(model.name || "").trim()) namesChanged += 1;
    if (cleaned.length < 4) shortNames += 1;
    if (!/\p{Script=Latin}/u.test(cleaned)) latinlessNames += 1;
    const item = merged.get(key) || {
      id: model.civitaiModelId,
      familyId,
      versionId,
      versionName: String(model.versionName || "").trim(),
      baseModel: String(model.baseModel || "").trim(),
      name: cleaned,
      searchName: String(model.name || "").trim(),
      creator: String(model.creator || "").trim(),
      url: `https://civitai.com/models/${model.civitaiModelId}?modelVersionId=${versionId}`,
      nsfw: model.nsfw,
      tags: new Set(),
    };
    if (item.nsfw !== model.nsfw) throw new Error(`Conflicting NSFW values for Civitai model ${model.civitaiModelId}`);
    if (variantTag) item.tags.add(variantTag);
    merged.set(key, item);
  }
}

// The website loads this file, so leave out what it can rebuild or never searches: the Civitai
// link (rebuilt from id and versionId), a title or base model that repeats the name or family,
// bare version numbers, nsfw: false and empty tags.
function slim(checkpoint, familyLabel) {
  const out = { ...checkpoint };
  delete out.url;
  if (out.searchName === out.name) delete out.searchName;
  if (!out.baseModel || out.baseModel === familyLabel) delete out.baseModel;
  if (!out.versionName || /^v?\d+(?:\.\d+)*$/i.test(out.versionName)) delete out.versionName;
  if (!out.nsfw) delete out.nsfw;
  if (!out.tags?.length) delete out.tags;
  return out;
}

const checkpointGroups = new Map();
for (const item of merged.values()) {
  const { familyId, ...publicItem } = item;
  const list = checkpointGroups.get(familyId) || [];
  const checkpoint = slim({ ...publicItem, tags: [...item.tags].sort() }, runtimeFamilies[familyId]?.label);
  list.push(checkpoint);
  checkpointGroups.set(familyId, list);
}

// Mirrors canInpaint in server/family-profiles.js, minus the ComfyUI node check:
// an image family on the shared graph that takes an image in (an edit model's
// reference or img2img's start image) can inpaint.
const ownGraphs = new Set(["ideogram4", "mage", "h3", "sana", "pair"]);
const familyCanInpaint = (family) => family.kind === "image" && !ownGraphs.has(family.sampling) && !family.ownLoaders && Boolean(family.references || family.img2img);

const catalogFamilies = Object.entries(runtimeFamilies).map(([id, family]) => ({
  id,
  label: family.label,
  kind: family.kind,
  aliases: familyAliases[id] || [],
  ...(family.references ? { references: family.references } : {}),
  ...(familyCanInpaint(family) ? { inpaint: true } : {}),
  checkpoints: checkpointGroups.get(id) || [],
}));

const output = {
  schemaVersion: 3,
  source: {
    name: "Civitai public API",
    fileGeneratedAt: source.generatedAt,
    note: "Popularity discovery only; entries are not individually tested or guaranteed.",
  },
  families: catalogFamilies,
};
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(output)}\n`);

const checkpoints = catalogFamilies.flatMap((family) => family.checkpoints);
console.log(JSON.stringify({
  output: path.resolve(outputPath),
  runtimeFamilies: catalogFamilies.length,
  sourceRows: rowsSeen,
  familyCheckpointEntries: checkpoints.length,
  distinctCivitaiIds: new Set(checkpoints.map((item) => item.id)).size,
  nsfwYes: checkpoints.filter((item) => item.nsfw).length,
  nsfwNo: checkpoints.filter((item) => !item.nsfw).length,
  titleChanges: namesChanged,
  shortDisplayNames: shortNames,
  displayNamesWithoutLatinLetters: latinlessNames,
  invalidModelIdsSkipped: invalidIds,
  unsupportedVersionsSkipped,
  familiesWithCheckpoints: catalogFamilies.filter((family) => family.checkpoints.length).length,
}, null, 2));
