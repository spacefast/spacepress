import { action } from "zero";
// An action named like a kind: export names are unique across the app.
export const notes = action({ input: {}, access: "anyone", handler: () => 1 });
