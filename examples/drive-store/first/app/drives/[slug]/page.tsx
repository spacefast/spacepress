// One drive. The kind's `url` is /drives/:slug, so this page receives the drive as `item`, read as
// the visitor. `?language=tr` shows the drive's Turkish row: a read of one row with `locale` gives
// that row's translation, or the English row when the drive has none yet.
// Buying posts the form to the `buy` action; the confirmation comes back on this page.
import { db, text } from "first";
import { Comments, Content, Link, Live, useFormState, type PageProps } from "first/app";
import { drives } from "first:db";
import { buy } from "../../../server";
import { inLang, pickLang } from "../../../lib/catalog";
import { mediaName, money, size, words } from "../../_lib/format";

export const search = { language: text().optional() };

export const metadata = ({ item }: PageProps<"drives/[slug]">) => ({
  title: item.name,
  description: item.summary ?? `${item.brand} ${item.model}`,
});

export default async function Drive({ item, search }: PageProps<"drives/[slug]", { language: string | null }>) {
  const lang = pickLang(search.language);
  const w = words(lang);
  const shop = await db.globals.shop.get();
  const state = useFormState(buy);
  const drive = lang === "en" ? item : (await drives.get(item.id, { locale: lang })) ?? item;
  const here = `/drives/${item.slug ?? ""}`;
  return (
    <>
      <p className="crumbs">{lang === "en" ? <Link href="/">{w.back}</Link> : <a href={inLang("/", lang)}>{w.back}</a>}</p>
      <article className="product">
        <div>
          <h1>{drive.name}</h1>
          <p className="lang"><a href={lang === "en" ? inLang(here, "tr") : here}>{w.language}</a></p>
          {drive.summary ? <p className="lede">{drive.summary}</p> : null}
          <dl className="facts">
            <dt>{w.capacity}</dt><dd>{size(item.capacityGb)} {mediaName(item.media)}</dd>
            <dt>{w.iface}</dt><dd>{item.connector.toUpperCase()}</dd>
            <dt>{w.condition}</dt><dd><span className={`pill ${item.condition}`}>{item.condition}</span></dd>
            <dt>{w.hours}</dt><dd>{item.powerOnHours === null ? "—" : String(item.powerOnHours)}</dd>
          </dl>
          <div className="prose"><Content value={drive.description} /></div>
        </div>

        <aside className="buybox">
          <p className="price">{money(item.price, shop.currency)}</p>
          {/* Stock changes as people buy; the region updates in place, without a reload. */}
          <Live id="stock">
            <p className="muted">{item.stock > 0 ? `${item.stock} ${w.inStock}` : w.soldOut}</p>
          </Live>
          {state.result ? (
            <p className="ok">{w.thanks} <strong>{state.result.code}</strong> ({money(state.result.total, shop.currency)}).</p>
          ) : null}
          {state.error ? <p className="error">{state.error.message}</p> : null}
          <form action={buy} className="form">
            <input type="hidden" name="drive" value={String(item.id)} />
            <label>{w.name}<input name="buyerName" required maxLength={80} defaultValue={state.values.buyerName ?? ""} /></label>
            <label>{w.email}<input name="buyerEmail" type="email" required defaultValue={state.values.buyerEmail ?? ""} /></label>
            <label>{w.quantity}<input name="quantity" type="number" min="1" max="5" defaultValue={state.values.quantity ?? "1"} /></label>
            <button className="primary" disabled={item.stock === 0}>{w.buy}</button>
          </form>
          <p className="muted small">{w.demo}</p>
        </aside>
      </article>

      {/* Reviews belong to the drive, whichever language it is read in. */}
      <section className="reviews">
        <h2>{w.reviews}</h2>
        <Comments for={item} />
      </section>
    </>
  );
}
