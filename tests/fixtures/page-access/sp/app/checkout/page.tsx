import type { Guard } from "spacepress/app";

export const access: Guard = ({ user, op, data }) => {
  if (!user || data != null) return false;
  if (op === "read") return user.role === "admin";
  return op === "create" && (user.role === "subscriber" || user.role === "admin");
};

export default function Checkout() {
  return <h1>Checkout</h1>;
}

export async function POST() {
  return { status: 201, body: "Order received" };
}
