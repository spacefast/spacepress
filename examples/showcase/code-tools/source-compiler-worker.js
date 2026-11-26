import {Compiler} from './compiler.js';

let compiler;
self.addEventListener('message', async ({data}) => {
  try {
    if (!compiler) {
      const response = await fetch(new URL('./spacepress.wasm', import.meta.url), {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Compiler download failed (${response.status}).`);
      compiler = await Compiler.load(await response.arrayBuffer());
    }
    self.postMessage({id: data.id, result: compiler.compile(data.request)});
  } catch (error) {
    self.postMessage({id: data.id, error: error instanceof Error ? error.message : String(error)});
  }
});
