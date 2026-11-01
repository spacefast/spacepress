/** A key written after a spread is the one JSX shape the automatic transform hands to createElement. */
export default function SpreadKey() {
  const rows = [{ id: "a", class: "lead" }];
  return (
    <>
      {rows.map((row) => (
        <p {...{ class: row.class }} key={row.id}>
          Row {row.id}
        </p>
      ))}
    </>
  );
}
