// Stylesheets and static assets that components and pages import (docs/pages.md, "Assets").
// `typedpress build` copies each one into `tp/app/assets/` under a content-hashed name served from `wp-content/`.

/** A CSS module: each class selector, renamed `<file stem>_<class>`. */
declare module "*.module.css" {
  const classes: { readonly [className: string]: string };
  export default classes;
}

/** A stylesheet, linked on every page whose page or layouts import it. */
declare module "*.css" {}

// Images
declare module "*.svg" { const url: string; export default url; }
declare module "*.png" { const url: string; export default url; }
declare module "*.jpg" { const url: string; export default url; }
declare module "*.jpeg" { const url: string; export default url; }
declare module "*.gif" { const url: string; export default url; }
declare module "*.webp" { const url: string; export default url; }
declare module "*.avif" { const url: string; export default url; }
declare module "*.ico" { const url: string; export default url; }
declare module "*.bmp" { const url: string; export default url; }
declare module "*.tif" { const url: string; export default url; }
declare module "*.tiff" { const url: string; export default url; }
declare module "*.apng" { const url: string; export default url; }

// Fonts
declare module "*.woff" { const url: string; export default url; }
declare module "*.woff2" { const url: string; export default url; }
declare module "*.ttf" { const url: string; export default url; }
declare module "*.otf" { const url: string; export default url; }
declare module "*.eot" { const url: string; export default url; }

// Video & audio
declare module "*.mp4" { const url: string; export default url; }
declare module "*.webm" { const url: string; export default url; }
declare module "*.ogv" { const url: string; export default url; }
declare module "*.ogg" { const url: string; export default url; }
declare module "*.mp3" { const url: string; export default url; }
declare module "*.wav" { const url: string; export default url; }
declare module "*.flac" { const url: string; export default url; }
declare module "*.aac" { const url: string; export default url; }
declare module "*.m4a" { const url: string; export default url; }
declare module "*.opus" { const url: string; export default url; }
declare module "*.mov" { const url: string; export default url; }

// Documents & web assets
declare module "*.pdf" { const url: string; export default url; }
declare module "*.wasm" { const url: string; export default url; }
declare module "*.txt" { const url: string; export default url; }
declare module "*.csv" { const url: string; export default url; }
declare module "*.xml" { const url: string; export default url; }
declare module "*.webmanifest" { const url: string; export default url; }
declare module "*.glb" { const url: string; export default url; }
declare module "*.gltf" { const url: string; export default url; }
declare module "*.zip" { const url: string; export default url; }
declare module "*.vtt" { const url: string; export default url; }
