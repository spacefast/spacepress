// Beside typedpress.config.ts, from before tp/wp-hooks/: building without it would drop this filter.
export default function (content: string): string {
  return content + "!";
}
