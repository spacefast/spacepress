/** What an authored module can see of the serializer's DOM: nothing, whatever else is compiling. */
export default function SeesDom() {
  const globals = globalThis as { document?: unknown; window?: unknown };
  return (
    <p>
      {typeof globals.document}/{typeof globals.window}
    </p>
  );
}
