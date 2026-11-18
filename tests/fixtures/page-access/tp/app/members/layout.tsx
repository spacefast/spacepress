import type { LayoutProps } from "typedpress/app";

export const guard = "authenticated";

export default function Members({ children }: LayoutProps) {
  return <section>{children}</section>;
}
