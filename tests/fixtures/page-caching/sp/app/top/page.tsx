import { firstDrive } from "./ranking";

export default async function Top() {
  const top = await firstDrive();
  return <p className="top">{top ? top.name : "none"}</p>;
}
