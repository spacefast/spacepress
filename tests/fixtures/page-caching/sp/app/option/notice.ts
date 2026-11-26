import { get_option } from "spacepress/server/wp";

export function notice() {
  return String(get_option("pagecaching_store_notice") || "No notice");
}
