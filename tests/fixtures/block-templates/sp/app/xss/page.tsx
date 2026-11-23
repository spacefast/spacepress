// A title with markup in it: WordPress's <title> must print it as text.
export const metadata = { title: "Notes </title><script>window.pwned=1</script>" };

export default function Xss() {
  return <h1>Escaped</h1>;
}
