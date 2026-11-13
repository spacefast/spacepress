// A public page that asks search engines not to index it.
export const metadata = { title: "Hidden", robots: { index: false } };

export default function Hidden() {
  return <h1>Hidden</h1>;
}
