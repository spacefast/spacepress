// Attribute names, booleans, numbers, styles and form elements, spelled as react-dom/server spells them.
export function Attributes({ id, on, n, text, color, size }: { id: string; on: boolean; n: number; text: string; color: string; size: number }) {
  return (
    <form action="/search" method="get">
      <label htmlFor={id} className="field" tabIndex={n} aria-hidden={on} data-on={on} data-n={0} title={text}>
        Label &amp; more &nbsp;&copy; &#39;quote&#39;
      </label>
      <input id={id} name="q" type="text" value={text} readOnly={on} disabled={!on} required={false} autoFocus={on} />
      <input type="checkbox" checked={on} />
      <input type="number" defaultValue={n} />
      <textarea rows={n} cols={0} defaultValue={"\n" + text} />
      <select name="pick" multiple={false}>
        <option value="a">A</option>
        <option value="b" selected={on}>B</option>
      </select>
      <pre>{"\nindented"}</pre>
      <div style={{ color, fontSize: size, lineHeight: 1.5, opacity: 0, marginTop: size === 0 ? undefined : "1em", "--gap": 2 }} hidden={!on} />
      <a href="https://example.com/?a=1&b=2" target="_blank" rel="noopener">out</a>
      <a href={`/notes/${id}`} download>file</a>
      <a href="#top">top</a>
      <svg viewBox="0 0 10 10" strokeWidth={2} className="icon">
        <path fillRule="evenodd" d="M0 0h10v10z" />
      </svg>
      <my-widget class-name="x" flag={on} count={n} />
      <img src="/a.png" alt="" loading="lazy" />
      <img src="/b.png" alt={text} />
      <br />
      <td colSpan={2} rowSpan={0}>cell</td>
    </form>
  );
}

// Spread attributes merge in source order, as object spread does.
export function Spread({ extra, title }: { extra: { title: string; id: string }; title: string }) {
  return (
    <p>
      <span {...extra} />
      <span {...extra} title={title} />
      <span title={title} {...extra} />
    </p>
  );
}
