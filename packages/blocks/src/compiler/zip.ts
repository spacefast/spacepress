/**
 * A deterministic ZIP writer: the same entries in the same order give the
 * same bytes, whatever the clock or platform says. Entries are stored with a
 * fixed timestamp, no extra fields, UTF-8 names, and DEFLATE for anything
 * that shrinks. WordPress's installer (ZipArchive, or PclZip without it)
 * reads both methods.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  name: string;
  data: Uint8Array;
}

/** 1980-01-01 00:00:00, the earliest DOS date and the one reproducible builds use. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = new TextEncoder().encode(entry.name);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length < entry.data.length;
    const payload = stored ? new Uint8Array(deflated) : entry.data;
    const method = stored ? 8 : 0;
    const checksum = crc32(entry.data);
    // General purpose bit 11: the name is UTF-8.
    const flags = 1 << 11;
    const local = concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(checksum), u32(payload.length), u32(entry.data.length), u16(name.length), u16(0), name, payload]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(DOS_TIME), u16(DOS_DATE), u32(checksum), u32(payload.length), u32(entry.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(sorted.length), u16(sorted.length), u32(centralSize), u32(offset), u16(0)]);
  return concat([...locals, ...centrals, end]);
}
