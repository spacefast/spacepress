// Beside spacepress.config.ts, from before sp/wp-hooks/: building without it would drop this filter.
export default function (content: string): string {
  return content + "!";
}
