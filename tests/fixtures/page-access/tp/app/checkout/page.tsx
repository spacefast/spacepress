import type { Guard } from "typedpress/app";

export const guard: Guard = ({ user }) => user?.role === "admin";

export default function Checkout() {
  return <h1>Checkout</h1>;
}

export async function POST() {
  return { status: 201, body: "Order received" };
}
