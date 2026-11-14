import { update_option } from "php/wordpress";

// A compiled WordPress hook that writes: the store lane checks it never runs while a candidate is
// inspected, and runs on an initialized build's requests.
export default function () {
  update_option("first_installlane_hook_ran", "yes");
}
