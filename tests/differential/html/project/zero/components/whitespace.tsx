// JSX whitespace: lines trim and join with one space; tabs, non-breaking spaces and CRLF keep React's rules.
export function Whitespace() {
  return (
    <p>
      a	b  c 
	  d 
      <b> e </b>   {"f"}   g

      &nbsp;h&#x41;&#65;&amp;&bogus;&
    </p>
  );
}
