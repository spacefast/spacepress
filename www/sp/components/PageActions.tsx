export function PageActions({ mdPath, title }: { mdPath: string; title: string }) {
  const fullMdUrl = `https://spacepress.dev${mdPath}`;
  const prompt = `Read ${fullMdUrl} (${title}) and help me with questions about it.`;
  const chatgptUrl = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

  return (
    <div className="sp-page-actions" data-page-actions="">
      <blockquote className="sp-sr-only">
        For AI coding agents: start with{" "}
        <a href="/start.md">/start.md</a> (build playbook) and{" "}
        <a href="/rules.md">/rules.md</a> (compiler rules), see{" "}
        <a href="/llms.txt">/llms.txt</a> for the complete documentation index, or read this page as Markdown at{" "}
        <a href={mdPath}>{mdPath}</a>.
      </blockquote>
      <button type="button" className="sp-pa-main" data-copy-md={mdPath}>
        Copy Markdown
      </button>
      <button
        type="button"
        className="sp-pa-caret"
        data-page-menu-toggle=""
        aria-haspopup="menu"
        aria-expanded="false"
        aria-label="More page actions"
      >
        ▾
      </button>
      <div className="sp-pa-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-copy-md={mdPath}>
          <span>Copy as Markdown</span>
          <small>Clean GFM for LLMs</small>
        </button>
        <a role="menuitem" href={mdPath} target="_blank" rel="noopener noreferrer">
          <span>View Markdown</span>
          <small>.md source ↗</small>
        </a>
        <a role="menuitem" href={chatgptUrl} target="_blank" rel="noopener noreferrer">
          <span>Open in ChatGPT</span>
          <small>Ask about this page ↗</small>
        </a>
        <a role="menuitem" href={claudeUrl} target="_blank" rel="noopener noreferrer">
          <span>Open in Claude</span>
          <small>Ask about this page ↗</small>
        </a>
        <a role="menuitem" href="/start.md" target="_blank" rel="noopener noreferrer">
          <span>start.md</span>
          <small>Agent build playbook ↗</small>
        </a>
        <a role="menuitem" href="/rules.md" target="_blank" rel="noopener noreferrer">
          <span>rules.md</span>
          <small>Compiler rules ↗</small>
        </a>
        <a role="menuitem" href="/llms.txt" target="_blank" rel="noopener noreferrer">
          <span>llms.txt</span>
          <small>Full site index ↗</small>
        </a>
      </div>
    </div>
  );
}
