// Inside sp/, so the config may import it; it then reaches back out of sp/.
import { prefix } from "../lib/prefix";
export const tags = [prefix + "app"];
