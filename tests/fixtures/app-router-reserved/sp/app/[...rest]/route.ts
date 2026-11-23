export const guard = "anyone";

export async function GET() {
  return { status: 200, headers: { "content-type": "text/plain" }, body: "app" };
}

export async function POST() {
  return { status: 200, headers: { "content-type": "text/plain" }, body: "app" };
}
