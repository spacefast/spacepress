function explode(): string {
  throw new Error("boom at build time");
}

export default function Throws() {
  return <p>{explode()}</p>;
}
