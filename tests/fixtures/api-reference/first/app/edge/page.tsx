import { Html } from "first/app";
import { apiReference } from "first/content";

// A document with what goes wrong in practice: blocks in a description, a quote in the server,
// a parameter the operation overrides, allOf, const, two media types and two colliding slugs.
export default function Edge() {
  const api = apiReference("edge-api.json");
  return (
    <main>
      <div className="description"><Html value={api.description} /></div>
      {api.tags.map((t) =>
        t.operations.map((o) => (
          <section key={o.slug} id={`${t.slug}--${o.slug}`}>
            <ul className="params">{o.params.map((f) => <li key={f.name}>{`${f.name}: ${f.type}`}</li>)}</ul>
            <p className="body">{`${o.bodyType} ${o.body.map((f) => f.name + (f.required ? "!" : "")).join(",")}`}</p>
            <ul className="fields">{o.responses.map((r) => r.fields.map((f) => <li key={f.name}>{`${f.name}: ${f.type} ${f.constraints.join(",")}${f.required ? " required" : ""}`}</li>))}</ul>
            <pre className="curl">{o.curl}</pre>
          </section>
        )),
      )}
    </main>
  );
}
