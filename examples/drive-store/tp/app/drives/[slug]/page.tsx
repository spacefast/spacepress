// One drive. The kind's `url` is /drives/:slug, so this page receives the drive as `item`, read as
// the visitor. Each translation has its own slug: /drives/wd-red-plus-4tb-tr is the Turkish row.
// A drive nobody translated yet is shown in Turkish words with `?language=tr`: a read of one row
// with `locale` gives that row's translation, or the English row when there is none.
// Buying posts the form to the `buy` action; the confirmation comes back on this page.
import { db, text } from "typedpress";
import { Comments, Content, Link, Live, useFormState, type PageProps } from "typedpress/app";
import { drives } from "typedpress:db";
import { buy } from "../../../server";
import { inLang, pickLang, type Lang } from "../../../lib/catalog";
import { mediaName, money, size, words } from "../../_lib/format";

export const search = { language: text().optional() };

export const metadata = ({ item }: PageProps<"drives/[slug]">) => ({
  title: item.name,
  description: item.summary ?? `${item.brand} ${item.model}`,
});

export default async function Drive({ item, search }: PageProps<"drives/[slug]", { language: string | null }>) {
  const lang = search.language ? pickLang(search.language) : pickLang(item.locale);
  const other: Lang = lang === "tr" ? "en" : "tr";
  const w = words(lang);
  const shop = await db.globals.shop.get();
  const state = useFormState(buy);
  const drive = item.locale === lang ? item : (await drives.get(item.id, { locale: lang })) ?? item;
  // The other language's own page when the drive has one, else this page in that language.
  const otherId = item.translations[other];
  const otherRow = otherId ? await drives.get(otherId) : null;
  const switchTo = otherRow && otherRow.slug ? `/drives/${otherRow.slug}` : inLang(`/drives/${item.slug ?? ""}`, other);
  return (
    <>
      <p className="crumbs"><Link href={inLang("/", lang)} prefetch>{w.back}</Link></p>
      <article className="product">
        <div>
          <h1>{drive.name}</h1>
          <p className="lang"><Link href={switchTo} prefetch>{w.language}</Link></p>
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
