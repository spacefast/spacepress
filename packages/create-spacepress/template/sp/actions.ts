import { HttpError, mutation } from "spacepress";

// The server validates input before calling the handler.
export const greet = mutation({ access: "anyone" }, ({ name }: { name: string }) => {
  if (name.length < 1 || name.length > 60) {
    throw new HttpError(422, "invalid_input", "name must be 1 to 60 characters", "/name");
  }
  return { message: `Hello, ${name}!` };
});
