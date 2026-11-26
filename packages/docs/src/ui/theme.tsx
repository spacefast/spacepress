import { Icon } from "./Icon";

/** The light/dark switch. `DocsEnhancements` handles the click and remembers the choice. */
export function ThemeToggle() {
  return (
    <button type="button" className="sd-theme-toggle" data-sd-theme-toggle="" aria-label="Switch between light and dark">
      <span className="sd-theme-sun">
        <Icon name="sun" size={16} />
      </span>
      <span className="sd-theme-moon">
        <Icon name="moon" size={16} />
      </span>
    </button>
  );
}

/**
 * The remembered theme, applied before the page paints so it doesn't flash. Serve it as a file
 * (`sp/public/`) and list its URL in the layout's `metadata.scripts`.
 */
export const themeScript =
  'try{var t=localStorage.getItem("sd-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}';
