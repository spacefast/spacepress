// `do…while` and label shapes from live 0.8 apps: a slug retry loop and a nested search.
export function uniqueSlug(base: string, taken: string[]): string {
  let slug = base;
  let n = 1;
  do {
    if (!taken.includes(slug)) break;
    n++;
    slug = `${base}-${n}`;
  } while (n < 100);
  return slug;
}

export function firstMatch(rows: string[][], needle: string): number[] {
  let found: number[] = [];
  search: for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === needle) {
        found = [r, c];
        break search;
      }
    }
  }
  return found;
}
