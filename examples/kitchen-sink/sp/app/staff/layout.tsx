import type { LayoutProps } from "spacepress/app";

export const access = "editor";

export default function StaffLayout({ children }: LayoutProps) {
  return <section aria-label="Staff tools">{children}</section>;
}
