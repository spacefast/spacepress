// Composes the shared WP test app with the phase-2 lane fragments in ./lanes. Every map is merged
// key by key and a key defined twice fails the build, so one lane can never silently replace a
// shared fixture or another lane's entry. Hooks merge per collection and per event.

type Map = Record<string, unknown>;

export function merge(what: string, parts: Map[]): Map {
  const out: Map = {};
  for (const part of parts) {
    for (const key of Object.keys(part)) {
      if (Object.hasOwn(out, key)) throw new Error(`the WP test app defines ${what} "${key}" twice`);
      out[key] = part[key];
    }
  }
  return out;
}

/** Hooks keyed by collection, then event: two lanes may hook one collection, never one event. */
export function mergeHooks(parts: Record<string, Map>[]): Record<string, Map> {
  const out: Record<string, Map> = {};
  for (const part of parts) {
    for (const collection of Object.keys(part)) {
      out[collection] = merge(`a ${collection} hook`, [out[collection] ?? {}, part[collection]]);
    }
  }
  return out;
}
