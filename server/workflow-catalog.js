import fs from "node:fs";
import path from "node:path";
import { dataDir, gallery } from './gallery-store.js';
import { allCustomWorkflowRecords, detectWorkflowFormat, detectWorkflowMetadata, graphFromJson, validateGraph } from './custom-workflows.js';

const preferencesPath = path.join(dataDir, "workflow-preferences.json");
let preferencesCache = null;
let preferencesSaveTimer = null;

export function loadWorkflowPreferences() {
  if (preferencesCache) return preferencesCache;
  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
    preferencesCache = {
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      lastUsed: raw.lastUsed && typeof raw.lastUsed === "object" ? raw.lastUsed : {},
      thumbnails: raw.thumbnails && typeof raw.thumbnails === "object" ? raw.thumbnails : {}
    };
    return preferencesCache;
  } catch {
    preferencesCache = { favorites: [], lastUsed: {}, thumbnails: {} };
    return preferencesCache;
  }
}

export function saveWorkflowPreferences(preferences, { immediate = false } = {}) {
  preferencesCache = preferences;
  if (!immediate) {
    if (!preferencesSaveTimer) {
      preferencesSaveTimer = setTimeout(() => {
        preferencesSaveTimer = null;
        saveWorkflowPreferences(preferencesCache, { immediate: true });
      }, 300);
    }
    return;
  }
  if (preferencesSaveTimer) {
    clearTimeout(preferencesSaveTimer);
    preferencesSaveTimer = null;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2));
}

export function updateWorkflowPreferencePatch(patch = {}) {
  const current = loadWorkflowPreferences();
  const next = {
    favorites: Array.isArray(patch.favorites) ? patch.favorites : current.favorites,
    lastUsed: { ...current.lastUsed, ...(patch.lastUsed || {}) },
    thumbnails: { ...current.thumbnails, ...(patch.thumbnails || {}) }
  };
  saveWorkflowPreferences(next);
  return next;
}

export function markWorkflowUsed(profileId, thumbnail = "") {
  if (!profileId) return loadWorkflowPreferences();
  const patch = { lastUsed: { [profileId]: new Date().toISOString() } };
  if (thumbnail) patch.thumbnails = { [profileId]: thumbnail };
  return updateWorkflowPreferencePatch(patch);
}

function controlsList(controls = {}) {
  return Object.keys(controls).filter((key) => controls[key]?.node && controls[key]?.input);
}

function validateWorkflow(workflow, info = {}, profile = null) {
  const issues = [];
  const warnings = [];
  if (workflow.parseError) issues.push(workflow.parseError);
  try {
    validateGraph(workflow.graph);
  } catch (error) {
    issues.push(error.message);
  }
  for (const classType of workflow.requiredNodes || []) {
    if (classType && !info[classType]) issues.push(`Missing node class: ${classType}`);
  }
  const graph = workflow.graph || {};
  for (const [key, mapping] of Object.entries(workflow.controls || {})) {
    if (!mapping?.node || !mapping?.input) continue;
    const node = graph[mapping.node];
    if (!node) {
      issues.push(`Mapped ${key} node is missing: ${mapping.node}`);
      continue;
    }
    if (!(mapping.input in (node.inputs || {}))) issues.push(`Mapped ${key} input is missing: ${mapping.node}.${mapping.input}`);
  }
  if (workflow.kind !== "image" && workflow.kind !== "video") issues.push(`Unsupported workflow kind: ${workflow.kind}`);
  if (workflow.graph && Object.keys(workflow.graph).length && !Object.values(workflow.graph).some((node) => /Save|Preview|Video/i.test(node?.class_type || ""))) {
    warnings.push("No save/output node detected.");
  }
  return {
    ok: issues.length === 0 && (profile ? true : !workflow.profileId || Boolean(profile)),
    issues,
    warnings,
    missingNodes: issues.filter((issue) => issue.startsWith("Missing node class:")).map((issue) => issue.replace("Missing node class:", "").trim())
  };
}

function latestThumbnailFor(profileId, workflowId, prefs) {
  if (prefs.thumbnails?.[profileId]) return prefs.thumbnails[profileId];
  const match = gallery.find((item) => item.status === "done" && item.url && (item.settings?.profileId === profileId || item.settings?.workflow === workflowId || item.settings?.workflow === profileId || item.model === profileId));
  return match?.url || "";
}

function automaticTags(item, prefs) {
  const tags = [];
  if (prefs.favorites.includes(item.id)) tags.push("Favorite");
  if (prefs.lastUsed[item.id]) tags.push("Recent");
  tags.push(item.source === "builtin" ? "Built-in" : "Custom");
  tags.push(item.kind === "video" ? "Video" : "Image");
  tags.push(item.validation.ok ? "Ready" : "Broken");
  if (item.family) tags.push(item.family);
  return [...new Set(tags)];
}

export function workflowSummaries({ info = {}, profiles = [], preferences = loadWorkflowPreferences() } = {}) {
  const summaries = [];
  const customRecords = allCustomWorkflowRecords();
  const customByProfile = new Map(customRecords.map((workflow) => [workflow.profileId, workflow]));
  for (const profile of profiles) {
    const isCustom = profile.id.startsWith("custom:");
    const custom = isCustom ? customByProfile.get(profile.id) : null;
    const id = profile.id;
    const summary = {
      id,
      profileId: profile.id,
      workflow: profile.workflow,
      name: profile.displayName || profile.label,
      description: profile.description || "",
      kind: profile.kind,
      family: profile.family,
      // Every workflow-JSON profile is `custom:*`, bundled or not, so the id
      // prefix cannot tell them apart - use the record's actual folder.
      source: custom ? (custom.source === "bundled" ? "builtin" : "custom") : isCustom ? "custom" : "builtin",
      deleteId: custom?.id || (isCustom ? profile.id.replace(/^custom:/, "") : ""),
      controls: [],
      capabilities: profile.capabilities || {},
      defaults: profile.defaults || {},
      path: custom?.path || "",
      favorite: preferences.favorites.includes(id),
      lastUsedAt: preferences.lastUsed[id] || "",
      thumbnail: latestThumbnailFor(id, profile.workflow, preferences),
      validation: { ok: true, issues: [], warnings: [], missingNodes: [] }
    };
    summary.tags = automaticTags(summary, preferences);
    summaries.push(summary);
  }

  const known = new Set(summaries.map((item) => item.profileId));
  for (const workflow of customRecords) {
    if (known.has(workflow.profileId)) continue;
    const validation = validateWorkflow(workflow, info, null);
    const summary = {
      id: workflow.profileId,
      profileId: workflow.profileId,
      workflow: workflow.profileId,
      name: workflow.name,
      description: workflow.description || "",
      kind: workflow.kind,
      family: workflow.family,
      source: workflow.source === "bundled" ? "builtin" : "custom",
      deleteId: workflow.source === "bundled" ? "" : workflow.id,
      controls: controlsList(workflow.controls),
      capabilities: workflow.capabilities || {},
      defaults: workflow.defaults || {},
      path: workflow.path || "",
      favorite: preferences.favorites.includes(workflow.profileId),
      lastUsedAt: preferences.lastUsed[workflow.profileId] || "",
      thumbnail: latestThumbnailFor(workflow.profileId, workflow.profileId, preferences),
      validation
    };
    summary.tags = automaticTags(summary, preferences);
    summaries.push(summary);
  }
  return summaries.sort((a, b) => {
    const fav = Number(b.favorite) - Number(a.favorite);
    if (fav) return fav;
    const recent = Date.parse(b.lastUsedAt || "0") - Date.parse(a.lastUsedAt || "0");
    if (recent) return recent;
    return a.name.localeCompare(b.name);
  });
}

export function previewWorkflowImport(raw, filename = "", info = {}) {
  const format = detectWorkflowFormat(raw);
  if (format === "unsupported") throw new Error("Unsupported JSON. Expected a ComfyUI API workflow or a visual workflow with nodes and links.");
  const source = format === "comfyui-api-wrapper" ? raw.prompt : raw;
  const graph = graphFromJson(format === "comfyui-visual" ? { ...raw } : source, info);
  const detected = detectWorkflowMetadata({ ...source, graph }, path.basename(filename || "", path.extname(filename || "")), info);
  const validation = validateWorkflow({
    id: detected.id,
    profileId: `custom:${detected.id}`,
    name: detected.name,
    description: detected.description,
    kind: detected.kind,
    family: detected.family,
    graph,
    controls: detected.controls,
    requiredNodes: [...new Set(Object.values(graph || {}).map((node) => node?.class_type).filter(Boolean))],
    capabilities: detected.capabilities
  }, {}, null);
  return {
    filename,
    graph,
    detected,
    format,
    hasJaiStudio: Boolean(raw?.jAiStudio || raw?.j_ai_studio),
    validation
  };
}
