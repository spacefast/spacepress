import "./source.css";

export const metadata = {
  title: "Source",
  description: "Browse the TypeScript, styles and sample content behind Drive Store.",
  scripts: ["/drive-source/source.js"],
};

export default function SourcePage() {
  return (
    <>
      <h1>Drive Store source</h1>
      <p className="lede">Browse the code and sample content behind this TypedPress demo.</p>
      <p><a href="https://github.com/spacefast/zero/tree/main/examples/drive-store">View on GitHub</a></p>
      <p id="drive-source-status" role="status" hidden></p>
      <section id="drive-source-viewer" className="source-viewer" aria-label="Source browser" hidden>
        <nav id="drive-source-files" aria-label="Source files"></nav>
        <div id="drive-source-code" role="region" aria-label="File contents" tabIndex={0}></div>
      </section>
    </>
  );
}
