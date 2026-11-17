// The catalog: every published drive, searchable and filtered by media and condition.
import { db, text } from "typedpress";
import type { PageProps } from "typedpress/app";
import { CONDITIONS, MEDIA } from "../schema";
import { catalog } from "../lib/catalog";
import { mediaName, money, size } from "./_lib/format";

export const metadata = { title: "Catalog" };
export const search = { q: text().max(200).optional(), media: text().optional(), condition: text().optional() };

type Search = { q: string | null; media: string | null; condition: string | null };

export default async function Catalog({ search }: PageProps<"/", Search>) {
  const shop = await db.globals.shop.get();
  const rows = await catalog(search.q ?? "", search.media ?? "", search.condition ?? "");
  return (
    <>
      <section className="hero">
        <h1>Tested, graded, second-hand drives</h1>
        <p className="muted">This is a demo shop: no payment is taken and nothing ships.</p>
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
            <h2><a href={d.href}>{d.name}</a></h2>
            <p className="muted">{d.brand} {d.model} · {size(d.capacityGb)} {mediaName(d.media)}</p>
            {d.summary ? <p>{d.summary}</p> : null}
            <p className="row">
              <strong className="price">{money(d.price, shop.currency)}</strong>
              <span className={`pill ${d.condition}`}>{d.condition}</span>
              {d.stock > 0 ? <span className="muted">{d.stock} in stock</span> : <span className="sold">Sold out</span>}
            </p>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="empty">No drives match your search.</p> : null}
    </>
  );
}
