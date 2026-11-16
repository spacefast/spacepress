// tp/app/ pages inside the active block theme's templates (docs/pages.md "Block templates";
// tests/php/block_templates.php): the theme's header and footer wrap the pages, a layout that
// places <TemplatePart> draws its own, a page picks the blank template, and the 404 and sign-in
// pages are editable templates.
import { defineConfig } from "typedpress";

export default defineConfig({ name: "blocktemplates" });
