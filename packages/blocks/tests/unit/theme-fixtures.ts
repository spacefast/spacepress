/**
 * Fixture themes for the compiler tests: the complete one under
 * `fixtures/theme`, and disposable copies of it with one file changed, so a
 * test that triggers one diagnostic reads as the change that triggers it.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fixture } from "./helpers.ts";

export const themeDir = fixture("theme");

export interface Variant {
  dir: string;
  /** Write (or overwrite) a file relative to the theme root. */
  write(relative: string, content: string): string;
  remove(relative: string): void;
}

/** A copy of the fixture theme in a temp directory, removed when `use` settles. */
export async function withVariant<T>(use: (variant: Variant) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-blocks-theme-"));
  cpSync(themeDir, dir, { recursive: true });
  const variant: Variant = {
    dir,
    write(relative, content) {
      const file = path.join(dir, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      return file;
    },
    remove(relative) {
      rmSync(path.join(dir, relative), { recursive: true, force: true });
    },
  };
  try {
    return await use(variant);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A temp directory for build output, removed when `use` settles. */
export async function withOutDir<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "zero-blocks-out-"));
  try {
    return await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
