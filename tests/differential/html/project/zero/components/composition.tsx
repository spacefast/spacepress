// Components, fragments, children, and async server components.
function Frame({ title, children }: { title: string; children: JSX.Element }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Twice({ children }: { children: JSX.Element }) {
  return <>{children}{children}</>;
}

// React renders children only where a component places them; this one never does.
function Ignore({ children }: { children: JSX.Element }) {
  return <i>ignored</i>;
}

function Fails(): JSX.Element {
  throw new Error("rendered a child that was never placed");
}

// With no children, `children` is undefined, as in React.
function Maybe({ children }: { children?: JSX.Element }) {
  return children ? <div className="has">{children}</div> : <div className="empty" />;
}

function Label({ text }: { text: string }) {
  return text.length > 3 ? text : null;
}

async function load(id: number): Promise<string> {
  return `loaded ${id}`;
}

async function Loaded({ id }: { id: number }) {
  const text = await load(id);
  return <p data-id={id}>{text}</p>;
}

export async function Composition({ ids, title }: { ids: number[]; title: string }) {
  const first = await load(ids[0] ?? 0);
  return (
    <>
      <Frame title={title}>
        <Twice>
          <b>twice</b>
        </Twice>
        <Ignore>
          <Fails />
        </Ignore>
        <Maybe />
        <Maybe>
          <u>kid</u>
        </Maybe>
        <Label text="hi" />
        <Label text="hello" />
        {ids.map((id) => <Loaded key={id} id={id} />)}
      </Frame>
      <footer>{first}</footer>
    </>
  );
}
