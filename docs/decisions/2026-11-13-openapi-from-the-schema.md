# The OpenAPI document is compiled from the schema

Date: 2026-11-13. Status: accepted. Spec: [spec.md](../spec/spec.md) §3a, §7.

## Problem

spec.md §7 lists `_generated/openapi.json` as a build output. The only OpenAPI document was one
the docs site wrote by hand in `docs-site/scripts/generate.ts`: generic paths (`/{collection}`),
no field schemas, and string checks against the PHP dispatchers to notice when a route changed.
It described no particular app, and nothing tied it to what the typed client or the Abilities say
about the same fields.

## Decision

`first build` writes `first/_generated/openapi.json` for the app, from the evaluated schema
(`src/openapi.rs`). That schema is the one input of schema.php, which the runtime turns into
Ability schemas, and of the typed client.

- **Field schemas are the Abilities'.** `src/json_schema.rs` is the compiler's copy of
  `Wp\Abilities\JsonSchema`: a kind's row, create input and patch, a global's values, an action's
  input. A test builds an app, asks the running site for its registered Ability schemas and
  compares them with the document's, so the two copies cannot differ unnoticed. An action's result
  is the output schema the compiler already infers for its Ability.
- **Names are the client's.** A component is named as the client's interface for the same value
  (`Post`, `PostInsert`, `PostPatch`, `PostFilter`), from the same function. An `operationId` is the
  client call that makes the request (`posts.list`).
- **Operations follow the schema.** A kind's `api` flags, `revisions`, `sync`, an action's
  `readonly` and `signature`, the file buckets and the `services` config decide which paths exist.
  WordPress's own kinds are described with the field names `Wp\Kinds` maps them to.
- **Access is stated, not enforced.** Each operation's description says who may call it and
  `x-first-access` carries the rule's short name, as `GET /__first/api/v1` already does. A rule
  written as a function is `rule`: the document cannot say more about it. OpenAPI `security` lists
  the three ways core accepts a sign-in; an operation that also answers anonymously says so.
- **The site serves the build's file.** The app plugin carries the document, and
  `GET /__first/api/v1/openapi.json` answers with it, with the site's address in `servers`
  (`First\OpenApi`, registered like the other features that own a path below the API). It is public
  and cacheable: it holds what `GET /__first/api/v1` already tells anyone, and nothing about rows.

The docs site's reference is now the compiler's document for the blog example; the hand-written
copy and its string checks are deleted.

## What the tests hold

- The document validates against the JSON Schema the OpenAPI Initiative publishes for 3.1.
- A fixture app with one of everything is built and served on WordPress. Every operation in its
  document is called at least once, with the roles its rules name, and each answer must have the
  status's content type and match its response schema, read strictly (a field the API returns and
  the document leaves out fails). Accepted requests are checked against the request schemas too.

## Not done

`spec.json`, the other file §7 names beside `openapi.json`, is not written: the spec does not say
what it holds. `GET /__first/api/v1` serves the app's schema to clients today.

The `where` filter is described one level deep with shared operator schemas per field type. A
filter through a relation is an untyped object, as it is in the Abilities.
