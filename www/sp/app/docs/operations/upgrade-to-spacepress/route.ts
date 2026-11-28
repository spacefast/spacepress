export const guard = "anyone";

export function GET() {
  return {
    status: 301,
    headers: { location: "https://github.com/spacefast/spacepress/blob/main/scripts/rename/README.md" },
    body: "",
  };
}
