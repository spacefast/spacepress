import { Search } from "first/app";

// The bare form: no query, no read, cacheable.
export default function Home() {
  return <main><h1>Home</h1><Search action="/find" placeholder="Search the site" /></main>;
}
