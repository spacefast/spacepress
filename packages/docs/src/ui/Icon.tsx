// An icon from the bundled Lucide set (icons.css), drawn as a CSS mask so it takes the text color
// and needs no script. An unknown name renders nothing.
import "../icons.css";
import { ICON_NAMES } from "../icons";

const NAMES: string[] = ICON_NAMES;

export function Icon({ name, size = 16, label }: { name: string; size?: number; label?: string }) {
  if (!NAMES.includes(name)) return null;
  return label ? (
    <span className={`sd-icon sd-i-${name}`} role="img" aria-label={label} style={{ "--sd-icon-size": `${size}px` }} />
  ) : (
    <span className={`sd-icon sd-i-${name}`} aria-hidden="true" style={{ "--sd-icon-size": `${size}px` }} />
  );
}

/** Whether the bundled set has an icon by this name. */
export function hasIcon(name: string): boolean {
  return NAMES.includes(name);
}
