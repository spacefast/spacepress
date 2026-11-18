export interface FrontendOptions {
  /** The TypedPress project directory. Defaults to the current directory. */
  root?: string;
  /** Public browser entries, relative to root. Defaults to { main: "browser/index.ts" }. */
  entries?: Record<string, string>;
}

export interface EntryMetadata {
  scripts: string[];
  links: { rel: "stylesheet"; href: string }[];
}

/** Compile the entries and write the generated WordPress route metadata. */
export function buildFrontend(options?: FrontendOptions): Promise<Record<string, EntryMetadata>>;
