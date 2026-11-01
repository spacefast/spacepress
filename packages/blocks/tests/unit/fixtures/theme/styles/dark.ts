import { defineStyleVariation, preset } from "@spacefast/zero-blocks/theme";

export default defineStyleVariation({
  title: "Dark",
  settings: { color: { palette: [{ slug: "base", name: "Base", color: "#111111" }, { slug: "contrast", name: "Contrast", color: "#ffffff" }, { slug: "primary", name: "Primary", color: "#8da2fb" }] } },
  styles: { color: { background: preset.color("base"), text: preset.color("contrast") } },
});
