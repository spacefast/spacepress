import type { Guard } from "typedpress/app";

export const guard: Guard = ({ user }) => user === null;

export default function Guests() {
  return <h1>Guest preview</h1>;
}
