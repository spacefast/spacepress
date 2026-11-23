export const guard = { page: "admin", handlers: "subscriber" };

export async function POST() {
  return { body: "Accepted" };
}

export default function Tools() {
  return <h1>Admin tools</h1>;
}
