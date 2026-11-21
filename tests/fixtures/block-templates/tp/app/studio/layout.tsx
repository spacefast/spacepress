import { TemplatePart, type LayoutProps } from "typedpress/app";

// Places the theme's header itself, and its own footer: the blank template, by default.
export default function Studio({ children }: LayoutProps) {
  return (
    <div className="studio">
      <TemplatePart slug="header" tagName="header" />
      {children}
      <footer className="studio-footer">Studio footer</footer>
    </div>
  );
}
