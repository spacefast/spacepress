export async function resolve(specifier, context, next) {
  if (specifier === "zero") return { url: new URL("./zero-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
