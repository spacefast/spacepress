import { Body, Html, Text } from "react-email";

export default function Welcome({ name, kind }: { name: string; kind: "welcome" | "reminder" }) {
  return <Html><Body><Text>{kind === "welcome" ? "Welcome" : "Reminder"}, {name}!</Text></Body></Html>;
}
