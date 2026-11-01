/** The classic fallback carries no position of its own; a mistake under it is reported at the nearest located element. */
export default function SpreadKeyStyle() {
  return (
    <section>
      <div {...{}} key="d">
        <p {...{ style: { color: "red" } }} key="p">
          Hello
        </p>
      </div>
    </section>
  );
}
