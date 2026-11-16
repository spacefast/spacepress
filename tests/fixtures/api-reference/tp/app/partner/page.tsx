import { apiReference } from "typedpress/content";

// A document from public/: its fields, nested, as one line each.
export default function Partner() {
  const api = apiReference("partner-api.json");
  return (
    <main>
      <h1>{api.title}</h1>
      <p className="server">{api.server}</p>
      {api.tags.map((t) =>
        t.operations.map((o) => (
          <section key={o.id} id={o.slug}>
            <h2>{t.name}: {o.method} {o.path}</h2>
            <ul className="params">{o.params.map((f) => <li key={f.name}>{`${f.name} ${f.in} ${f.type}${f.required ? " required" : ""}`}</li>)}</ul>
            <ul className="fields">{o.responses.map((r) => r.fields.map((f) => <li key={`${r.status}-${f.depth}-${f.name}`}>{`${r.status} d${f.depth} ${f.name}: ${f.type}${f.required ? " required" : ""}${f.constraints.length > 0 ? ` (${f.constraints.join(", ")})` : ""}`}</li>))}</ul>
          </section>
        )),
      )}
    </main>
  );
}
