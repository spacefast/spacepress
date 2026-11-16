# TypedPress command

This package downloads the matching prebuilt compiler from `spacefast/zero` GitHub releases and verifies its SHA-256 before installing it. It never invokes Cargo. macOS and glibc 2.39+ Linux (Ubuntu 24.04+) on arm64 and x64 are supported; Windows, older glibc and musl require your own compiler through `TP_BIN`.

After this version has been published:

```sh
npm install --global typedpress
typedpress --help
```

Node.js 22+ and npm are required. `typedpress dev` installs pinned WordPress Studio, which provides PHP, WordPress and SQLite without Docker. Do not use local development credentials on a public site.

`TP_BIN=/absolute/path/to/typedpress` selects a compiler you provide. `TP_CACHE_DIR` sets an absolute download cache; `TP_OFFLINE=1` permits only an existing verified cache or `TP_BIN`. `TP_RELEASE_BASE_URL` selects an HTTPS release mirror or a `file://` directory containing actual release archives and checksum files. A missing release fails with an actionable error.

The npm launcher is MIT. The downloaded archive carries the compiler/runtime component licenses and upstream notices. SHA-256 verifies download integrity; release signing is a separate publication step.
