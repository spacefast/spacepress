import type { LayoutProps } from "spacepress/server/app";

export const guard = "authenticated";

export default function Members({ children }: LayoutProps) {
  return <section>{children}</section>;
}
