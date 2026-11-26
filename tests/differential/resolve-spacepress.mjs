export async function resolve(specifier, context, next) {
  if (specifier === "spacepress" || specifier === "spacepress/server") {
    return { url: new URL("./spacepress-shim.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
