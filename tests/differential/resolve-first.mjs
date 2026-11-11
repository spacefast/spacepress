export async function resolve(specifier, context, next) {
  if (specifier === "first") return { url: new URL("./first-shim.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
