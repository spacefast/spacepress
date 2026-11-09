// A computed URL that fails Zero's URL policy drops the attribute (render-php.php checks this
// case on the PHP side only: React rewrites javascript: URLs instead of dropping them).
export function Links({ urls }: { urls: string[] }) {
  return <p>{urls.map((u) => <a href={u}>{u}</a>)}</p>;
}

// Spelling variants of URL attributes, from a closed spread and as named attributes on HTML,
// SVG and custom elements (the build refuses open spreads and named `on*`). Every unsafe
// computed value must drop its attribute.
export function Variants({ u, extra }: { u: string; extra: { Href: string; title: string } }) {
  return (
    <div>
      <a {...extra}>spread</a>
      <my-el {...extra} />
      <a HREF={u}>upper</a>
      <button formaction={u}>lower</button>
      <object data={u} />
      <my-el href={u} data={u} />
      <svg>
        <use {...{ "xlink:href": u }} />
      </svg>
    </div>
  );
}
