import { Live } from "spacepress/server/app";

export const guard = "admin";

export default function Office() {
  return <Live id="records"><h1>Office records</h1></Live>;
}
