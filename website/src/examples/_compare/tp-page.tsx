import { tasks } from "typedpress:db";

export default async function Home() {
  const rows = await tasks.list();
  return (
    <ul>
      {rows.map((task) => <li>{task.text}</li>)}
    </ul>
  );
}
