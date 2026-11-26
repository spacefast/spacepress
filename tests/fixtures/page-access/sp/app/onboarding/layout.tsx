import { redirect, type Guard, type LayoutProps } from "spacepress/server/app";

export const guard: Guard = ({ user }) => {
  if (user === null) {
    redirect("/guest");
  }
  return true;
};

export default function OnboardingLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
