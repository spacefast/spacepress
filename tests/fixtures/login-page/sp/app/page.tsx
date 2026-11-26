import { LoginForm } from "spacepress/app";

export const metadata = { title: "Home" };

export default function Home() {
  return <><h1>Home</h1><LoginForm links={false} /></>;
}
