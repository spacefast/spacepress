import { notFound } from "typedpress/app";

// A dynamic route at the root: it takes no path a file in public/ is at.
export default function Slug() {
  notFound();
}
