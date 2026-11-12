# Rename a 0.3 site's stored names once, rather than read both

The rename to First (#243) changed every name the runtime stores: tables, post types, meta keys,
options, roles, job and hook names, the identity tables and the session digest. Sites that ran a
0.3.0 build keep their data under the `zero` names. Three hosted Spaces are such sites.

## Choice

First renames that data to its own names once, on the first boot of a First runtime on such a site
(`First\Wp\ZeroNames`, `First\Identity\Legacy\ZeroNames`), and reads only First's names from then on.
Signed-in sessions are carried lazily: a session stored under the 0.3 digest is re-keyed to First's
digest the first time its cookie is presented (`First\Identity\Legacy\ZeroSession`).

The alternative was permanent dual-name reads: every table lookup, post type, meta key and option
read checking `first_` and then `zero_`. That spreads the old names through the whole runtime
forever, and makes each name ambiguous when both exist. A one-time rename keeps one name per thing.

## Costs and guards

- **It moves customer data.** It only renames: no drop, delete or overwrite. A First name that already
  exists stops it with the conflict named, while WordPress keeps serving and First's API answers 503.
  It runs under a named lock and checks state before each step, so an interrupted run resumes and a
  second run is a no-op. It runs only where a 0.3 runtime left its marker (`zero_runtime_tables`,
  `zero_runtime_site_id` or a `zero__migrations` ledger); another plugin's `zero_` names elsewhere are
  never touched.
- **It is one-way.** A 0.3 build can't read the renamed data, so a host must not roll a site back to a
  0.3 version once a First build has initialized on it.
- **The 20-character post type limit.** `first_` is one character longer than `zero_`. A collection
  whose First post type would exceed 20 characters is not renamed or truncated: its posts stay under
  the old type, recorded in `first_zero_names.kept`, with an admin notice and the compiler's refusal of
  that name pointing at the fix. None of the deployed Spaces has one (their collection names are at
  most 5 characters).
- **Proof.** `tests/wp/zero-upgrade/` starts from a database and private files written by the real
  0.3.0 runtime (`stage.sh` regenerates them from commit `61c22fc2`), upgrades on real WordPress and
  MariaDB, and reads every row, file, account, session and queued job back through First.

Delete the three classes once no site with a 0.3 marker remains and every 0.3 session has expired.
