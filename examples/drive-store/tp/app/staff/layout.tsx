import type { LayoutProps } from "typedpress/app";

// Editors and admins only. The actions on these pages check the same role on their own.
export const guard = "editor";

export default function StaffLayout({ children }: LayoutProps) {
  return <section className="staff">{children}</section>;
}
