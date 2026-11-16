export async function resolve(specifier, context, next) {
  if (specifier === "typedpress") return { url: new URL("./typedpress-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
