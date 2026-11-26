import type { NavItem } from "spacepress/content";
import type { SearchEntry } from "./ui/Search";

/**
 * Every page of a docs tree as a search entry, its section the top-level group it sits in.
 * `descriptions` maps a page's href to the line shown under its title.
 */
export function searchEntries(tree: NavItem[], descriptions: Record<string, string> = {}): SearchEntry[] {
  const out: SearchEntry[] = [];
  const walk = (items: NavItem[], section: string): void => {
    for (const item of items) {
      const own = section === "" ? item.title : section;
      out.push({ title: item.title, href: item.href, section: own, description: descriptions[item.href] ?? "" });
      walk(item.children, own);
    }
  };
  walk(tree, "");
  return out;
}
