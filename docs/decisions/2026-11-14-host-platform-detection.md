# `navigator.platform` and `process.platform` come from the server

npm packages detect Windows with `typeof navigator`, `navigator.platform`,
`typeof process` and `process.platform` (picomatch's `isWindows` uses all
four). Node 21+ defines both objects, so refusing these forms stopped real
packages, and treating `navigator` as undefined would send code down a
different branch than it takes under Node.

## Decisions

- `typeof navigator` and `typeof process` are `"object"`, also through
  `globalThis.`. This is a compile-time constant and the build-time evaluator
  gives the same answer.
- `navigator.platform` and `process.platform` are strings read when PHP runs,
  from `First\Host`. They are never decided from the machine that ran the
  build: the build machine and the WordPress server can be different
  operating systems, and the compiled PHP must not depend on who built it.
- `process.platform` uses Node's names: `win32`, `darwin`, `sunos`, and
  otherwise the lower-cased `PHP_OS` (`linux`, `freebsd`, `openbsd`, `aix`).
- `navigator.platform` follows Node's own rule over platform and CPU
  architecture: `Win32`, `MacIntel`, `Linux x86_64`, `Linux arm64`,
  `FreeBSD amd64`, `AIX`. The architecture is `php_uname('m')` mapped to
  Node's names. Where a host disables `php_uname`, 64-bit PHP reports `x64`
  and 32-bit PHP reports `ia32`; this is an approximation and only affects
  the suffix on Linux, BSD and Solaris.
- While a module's top level is evaluated at build time, reading either
  `.platform` is a located error. The value does not exist yet, so the
  evaluator never produces one that the server could contradict.
- Every other member stays a located error: `navigator.userAgent`,
  `navigator.language`, `navigator.languages`, `navigator.hardwareConcurrency`,
  `process.arch`, `process.version`, `process.versions`, `process.release`,
  `process.argv`, `process.cwd()` and the rest. Node defines them, so
  answering `undefined` would be a silent difference, and First has no true
  value to give. `process.env.NAME` is unchanged.
- `navigator` and `process` are not values. Passing, assigning, testing them
  alone (`if (process)`), indexing them or reaching them through `globalThis`
  for anything but `typeof` is refused.
- Detecting Node itself (`process.versions.node`, `process.release.name`) is
  not decided here.

## Where it happens

`typeof` is answered in `eval.rs` and in `Compiler::global_type_of`. The two
reads lower in `Compiler::host_member` and report `HostUse::Platform` through
`host_use`, like every other host read. The mapping is one pure function in
`First\Host` that takes the PHP family, OS name and machine name, so every
operating system is tested on one runner.
