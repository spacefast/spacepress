/**
 * Throws an error whose stack begins with a frame naming a file whose path ends with the
 * bundle's own path but is a different file, at a position that would map to the `other` line
 * below. The compiler must not map that frame; the diagnostic names the `error` line.
 */
export default function DecoyFrame() {
  const other = new Error("other");
  const error = new Error("decoy at build time");
  const frameOf = (e: Error) => (e.stack ?? "").split("\n").find((line) => /module\.mjs:\d+:\d+/.test(line)) ?? "";
  const decoy = frameOf(other).replace("file:///", "file:///another/").replace("(/", "(/another/");
  const own = (error.stack ?? "").split("\n");
  error.stack = [own[0], decoy, ...own.slice(1)].join("\n");
  throw error;
}
