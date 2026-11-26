// Client components straight from the package: no file in sp/components/ re-exports them.
// Toggle comes through a "use client" barrel; Disclosure is a default export at a .tsx target.
import { Toggle } from "@acme/docs-ui";
import Disclosure from "@acme/docs-ui/disclosure";

export default function Home() {
  return <main><Toggle label="Open" /><Disclosure summary="More" /></main>;
}
