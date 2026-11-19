import { Body, Html, Text } from "react-email";

export default function Welcome({ name }: { name: string }) {
  return <Html><Body><Text>Welcome, {name}!</Text></Body></Html>;
}
