import { get_option } from "php/wordpress";

export function notice() {
  return String(get_option("pagecaching_store_notice") || "No notice");
}
