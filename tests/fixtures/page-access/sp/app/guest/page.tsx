import type { Guard } from "spacepress/app";

export const access: Guard = ({ user }) => user === null;

export default function Guests() {
  return <h1>Guest preview</h1>;
}
