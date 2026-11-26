// The components Markdown pages write as tags. Re-export this file from one of the app's
// sp/components/ files to make them blocks:
//
//     // sp/components/docs.tsx
//     import "@spacepress/docs/docs.css";
//     export * from "@spacepress/docs/blocks";
export {
  Accordion,
  AccordionItem,
  Badge,
  Callout,
  Card,
  CardGroup,
  Column,
  Columns,
  Danger,
  Expandable,
  Field,
  File,
  FileTree,
  Folder,
  Frame,
  Kbd,
  Note,
  Panel,
  Step,
  Steps,
  Tile,
  Tip,
  Tooltip,
  Warning,
  YouTube,
} from "./ui/content";
export { Icon } from "./ui/Icon";
export { Tab, Tabs } from "./ui/Tabs";

export const blocks = [
  "Accordion",
  "AccordionItem",
  "Badge",
  "Callout",
  "Card",
  "CardGroup",
  "Column",
  "Columns",
  "Danger",
  "Expandable",
  "Field",
  "File",
  "FileTree",
  "Folder",
  "Frame",
  "Icon",
  "Kbd",
  "Note",
  "Panel",
  "Step",
  "Steps",
  "Tab",
  "Tabs",
  "Tile",
  "Tip",
  "Tooltip",
  "Warning",
  "YouTube",
];
