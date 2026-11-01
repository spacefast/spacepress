import { defineTheme, preset } from "@spacefast/zero-blocks/theme";

export default defineTheme({
  name: "Fixture Theme",
  slug: "fixture-theme",
  version: "1.2.3",
  description: "The theme the unit suite builds.",
  author: "Zero",
  tags: ["blog", "one-column"],
  settings: {
    appearanceTools: true,
    layout: { contentSize: "44rem", wideSize: "72rem" },
    color: {
      defaultPalette: false,
      palette: [
        { slug: "base", name: "Base", color: "#ffffff" },
        { slug: "contrast", name: "Contrast", color: "#111111" },
        { slug: "primary", name: "Primary", color: "#3858e9" },
      ],
    },
    typography: {
      fontFamilies: [{ slug: "body", name: "Body", fontFamily: "Inter, sans-serif", fontFace: [{ fontFamily: "Inter", fontWeight: "400 700", fontStyle: "normal", src: ["file:./assets/fonts/inter.woff2"] }] }],
      fontSizes: [
        { slug: "sm", name: "Small", size: "0.875rem" },
        { slug: "lg", name: "Large", size: "1.5rem" },
      ],
    },
    spacing: { spacingSizes: [{ slug: "20", name: "2", size: "1rem" }, { slug: "40", name: "4", size: "2rem" }] },
  },
  styles: {
    color: { background: preset.color("base"), text: preset.color("contrast") },
    typography: { fontFamily: preset.fontFamily("body") },
    elements: { link: { color: { text: preset.color("primary") } } },
    blocks: { "core/button": { border: { radius: "4px" } } },
  },
  customTemplates: [{ name: "landing", title: "Landing (declared)", postTypes: ["page"] }],
  externalPatterns: ["acme/testimonials"],
});
