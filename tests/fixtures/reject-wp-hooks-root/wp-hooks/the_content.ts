// Beside first.config.ts, from before first/wp-hooks/: building without it would drop this filter.
export default function (content: string): string {
  return content + "!";
}
