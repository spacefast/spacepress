// Composes the lane modules' config options for the WP test app. Each map is merged key by key and a
// key defined twice fails the build, so one lane can never silently replace another lane's option.

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
