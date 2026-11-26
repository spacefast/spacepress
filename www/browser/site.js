// The site's bundled browser script, loaded via metadata.scripts in layout.tsx.
import "./code.js";
import "./sandbox.js";
import "./play.js";
import "./ui.js";

try {
  const theme = localStorage.getItem("sd-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // The reference still follows the system setting when storage is blocked.
}
