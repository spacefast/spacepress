import { vote } from "../../server";

// The blank block template: a form whose answer page renders in another template (the test points
// its `_sp_return` at `/`, in the theme's template) loads that page in full.
export const template = "blank";

export default function Bare() {
  return (
    <main>
      <h1 className="bare-page">Bare</h1>
      <form action={vote} className="bare-vote"><button name="choice" value="bare">Vote</button></form>
    </main>
  );
}
