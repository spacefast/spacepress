import { apiReference } from "typedpress/content";

export const metadata = { title: "Staff" };

export default function Staff() {
  const api = apiReference();
  return (
    <>
      <h1>Kitchen staff</h1>
      <a href="/wp-admin/new/screens/schedule">Manage the workshop schedule</a>
      <details><summary>API operations</summary><ul>{api.tags.map((tag) => <li>{tag.name}</li>)}</ul></details>
    </>
  );
}
