import type { LayoutProps } from "typedpress/app";

// Woo order reads and stock changes require an administrator.
export const guard = "admin";

export default function StaffLayout({ children }: LayoutProps) {
  return <section className="staff">{children}</section>;
}
