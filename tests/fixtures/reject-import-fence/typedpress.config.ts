import { defineConfig, table } from "typedpress";
import { tags } from "./tp/tags";
export const items = table({  });

export default defineConfig({ name: tags[0] });
