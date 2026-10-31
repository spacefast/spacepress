# Notices for packages that publish none

`build.mjs` writes `../build/THIRD-PARTY-LICENSES.txt` from the license file
each bundled package ships. A few packages declare `"license": "MIT"` in
`package.json` but publish no license text, so the notice their license
requires is carried here instead, copied from the package's upstream
repository and named `<package>@<version>.txt` (scoped packages use `+` for
the slash). The build fails when a bundled package has neither a shipped
license file nor an entry here.
