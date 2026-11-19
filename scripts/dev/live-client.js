(() => {
  const params = new URL(document.currentScript.src).searchParams;
  const revision = Number(params.get('revision'));
  const events = new EventSource(params.get('events'));
  let overlay;

  events.onmessage = ({ data }) => {
    const update = JSON.parse(data);
    if (update.revision !== revision) {
      events.close();
      location.reload();
      return;
    }
    overlay?.remove();
    if (!update.diagnostics.length) return;

    overlay = document.createElement('typedpress-dev-error');
    const root = overlay.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { position: fixed; inset: 0; z-index: 2147483647; display: grid;
        align-items: start; overflow: auto; background: #120e18df; color: #fff; }
      section { box-sizing: border-box; width: min(48rem, calc(100% - 2rem));
        margin: 8vh auto; padding: 1.5rem; border: 1px solid #69465a;
        border-top: .25rem solid #ff8c9b; border-radius: .5rem; background: #221b27;
        font: 1rem/1.5 system-ui, sans-serif; overflow-wrap: anywhere; }
      h1 { margin: 0 0 1rem; font-size: 1.25rem; }
      a { color: #ffadb6; }
      code, pre { font-family: ui-monospace, monospace; }
      pre { white-space: pre-wrap; }
    `;
    const panel = document.createElement('section');
    panel.setAttribute('role', 'alert');
    const heading = document.createElement('h1');
    heading.textContent = 'TypedPress build failed';
    panel.append(heading);
    for (const diagnostic of update.diagnostics) {
      const { code, location: source, message, help } = diagnostic;
      if (code) {
        const link = document.createElement('a');
        link.href = `https://github.com/spacefast/zero/blob/main/docs-site/docs/reference/diagnostics.mdx#codes:~:text=${encodeURIComponent(code)}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `error[${code}]`;
        panel.append(link);
      }
      if (source) {
        const file = document.createElement('p');
        const label = document.createElement('code');
        label.textContent = `${source.file}:${source.line}:${source.column}`;
        file.append(label);
        panel.append(file);
      }
      const detail = document.createElement('pre');
      detail.textContent = help ? `${message}\n\n${help}` : message;
      panel.append(detail);
    }
    root.append(style, panel);
    document.body.append(overlay);
  };
})();
