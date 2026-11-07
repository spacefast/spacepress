# Zero 0.8 finalize manifest

`finalize.json` is the finalize payload Zero 0.8's own compiler (`compileZeroCapsule` in
spacefast/monorepo `legacy/zero-0.8/packages/zero-compile`) produced for `../endpoints`, with a
`client/main.tsx` that exports `App`. It keeps `runtimeKind`, `artifact` and one of the eleven
`endpointSources` (the `/api/files/:splat` bundle); static files, run sources and the other
bundles are dropped to keep the fixture small. `sourceRoot` is rewritten to `/build/endpoints`.

The recorded hashes are those of `../endpoints/server/index.ts` and that `client/main.tsx`, so a
test that copies both next to each other reproduces the published source.
