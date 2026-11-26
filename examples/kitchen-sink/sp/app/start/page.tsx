import { redirect } from "spacepress/server/app";

export const route = { id: "kitchen.start" };

export default function Start() {
  redirect("/about", 301);
}
