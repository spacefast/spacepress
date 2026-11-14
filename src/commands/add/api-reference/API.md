# The API reference

`first add api-reference` wrote these files. They are yours: change the markup, the styles and
the URLs as you like.

| File | Serves |
| --- | --- |
| `first/app/api/page.tsx` | `/api`: every operation, by tag |
| `first/app/api/[tag]/[operation]/page.tsx` | `/api/<tag>/<operation>`: one operation |
| `first/components/ApiFields.tsx` | the list of an operation's parameters, body or response fields |

Both pages read `apiReference()` from `"first/content"`. It returns the OpenAPI document
`first build` writes for this app (`first/_generated/openapi.json`), as the site serves it at
`/__first/api/v1/openapi.json`, so the reference follows the schema on every build.

- Each operation has `method`, `path`, `summary`, `description` and `access`, `params`, `body`
  and `responses` as field lists, and `curl` and `fetch` samples.
- A field is `{ name, depth, type, required, description, constraints, in }`. Indent by `depth`.
- Descriptions are HTML, from the document's Markdown: render them with `<Html value>`.
- For another API, put its OpenAPI JSON in `public/` and call `apiReference("that-api.json")`.

The whole reference: [docs/config-api.md](https://github.com/spacefast/zero/blob/main/docs/config-api.md#an-api-reference-on-the-site).
