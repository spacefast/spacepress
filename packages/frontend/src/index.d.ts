export interface FrontendOptions {
  /** The SpacePress project directory. Defaults to the current directory. */
  root?: string;
  /** Public browser entries, relative to root. Defaults to { main: "browser/index.ts" }. */
  entries?: Record<string, string>;
  /** JSX uses React by default. Other JSX transforms are scoped to the supplied project-relative globs. */
  frameworks?: {
    preact?: string[];
    solid?: string[];
    vue?: boolean;
  };
}

export interface EntryMetadata {
  scripts: string[];
  links: { rel: "stylesheet" | "modulepreload"; href: string }[];
}

/** Compile the entries and write the generated WordPress route metadata. */
export function buildFrontend(options?: FrontendOptions): Promise<Record<string, EntryMetadata>>;
