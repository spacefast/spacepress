import { categories, tags } from "typedpress:db";
import { Comments, Content, Link, Live, notFound, type PageProps } from "typedpress/app";
import { mediaName, money, size, stockLabel } from "../../_lib/format";

export const metadata = ({ item }: PageProps<"drives/[slug]">) => ({
  title: item?.name ?? "Drive",
  description: item?.shortDescription ?? "Tested and graded drives",
});

export default async function Drive({ item }: PageProps<"drives/[slug]">) {
  if (!item) notFound();
  // Woo's own product categories and tags, read by the ids the product carries.
  const labels = [
    ...(item.categories.length ? await categories.list({ where: { id: { in: item.categories } } }) : []),
    ...(item.tags.length ? await tags.list({ where: { id: { in: item.tags } } }) : []),
  ];
  return (
    <>
      <p className="crumbs"><Link href="/" prefetch>← Back to the catalog</Link></p>
      <article className="product">
        <div>
          <h1>{item.name}</h1>
          {item.shortDescription && <p className="lede">{item.shortDescription}</p>}
          <dl className="facts">
            {item.capacityGb !== null && <><dt>Capacity</dt><dd>{size(item.capacityGb)} {item.media ? mediaName(item.media) : ""}</dd></>}
            {item.connector && <><dt>Interface</dt><dd>{item.connector.toUpperCase()}</dd></>}
            {item.condition && <><dt>Condition</dt><dd><span className={`pill ${item.condition}`}>{item.condition}</span></dd></>}
            {item.powerOnHours !== null && <><dt>SMART power-on hours</dt><dd>{item.powerOnHours}</dd></>}
            {item.testedOn && <><dt>Tested on</dt><dd>{item.testedOn}</dd></>}
            {labels.length > 0 && <><dt>Filed under</dt><dd>{labels.map((label) => label.name).join(", ")}</dd></>}
          </dl>
          <div className="prose"><Content value={item.description} /></div>
        </div>

        <aside className="buybox">
          <p className="price">{money(item.price)}</p>
          <Live id="stock">
            <p className="muted">{stockLabel(item.stockQuantity, item.availability)}</p>
            {item.type === "simple" && item.purchasable && item.availability === "instock" && (
              <drive-add-to-cart data-product={item.id}>
                <button type="button" className="primary">Add to cart</button>
                <p role="status"></p>
              </drive-add-to-cart>
            )}
          </Live>
          <a href="/cart">View cart</a>
        </aside>
      </article>

      <section className="reviews">
        <h2>Reviews</h2>
        <Comments for={item} />
      </section>
    </>
  );
}
