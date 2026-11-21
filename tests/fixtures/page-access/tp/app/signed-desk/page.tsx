import { env } from "typedpress";
import type { RouteRequest } from "typedpress/app";

export const guard = "admin";
export const signature = { secret: env("APPROUTER_HOOK_SECRET"), header: "x-hook-signature", scheme: "hmac-sha256" };

export default function SignedDesk() {
  return <h1>Signed desk</h1>;
}

export async function POST(req: RouteRequest) {
  return { status: 202, body: req.body };
}
