import { Section, Ref } from "../Guide";

export function Limits() {
  return (
    <>
      <Section id="limits" />
      <ul>
        <li><b>npm packages on the server.</b> Server code is compiled to PHP, so it cannot import arbitrary npm packages. A few small ones are tested one by one.</li>
        <li><b>React components from npm inside TypedPress pages.</b> Use them in a separate React frontend with the client (section <Ref to="frontend" />).</li>
        <li><b>Any theme or plugin you like.</b> One built-in theme, and plugins only under the rules in section <Ref to="rules" />.</li>
        <li><b>Agents inside the app.</b> Designed as a separate add-on, not built (section <Ref to="app-agents" />).</li>
        <li><b>A push transport for live reads.</b> Live reads poll unless the host adds one.</li>
        <li><b>Several apps on one site.</b> One app per site today; on a WordPress network, one per site of the network.</li>
        <li><b>Compiling on the site.</b> A deploy sends a build compiled on your machine.</li>
        <li><b>Undoing a migration.</b> Going back to an earlier version switches the code, not the database.</li>
        <li><b>A stable API.</b> The framework is experimental. Names and shapes on this page will change before a first release.</li>
      </ul>
    </>
  );
}
