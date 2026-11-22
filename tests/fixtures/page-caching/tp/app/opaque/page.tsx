import { firstDrive } from "../top/ranking";

export default async function Opaque() {
  const top = await firstDrive();
  return <p className="top" data-time={Date.now()}>{top ? top.name : "none"}</p>;
}
