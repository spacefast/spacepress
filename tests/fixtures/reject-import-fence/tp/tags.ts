// Inside tp/, so the config may import it; it then reaches back out of tp/.
import { prefix } from "../lib/prefix";
export const tags = [prefix + "app"];
