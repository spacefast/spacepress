export const access = "anyone";

export function GET() {
  return {
    status: 301,
    headers: { location: "/handbook/" },
    body: "",
  };
}
