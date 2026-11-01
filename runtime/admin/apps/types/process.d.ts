/**
 * `process.env.NODE_ENV` is substituted at build time by the esbuild `define`
 * in wp-build; the sources never touch a real `process` object.
 */
declare const process: { env: { NODE_ENV?: string } };
