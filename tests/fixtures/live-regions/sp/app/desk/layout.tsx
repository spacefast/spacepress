import type { LayoutProps } from "spacepress/app";

export const access = "editor";

export default function Desk({ children }: LayoutProps) {
  return <section className="desk">{children}</section>;
}
