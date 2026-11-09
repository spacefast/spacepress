// The front page's proof: compile the pantry example in the visitor's browser and report.
import { Compiler, type Request } from "./compiler.ts";

const status = document.getElementById("status")!;
const request = JSON.parse(status.dataset.request!) as Request;
const wasm = status.dataset.wasm!;
try {
  const compiler = await Compiler.load(fetch(wasm));
  const { check, output } = compiler.compile(request);
  status.dataset.state = check.ok ? "ok" : "diagnostics";
  status.textContent =
    check.ok && output
      ? `ok: first ${check.compilerVersion} compiled ${request.name}: ${output.migrations.map(([name]) => name).join(", ")}, ${Object.keys(output.client).join(", ")}, schema.php (${output.schemaPhp.length} bytes)`
      : check.diagnostics
          .map((d) => `${d.location?.file}:${d.location?.line}:${d.location?.column}: ${d.message}`)
          .join("\n");
} catch (error) {
  status.dataset.state = "failed";
  status.textContent = String(error);
}
