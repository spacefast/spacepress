import { text } from "typedpress";
import { shares } from "typedpress:db";
import type { PageProps } from "typedpress/app";

export const metadata = {
  title: "Playground",
  description: "Edit real SpacePress TypeScript apps, compile them to PHP & SQL in your browser via WebAssembly, share edits, and boot them in WordPress Playground.",
};

export const search = {
  s: text().max(12).optional(),
  example: text().max(40).optional(),
  file: text().max(200).optional(),
};

export default async function PlayPage({ search }: PageProps<"play", { s?: string | null; example?: string | null; file?: string | null }>) {
  const saved = search.s ? await shares.system.get({ key: search.s }) : null;
  const example = saved?.example ?? search.example ?? "tasks";
  const sharedJson = saved ? JSON.stringify(saved.files) : undefined;

  return (
    <>
      <section className="sp-page-banner" style={{ padding: "36px 0 24px" }}>
        <div className="sp-container-wide">
          <h1>SpacePress Playground</h1>
          <p>
            Edit any file on the left — the Rust/OXC compiler compiles it in WebAssembly right in your browser. Inspect generated PHP, SQL migrations, TypeScript types, and OpenAPI, share your edits via a permanent link, or click <strong>Run in WordPress</strong> to boot the compiled plugin in-tab.
          </p>
          {search.s && !saved && (
            <div className="sp-callout" style={{ marginTop: "16px", marginBottom: 0 }}>
              <strong>Share link not found:</strong> No saved edit matched key <code>{search.s}</code>. Loaded the default example instead.
            </div>
          )}
        </div>
      </section>

      <div className="sp-container-wide" style={{ paddingTop: "16px", paddingBottom: "64px" }}>
        <tp-play
          data-picker="1"
          data-share="1"
          data-open="1"
          example={example}
          file={search.file ?? undefined}
          shared={sharedJson}
        />
      </div>
    </>
  );
}
