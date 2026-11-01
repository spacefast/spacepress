/** The classic fallback carries no position of its own; its mistake is reported at the enclosing element. */
export default function SpreadKeyStyle() {
  return (
    <section>
      <p {...{ style: { color: "red" } }} key="x">
        Hello
      </p>
    </section>
  );
}
