export function label(title: string, done: boolean): string {
  return done ? `${title} (done)` : title;
}
