# @spacefast/zero-v2

Zero compiles `zero.config.ts` into a PHP backend: MySQL migrations, a REST
API, auth, a typed client and WordPress plugins. See
[github.com/spacefast/zero](https://github.com/spacefast/zero).

```sh
npm install --save-dev @spacefast/zero-v2
npx zero check
npx zero build
npx zero dev
```

The package carries the native `zero` binary for darwin-arm64, darwin-x64,
linux-arm64, linux-x64 and win32-x64 as optional dependencies; npm installs the
one for your machine. Installing with `--omit=optional` leaves the binary out.

## From JavaScript

```js
import { binaryPath } from "@spacefast/zero-v2";
import { compile } from "@spacefast/zero-v2/wasm";

binaryPath(); // the installed `zero` binary

const { check, output } = compile({
  name: "journal",
  files: { "zero.config.ts": source },
});
```

`compile` runs the compiler core as WebAssembly, in process, with no binary and
no file system. `check` is the envelope `zero check --json` prints.

## Editor types

`zero.config.ts` imports from `"zero"`. Point that module at the types this
package ships:

```json
{
  "compilerOptions": {
    "paths": { "zero": ["./node_modules/@spacefast/zero-v2/types/index.d.ts"] }
  }
}
```
