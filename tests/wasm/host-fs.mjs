import fs from 'node:fs';
import path from 'node:path';

// The imports allocate with the module's allocator. Rust takes ownership of each result.
export function hostFs(getExports) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const bind = (operation) => (pointer, length) => {
    const exports = getExports();
    const name = decoder.decode(new Uint8Array(exports.memory.buffer, pointer, length));
    let response;
    try { response = { data: operation(name) }; }
    catch (error) { response = { error: { kind: error.code, message: error.message } }; }
    const bytes = encoder.encode(JSON.stringify(response));
    const out = exports.sp_alloc(bytes.length + 4);
    new DataView(exports.memory.buffer).setUint32(out, bytes.length, true);
    new Uint8Array(exports.memory.buffer, out + 4, bytes.length).set(bytes);
    return out;
  };
  return {
    read_file_bytes: bind((name) => fs.readFileSync(name).toString('base64')),
    canonicalize: bind((name) => fs.realpathSync(name)),
    read_dir: bind((name) => fs.readdirSync(name).map((entry) => path.join(name, entry))),
    stat: bind((name) => {
      const link = fs.lstatSync(name);
      const stat = link.isSymbolicLink() ? fs.statSync(name, { throwIfNoEntry: false }) : link;
      return { file: stat?.isFile() ?? false, directory: stat?.isDirectory() ?? false, symlink: link.isSymbolicLink() };
    }),
  };
}

export function call(exports, operation, request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const input = exports.sp_alloc(bytes.length);
  new Uint8Array(exports.memory.buffer, input, bytes.length).set(bytes);
  const output = exports[operation](input, bytes.length);
  const length = new DataView(exports.memory.buffer).getUint32(output, true);
  const response = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, output + 4, length));
  exports.sp_free(output, length + 4);
  return JSON.parse(response);
}
