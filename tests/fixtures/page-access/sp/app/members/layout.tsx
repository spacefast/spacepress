import type { LayoutProps } from "spacepress/app";

export const access = "authenticated";

export default function Members({ children }: LayoutProps) {
  return <section>{children}</section>;
}
