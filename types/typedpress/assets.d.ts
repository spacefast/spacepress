// Stylesheets and images that components and pages import (docs/spec/tsx-to-php.md, "Accepted").
// `typedpress build` copies each one into the app plugin under a content-hashed name.

/** A CSS module: each class selector, renamed `<file stem>_<class>`. */
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}

/** A stylesheet, linked on every page whose page or layouts import it. */
declare module "*.css" {}

/** An SVG file: its URL. */
declare module "*.svg" {
  const url: string;
  export default url;
}
