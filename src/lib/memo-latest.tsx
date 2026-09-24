import { memo, useRef, type ComponentType } from "react";

/**
 * React.memo for props built fresh on every render of a large parent, as App's are.
 *
 * - Function props become stable proxies that always call the newest function,
 *   so a skipped render never runs a stale closure.
 * - Plain objects and arrays (up to `depth` levels, e.g. `view.loraLibrary`)
 *   count as unchanged when their entries are.
 *
 * Only for children that never rely on a callback's identity changing (an
 * effect keyed on it would stop re-running).
 */
export function memoLatest<P extends object>(Component: ComponentType<P>, depth = 4) {
  const Inner = memo(Component as ComponentType<any>);
  function Latest(props: P) {
    return <Inner {...useStableProps(props, depth)} />;
  }
  Latest.displayName = `memoLatest(${Component.displayName || Component.name || "Component"})`;
  return Latest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function useStableProps<T>(value: T, depth = 4): T {
  const latest = useRef(value);
  latest.current = value;
  const proxies = useRef(new Map<string, (...args: unknown[]) => unknown>());
  const previous = useRef<unknown>(undefined);

  const stabilize = (next: unknown, prev: unknown, path: string, level: number): unknown => {
    if (typeof next === "function") {
      let proxy = proxies.current.get(path);
      if (!proxy) {
        proxy = (...args: unknown[]) => {
          let target: any = latest.current;
          for (const key of path.split("\0").slice(1)) target = target?.[key];
          return target?.(...args);
        };
        proxies.current.set(path, proxy);
      }
      return proxy;
    }
    if (next === prev || level <= 0) return next;
    if (isPlainObject(next)) {
      const before = isPlainObject(prev) ? prev : null;
      const keys = Object.keys(next);
      let same = Boolean(before) && keys.length === Object.keys(before!).length;
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        out[key] = stabilize(next[key], before?.[key], `${path}\0${key}`, level - 1);
        if (!before || out[key] !== before[key]) same = false;
      }
      return same ? before : out;
    }
    if (Array.isArray(next)) {
      const before = Array.isArray(prev) && prev.length === next.length ? prev : null;
      const out = next.map((item, index) => stabilize(item, before?.[index], `${path}\0${index}`, level - 1));
      return before && out.every((item, index) => item === before[index]) ? before : out;
    }
    return next;
  };

  const stable = stabilize(value, previous.current, "", depth) as T;
  previous.current = stable;
  return stable;
}
