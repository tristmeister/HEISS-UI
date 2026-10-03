import React, { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { Field, NumberPicker, StudioSelect as Select } from './components';
import type { WorkflowSetting } from './types';

export type WorkflowSettingValues = Record<string, Record<string, string | number | boolean>>;

const storageKey = "heiss-ui-workflow-settings";

/** Remembered "More settings" values, per workflow. Lost storage just means the workflow's own values. */
export function loadWorkflowSettingValues(): WorkflowSettingValues {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function saveWorkflowSettingValues(values: WorkflowSettingValues) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // Private window or full storage: the values still apply until reload.
  }
}

function SettingControl({ setting, value, onChange }: { setting: WorkflowSetting; value: string | number | boolean | undefined; onChange: (value: string | number | boolean) => void }) {
  const current = value ?? setting.default ?? "";
  if (setting.type === "BOOLEAN") {
    return (
      <label className="wf-setting-toggle">
        <input type="checkbox" checked={Boolean(current)} onChange={(event) => onChange(event.target.checked)} />
        <span>{setting.label}</span>
      </label>
    );
  }
  if (setting.type === "INT" || setting.type === "FLOAT") {
    const precision = setting.type === "FLOAT" ? Math.min(3, Math.max(1, String(setting.step ?? 0.01).split(".")[1]?.length || 2)) : 0;
    return (
      <NumberPicker
        label={setting.label}
        value={Number(current) || 0}
        onChange={(next: number) => onChange(setting.type === "INT" ? Math.round(next) : next)}
        min={setting.min ?? (setting.type === "INT" ? -1e9 : -1e6)}
        max={setting.max ?? 1e9}
        step={setting.step || (setting.type === "INT" ? 1 : 0.05)}
        precision={precision}
        fill
      />
    );
  }
  if (setting.type === "COMBO" && setting.options?.length) {
    return <Field label={setting.label}><Select value={String(current)} onChange={(next: string) => onChange(next)} options={setting.options} /></Field>;
  }
  return (
    <Field label={setting.label}>
      {setting.multiline || String(current).length > 60
        ? <textarea className="wf-setting-text" value={String(current)} onChange={(event) => onChange(event.target.value)} rows={3} />
        : <input value={String(current)} onChange={(event) => onChange(event.target.value)} />}
    </Field>
  );
}

/**
 * An imported workflow's other knobs, grouped by the node titles its author
 * gave them. Untouched ones keep the workflow's saved values.
 */
export function WorkflowSettingsPanel({ settings, values, onChange, onReset }: {
  settings: WorkflowSetting[];
  values: Record<string, string | number | boolean>;
  onChange: (key: string, value: string | number | boolean) => void;
  onReset: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WorkflowSetting[]>();
    for (const setting of settings) {
      const group = setting.group || "Workflow";
      map.set(group, [...(map.get(group) || []), setting]);
    }
    return [...map];
  }, [settings]);
  const changed = Object.keys(values || {}).length;
  if (!settings.length) return null;
  return (
    <section className="wf-settings" aria-label="More settings">
      <div className="wf-settings-head">
        <h4>More settings</h4>
        {changed ? <button type="button" className="btn is-ghost" onClick={onReset}><RotateCcw size={12} /> As saved</button> : null}
      </div>
      {groups.map(([group, items]) => (
        <details key={group} className="wf-settings-group" open={groups.length <= 2}>
          <summary>{group}</summary>
          <div className="wf-settings-grid">
            {items.map((setting) => (
              <SettingControl key={setting.key} setting={setting} value={values?.[setting.key]} onChange={(next) => onChange(setting.key, next)} />
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
