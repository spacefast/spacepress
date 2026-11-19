import { definePlugin } from "typedpress";

export default function kitchenPolicy() {
  return definePlugin({
    name: "policy",
    hooks: {
      recipes: {
        beforeCreate(data) {
          data.title = data.title.trim();
        },
      },
    },
  });
}
