// Bitwise shapes from live 0.8 apps: string hashes, flag masks and integer truncation.
export function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + i) | 0;
  return h >>> 0;
}

export function flags(read: boolean, write: boolean): number {
  let mode = 0;
  if (read) mode |= 1 << 0;
  if (write) mode |= 1 << 1;
  return mode & ~4;
}

export function truncate(value: number): number {
  return ~~value ^ (value >> 31 & 0);
}
