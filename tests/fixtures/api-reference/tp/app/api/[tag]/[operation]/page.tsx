import { Html, notFound, type PageProps } from "typedpress/app";
import { apiReference } from "typedpress/content";
import { Fields } from "../../../../components/Fields";

export default function Operation({ params }: PageProps<"api/[tag]/[operation]">) {
  const tag = apiReference().tags.find((t) => t.slug === params.tag);
  if (!tag) notFound();
  const op = tag.operations.find((o) => o.slug === params.operation);
  if (!op) notFound();
  return (
    <main>
      <h1>{op.summary}</h1>
      <p className="endpoint"><code>{op.method} {op.path}</code></p>
      <p className="access">{op.access}</p>
      <Html value={op.description} />
      <h2>Parameters</h2>
      <Fields fields={op.params} />
      <h2>Body</h2>
      <p className="body-type">{op.bodyType}</p>
      <Fields fields={op.body} />
      <h2>Responses</h2>
      {op.responses.map((r) => (
        <section key={r.status} className={`response-${r.status}`}>
          <h3>{r.status}</h3>
          <Html value={r.description} />
          <Fields fields={r.fields} />
        </section>
      ))}
      <pre className="curl">{op.curl}</pre>
      <pre className="fetch">{op.fetch}</pre>
    </main>
  );
}
