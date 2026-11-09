// Inside zero/, so the config may import it; it then reaches back out of zero/.
import { prefix } from "../lib/prefix";
export const tags = [prefix + "app"];
