import { Link, type PageProps } from "spacepress/app";

export const metadata = { title: "Plants" };

export default async function Home({ db }: PageProps) {
  const plants = await db.plants.list({ columns: { title: true, slug: true, family: true, summary: true }, orderBy: { title: "asc" } });
  return (
    <>
      <h1>Plants</h1>
      <ul className="plants">
        {plants.map((p) => (
          <li key={p.slug}>
            <Link href={`/plants/${p.slug}`}>{p.title}</Link> <span className="family">{p.family}</span>
            {p.summary && <p>{p.summary}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
