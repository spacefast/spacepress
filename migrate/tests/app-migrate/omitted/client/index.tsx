import { useQuery } from "@spacefast/zero/client";
export function App() {
  const count = useQuery<number>("count");
  return <p>{count} notes</p>;
}
