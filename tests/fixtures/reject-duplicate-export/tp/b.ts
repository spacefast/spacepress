import { mutation } from "typedpress";
// An action named like a kind: export names are unique across the app.
export const notes = mutation({ access: "anyone" }, () => 1);
