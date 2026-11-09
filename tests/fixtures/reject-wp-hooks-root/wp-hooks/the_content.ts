// Beside zero.config.ts, from before zero/wp-hooks/: building without it would drop this filter.
export default function (content: string): string {
  return content + "!";
}
