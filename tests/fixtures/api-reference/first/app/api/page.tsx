import { Html, Link } from "first/app";
import { apiReference } from "first/content";

export const metadata = { title: "API" };

export default function Api() {
  const api = apiReference();
  return (
    <main>
      <h1>{api.title}</h1>
      <p className="server">{api.server}</p>
      <Html value={api.description} />
      {api.tags.map((t) => (
        <section key={t.slug} id={t.slug}>
          <h2>{t.name}</h2>
          <ul>{t.operations.map((o) => <li key={o.id}><Link href={`/api/${t.slug}/${o.slug}`}>{o.summary}</Link> <code>{o.method} {o.path}</code></li>)}</ul>
        </section>
      ))}
    </main>
  );
}
