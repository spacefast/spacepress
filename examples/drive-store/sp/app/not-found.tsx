import { Link } from "spacepress/server/app";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (<><h1>Not found</h1><p><Link href="/">Back to the catalog</Link></p></>);
}
