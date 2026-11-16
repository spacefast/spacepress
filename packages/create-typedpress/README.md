# Create a TypedPress app

After publication, `npm create typedpress@0.3.0 my-app` creates a typed backend, a working public frontend and editor settings, then installs the matching compiler package. The app it creates is content only: one `collection()`, stored as WordPress posts. `typedpress add db` in the new project adds SQL tables when the app needs them. `cd my-app && npm run dev` starts WordPress and watches your sources. Node.js 22+ and npm are required; Rust and Docker are not.

After installing, it runs `typedpress init` in the new project: `AGENTS.md`, `.mcp.json` and the agent skills, generated from the project's own config, so a coding agent can work in it from the first commit. With `--no-install` that step uses `TP_BIN` when it is set; otherwise run `npx typedpress init` after `npm install`.

Use `-- --no-install` to write files without installing packages. Existing destinations, including empty directories and symbolic links, are refused. Failed dependency installation preserves the new project so you can fix the error and retry.

Maintainers testing an unpublished compiler tarball can set `TP_CLI_PACKAGE=/absolute/path/to/typedpress-0.3.0.tgz`. `TP_BIN` and the compiler's release mirror/cache settings flow through npm installation. These package names and the matching binary release must be published before the public command is usable.
