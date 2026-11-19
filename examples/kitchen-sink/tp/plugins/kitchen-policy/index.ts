import { definePlugin } from "typedpress";

export default function kitchenPolicy() {
  return definePlugin({
    name: "policy",
    hooks: {
      recipes: {
        beforeCreate(data) {
          if (typeof data.title === "string") data.title = data.title.trim();
        },
      },
    },
  });
}
