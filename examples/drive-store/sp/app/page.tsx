import type { PageProps } from "./$types";
// The catalog: every published drive, searchable and filtered by media and condition.
import { select, text } from "spacepress";
import { Link } from "spacepress/app";
import { CONDITIONS, MEDIA } from "../schema";
import { catalog } from "../lib/catalog";
import { mediaName, money, size, stockLabel } from "./_lib/format";

export const metadata = { title: "Catalog" };
export const search = { q: text().max(200).optional(), media: select(MEDIA).optional(), condition: select(CONDITIONS).optional() };

type Search = { q: string | null; media: (typeof MEDIA)[number] | null; condition: (typeof CONDITIONS)[number] | null };

export default async function Catalog({ search }: PageProps<Search>) {
  const rows = await catalog(search.q ?? "", search.media ?? null, search.condition ?? null);
  return (
    <>
      <section className="hero">
        <h1>Tested, graded, second-hand drives</h1>
        <p className="muted">Shop refurbished hard drives and SSDs. Pay on delivery.</p>
      </section>

      <form className="filters" method="get">
        <input name="q" type="search" placeholder="Search brand, model, description…" defaultValue={search.q ?? ""} />
        <select name="media">
          <option value="">Any media</option>
          {MEDIA.map((m) => <option value={m} selected={search.media === m}>{mediaName(m)}</option>)}
        </select>
        <select name="condition">
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => <option value={c} selected={search.condition === c}>{c}</option>)}
        </select>
        <button>Filter</button>
      </form>

      <ul className="cards">
        {rows.map((d) => (
          <li className="card">
            <h2><Link href={`/drives/${d.slug ?? ""}`} prefetch>{d.name}</Link></h2>
            <p className="muted">{d.brand} {d.model} · {d.capacityGb !== null ? size(d.capacityGb) : ""} {d.media ? mediaName(d.media) : ""}</p>
            {d.shortDescription ? <p>{d.shortDescription}</p> : null}
            <p className="row">
              <strong className="price">{money(d.price)}</strong>
              <span className={`pill ${d.condition}`}>{d.condition}</span>
              <span className="muted">{stockLabel(d.stockQuantity, d.availability)}</span>
            </p>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="empty">No drives match your search.</p> : null}
    </>
  );
}
