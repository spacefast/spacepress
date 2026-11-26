// A client component straight from the package: no file in sp/components/ re-exports it.
import { Toggle } from "@acme/docs-ui";

export default function Home() {
  return <main><Toggle label="Open" /></main>;
}
