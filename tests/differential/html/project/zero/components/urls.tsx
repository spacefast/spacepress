// A computed URL that fails Zero's URL policy drops the attribute (render-php.php checks this
// case on the PHP side only: React rewrites javascript: URLs instead of dropping them).
export function Links({ urls }: { urls: string[] }) {
  return <p>{urls.map((u) => <a href={u}>{u}</a>)}</p>;
}

// Spelling variants of URL and event attributes, from spread props and as named attributes on a
// custom element (named `on*` attributes are refused at build time). Every unsafe value must drop
// its attribute.
export function Variants({ u, extra }: { u: string; extra: Record<string, string> }) {
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
