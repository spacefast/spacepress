// Cuts the lines of a text between two anchors. The tour shows pieces of the committed examples
// and of what the compiler makes of them; an anchor that stops matching fails the build instead
// of showing the wrong lines.

export interface Anchors {
  /** The first line to show: the line containing this text. */
  from: string;
  /** The last line to show: the first line at or after `from` containing this text... */
  to?: string;
  /** ...or the first line at or after `from` that *is* exactly this text (a closing brace at column 0). */
  toLine?: string;
}

export class ExcerptError extends Error {}

/** The lines from the one containing `from` through the next containing `to`, dedented. */
export function excerpt(text: string, { from, to, toLine }: Anchors): string {
  if ((to === undefined) === (toLine === undefined)) throw new ExcerptError("give exactly one of to and toLine");
  const lines = text.split("\n");
  const starts = lines.flatMap((line, i) => (line.includes(from) ? [i] : []));
  if (starts.length !== 1) throw new ExcerptError(`"${from}" matches ${starts.length} lines, needs exactly 1`);
  const start = starts[0]!;
  const ends = (line: string) => (to !== undefined ? line.includes(to) : line === toLine);
  const end = lines.findIndex((line, i) => i >= start && ends(line));
  if (end < 0) throw new ExcerptError(`"${to ?? toLine}" does not follow "${from}"`);
  return dedent(lines.slice(start, end + 1)).join("\n");
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => line.match(/^[ \t]*/)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(common, line.match(/^[ \t]*/)![0].length)));
}
