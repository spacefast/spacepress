import { definePlugin } from "typedpress";

export default function kitchenPolicy() {
  return definePlugin({
    name: "policy",
    hooks: {
      events: {
        beforeCreate(data) {
          if (data.venue === "Kitchen") data.venue = "Teaching kitchen";
        },
      },
    },
  });
}
