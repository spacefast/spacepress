# Spacefast verification

Checked on 2026-11-08 using `spacefast/0.8.0` against the production service.
The example was compiled locally from First main
`b66e98b3866037061198c51ebef9534609a5e301`.

## Commands and receipt

`sf first check` returned:

```text
Command zero:check not found.
Run with --help to see the supported usage.
```

The requested `spacefast-examples` team was absent from the accessible teams.
`sf teams create spacefast-examples --json` created a team with that display
name. Its generated slug is `my-team-41`. The new Space's `teamId` was compared
with the team creation receipt and matched.

From the example directory, the publish command used that team's returned ID:

```sh
sf publish --team team_b65faad473cf46189230addaade3991a \
  --name 'Home maintenance' --slug home-maintenance --access team --no-wait --json
```

Receipt fields:

```json
{
  "spaceId": "spc_b8e2e709834442178b31b399ec1bf139",
  "liveUrl": "https://home-maintenance.space.fast/",
  "versionId": "ver_a7884a8fb58240f8ab1d2df6109c5cc9",
  "immutableUrl": "https://home-maintenance--v1.space.fast/"
}
```

After readiness, `sf spaces get --space spc_b8e2e709834442178b31b399ec1bf139 --json`
reported:

```json
{
  "hasRuntime": false,
  "runtimeState": "active",
  "liveVersionStatus": "ready",
  "app": { "capsule": null, "worker": null },
  "runtimeCodeDetected": false,
  "diagnostics": [{
    "code": "files_mode_inferred",
    "message": "No HTML files were found in the root of this version, so it serves in files mode with directory listing enabled."
  }]
}
```

The published version records base revision
`b66e98b3866037061198c51ebef9534609a5e301` and `dirty: true`. It contains the
source present during the publish attempt, not the final PR revision. The
available CLI did not capture a First runtime. This is a restricted static
source publication, not a working hosted app.

## Access restriction

`sf share list` showed an open-link grant despite `--access team`.
The open grant was removed:

```sh
sf share revoke grt_3c4d3d5c20fe4e65881f04c10ecc2f07 \
  --space spc_b8e2e709834442178b31b399ec1bf139 --json --yes
```

Response:

```json
{"data":{"id":"grt_3c4d3d5c20fe4e65881f04c10ecc2f07","revoked":true}}
```

After revocation, the active grants were the owning-team live grant and
owning-team versions grant. A temporary machine credential, restricted to the
tested paths and expiring after 30 minutes, was created for verification and
then revoked. No credential is included in this report.

`sf share check --as public --path /wp-json/first/v1/systems` returned no
matching grants and no capabilities. The same check with `--as team` returned
the owning-team grant and `page.view`.

## Live probes

The collection probe:

```sh
curl -i https://home-maintenance.space.fast/wp-json/first/v1/systems
```

returned HTTP 403 and an HTML page titled `This space is private`.

Authenticated machine probes used a temporary `Authorization: Bearer` header:

| Request | Result |
| --- | --- |
| `GET /wp-json/first/v1/systems` | HTTP 403 |
| `POST /wp-json/first/v1/actions/dueNext`, body `{"days":30}` | HTTP 403 |
| `GET /wp-login.php` | HTTP 403 |
| `GET /first-identity/sign-in` | HTTP 403 |

Every machine probe returned this exact body:

```json
{"type":"https://spacefast.com/docs/errors/access_denied","title":"Access denied","status":403,"detail":"This space is private.","code":"access_denied","page":"access"}
```

The access restriction is verified. A live collection read, action execution,
WordPress sign-in, private manual download, and First Admin are not verified.
The current service and CLI must support the documented First deployment
contract before those checks can succeed.
