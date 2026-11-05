// Asset imports in pages: CSS modules are class maps, other files are URLs.
declare module "*.module.css" { const classes: Readonly<Record<string, string>>; export default classes; }
declare module "*.css" {}
declare module "*.svg" { const url: string; export default url; }
