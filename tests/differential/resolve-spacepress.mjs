export async function resolve(specifier, context, next) {
  if (specifier === "spacepress") return { url: new URL("./spacepress-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
