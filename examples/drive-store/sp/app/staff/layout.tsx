import type { LayoutProps } from "spacepress/server/app";

// Woo order reads and stock changes require an administrator.
export const guard = "admin";

export default function StaffLayout({ children }: LayoutProps) {
  return <section className="staff">{children}</section>;
}
