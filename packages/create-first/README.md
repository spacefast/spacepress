# Create a First app

After publication, `npm create @spacefast/first@0.3.0 my-app` creates a typed backend, a working public frontend and editor settings, then installs the matching compiler package. The app it creates is content only: one `collection()`, stored as WordPress posts. `first add db` in the new project adds SQL tables when the app needs them. `cd my-app && npm run dev` starts WordPress and watches your sources. Node.js 22+ and npm are required; Rust and Docker are not.

Use `-- --no-install` to write files without installing packages. Existing destinations, including empty directories and symbolic links, are refused. Failed dependency installation preserves the new project so you can fix the error and retry.

Maintainers testing an unpublished compiler tarball can set `FIRST_CLI_PACKAGE=/absolute/path/to/spacefast-first-cli-0.3.0.tgz`. `FIRST_BIN` and the compiler's release mirror/cache settings flow through npm installation. These package names and the matching binary release must be published before the public command is usable.
