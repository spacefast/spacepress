// The catalog: every published drive in the visitor's language, searchable and filtered by media
// and condition. `?language=tr` shows the Turkish names and summaries; a drive nobody has
// translated yet shows its English row.
import { db, text } from "first";
import { Link, type PageProps } from "first/app";
import { CONDITIONS, MEDIA } from "../schema";
import { catalog, pickLang } from "../lib/catalog";
import { mediaName, money, size, words } from "./_lib/format";

export const metadata = { title: "Catalog" };
export const search = { q: text().max(200).optional(), media: text().optional(), condition: text().optional(), language: text().optional() };

type Search = { q: string | null; media: string | null; condition: string | null; language: string | null };

export default async function Catalog({ search }: PageProps<"/", Search>) {
  const lang = pickLang(search.language);
  const w = words(lang);
  const shop = await db.globals.shop.get();
  const rows = await catalog(lang, search.q ?? "", search.media ?? "", search.condition ?? "");
  return (
    <>
      <section className="hero">
        <h1>{lang === "tr" ? "Test edilmiş ikinci el diskler" : "Tested, graded, second-hand drives"}</h1>
        <p className="muted">{w.demo}</p>
        <p className="lang">
          {lang === "tr" ? <Link href="/">{w.language}</Link> : <a href="/?language=tr">{w.language}</a>}
        </p>
      </section>

      <form className="filters" method="get">
        {lang === "tr" ? <input type="hidden" name="language" value="tr" /> : null}
        <input name="q" type="search" placeholder={w.search} defaultValue={search.q ?? ""} />
        <select name="media">
          <option value="">{w.anyMedia}</option>
          {MEDIA.map((m) => <option value={m} selected={search.media === m}>{mediaName(m)}</option>)}
        </select>
        <select name="condition">
          <option value="">{w.anyCondition}</option>
          {CONDITIONS.map((c) => <option value={c} selected={search.condition === c}>{c}</option>)}
        </select>
        <button>{w.filter}</button>
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
              {d.stock > 0 ? <span className="muted">{d.stock} {w.inStock}</span> : <span className="sold">{w.soldOut}</span>}
            </p>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="empty">{w.none}</p> : null}
    </>
  );
}
