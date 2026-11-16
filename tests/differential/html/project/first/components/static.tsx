// Literal-only elements the compiler renders at build time (src/compile/html.rs), next to dynamic
// children: the output must be what react-dom/server renders and what \First\Html renders.
export function Static({ name, items }: { name: string; items: string[] }) {
  return (
    <main className="page" id="top" data-kind="static" aria-label="Static &amp; folded">
      <header>
        <h1 title="A &quot;quoted&quot; title" lang="en" dir="ltr">Hello, &lt;world&gt; &amp; friends</h1>
        <p hidden={false} draggable spellCheck={false} contentEditable="true" tabIndex="0">Text with &nbsp; and &copy; and 'quotes'</p>
        <br />
        <hr className="rule" />
        <img src="/logo.png" alt="" loading="lazy" width="10" height="10" />
        <img src="" alt="empty src" />
        <a href="" className="empty">empty href on a</a>
        <link-like>custom</link-like>
      </header>
      <nav>
        <a href="https://example.com/?a=1&b=2" target="_blank" rel="noopener noreferrer">out</a>
        <a href="mailto:a@b.c" download>mail</a>
        <a href="#top" hidden aria-hidden="true" data-on={true} data-off={false}>top</a>
        <area href="/map" alt="area" />
      </nav>
      <section>
        <p>Hello, {name}!</p>
        <ul className="list">
          <li className="first">static item</li>
          {items.map((item) => <li className="item" key={item}>{item}</li>)}
          <li className="last">static item</li>
        </ul>
        <svg viewBox="0 0 10 10" strokeWidth="2" fillRule="evenodd" xlinkHref="#a" className="icon">
          <path d="M0 0h10v10z" strokeLinecap="round" />
          <foreignObject width="10" height="10" />
          <use xlinkHref="#shape" />
        </svg>
        <video controls autoPlay={false} muted playsInline loop={false} poster="/poster.png" />
        <iframe src="https://example.com/embed" allowFullScreen title="embed" />
        <details open><summary>More</summary><p>Inside</p></details>
        <table><tbody><tr><td className="c" colSpan="2" headers="h">cell</td></tr></tbody></table>
        <label htmlFor="x" className="l">label</label>
        <meter value="0.5" min="0" max="1" />
        <div suppressHydrationWarning className="s" />
        <></>
        <>
          <span>fragment</span> <b>bold</b>
        </>
      </section>
    </main>
  );
}

// A void element's children don't render, but they still run (no React case: React refuses them).
export function VoidChildren() {
  let n = 0;
  const node = <br>{++n}</br>;
  return <p>{n}{node}</p>;
}

function boom(): string {
  throw new Error("a void element's child ran");
}

export function VoidThrows() {
  return <p><hr>{boom()}</hr></p>;
}
