import { redirect, type Guard, type LayoutProps } from "spacepress/app";

export const access: Guard = ({ user }) => {
  if (user === null) {
    redirect("/guest");
  }
  return true;
};

export default function OnboardingLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
