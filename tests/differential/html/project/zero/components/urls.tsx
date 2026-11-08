// A computed URL that fails Zero's URL policy drops the attribute (render-php.php checks this
// case on the PHP side only: React rewrites javascript: URLs instead of dropping them).
export function Links({ urls }: { urls: string[] }) {
  return <p>{urls.map((u) => <a href={u}>{u}</a>)}</p>;
}
