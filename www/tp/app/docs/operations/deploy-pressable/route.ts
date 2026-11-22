export const guard = "anyone";

export function GET() {
  return {
    status: 301,
    headers: { location: "/docs/operations/deploy-wp-cloud/" },
    body: "",
  };
}
