import { redirect } from "spacepress/app";

export default function Home() {
  redirect("/docs/introduction/", 302);
}
