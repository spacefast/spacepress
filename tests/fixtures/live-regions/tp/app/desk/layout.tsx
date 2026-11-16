import type { LayoutProps } from "typedpress/app";

export const guard = "editor";

export default function Desk({ children }: LayoutProps) {
  return <section className="desk">{children}</section>;
}
