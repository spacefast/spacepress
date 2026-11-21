import { action, text } from "typedpress";

// The server validates input before calling the handler.
export const greet = action({
  input: { name: text().min(1).max(60) },
  access: "anyone",
  handler({ name }) {
    return { message: `Hello, ${name}!` };
  },
});
