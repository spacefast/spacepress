import { Live } from "typedpress/app";

export const guard = "admin";

export default function Office() {
  return <Live id="records"><h1>Office records</h1></Live>;
}
