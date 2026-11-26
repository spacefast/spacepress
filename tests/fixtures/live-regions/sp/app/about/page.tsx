import { Live } from "spacepress/app";

// Reads nothing: no counter can answer for it, so every poll renders and compares.
export default function About() {
  return <Live id="static"><p>About us</p></Live>;
}
