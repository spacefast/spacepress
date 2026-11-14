import type { LayoutProps } from "first/app";

export const guard = "editor";

export default function Desk({ children }: LayoutProps) {
  return <section className="desk">{children}</section>;
}
