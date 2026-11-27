import type { AccessCtx } from "spacepress";

export const access = ({ user, op, data }: AccessCtx) =>
  user?.role === "admin" && op === "create" && data == null;

export async function GET() {
  return { status: 200, body: "Queue" };
}
