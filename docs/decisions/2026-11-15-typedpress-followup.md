# TypedPress previews, agents, abilities and editing direction

Date: 2026-11-15. This records the owner's choices after reviewing the TypedPress guide. It distinguishes selected direction from working code. It does not change runtime behavior.

## Selected direction

| Area | Choice | Implementation boundary |
| --- | --- | --- |
| Build previews | Use a separate SQLite database per preview. | A preview cannot write the live database. Provision preview-local credentials, uploads and queued work too. Disable outgoing mail, payments and webhooks unless explicitly configured for the preview. Keep preview records and activity history until a person chooses to retire them. |
| App agents | Start with Agents API. | Reuse WordPress users, model providers and TypedPress's jobs and abilities. Data Machine can be an optional integration with its own typed PHP bindings. It is not a required engine for every app. |
| External tools | Use `abilities` for the setting that exposes an operation to outside callers. | Migrate today's `agents: false` declarations, generated schemas, client metadata, docs and examples together. Keep the word agent for agents an app declares. No rename is implemented by this decision. |
| Structured data | Include a WordPress SEO plugin rather than invent another schema generator. | Yoast SEO Free, `wordpress-seo` 28.8, is the recommended first integration for Article and BreadcrumbList. It needs a TSX metadata adapter and one owner of each head tag. Jetpack remains a candidate, but installing it alone does not guarantee its new schema feature is enabled. |

Separate SQLite databases isolate preview writes, not the effects of those writes. A preview must not receive production provider credentials or enqueue work on the live queue. A copy of live content also needs the same access restrictions as the live site. Switching an earlier build's code does not reverse database migrations.

Yoast's [Article generator](https://plugins.svn.wordpress.org/wordpress-seo/tags/28.8/src/generators/schema/article.php) and [Breadcrumb generator](https://plugins.svn.wordpress.org/wordpress-seo/tags/28.8/src/generators/schema/breadcrumb.php) provide the graph pieces. Custom post types need an explicit Article setting. Jetpack's [schema initializer](https://plugins.svn.wordpress.org/jetpack/tags/16.4/jetpack_vendor/automattic/jetpack-seo/src/class-initializer.php) also depends on feature availability, the SEO surface gate and the active SEO module. This is not a claim that Jetpack schema requires a paid plan.

## Rendering choices remain open

| Mode | Developer experience | WordPress compatibility |
| --- | --- | --- |
| Whole document, implemented today | TSX pages and layouts own the visible document, including header and footer. | WordPress head, body-open and footer hooks run. The active theme's visible templates do not render. Its styles and PHP may still affect the page. |
| Inside the active block theme, proposed | A TSX page supplies the content area. The Site Editor owns the surrounding header, footer and styles. | Retains the existing frame. The implementation must define content wrappers, CSS scope, navigation and cache invalidation when a template changes. |
| Generated block theme, earlier proposal | TSX compiles to block templates and template parts. | Requires stable theme identity, preserved Site Editor customizations and release pairing between the app and theme. Code updates need explicit rules for saved editor overrides. |

Recommendation: offer a theme frame for content sites and an explicit whole-document mode for app frontends. A TSX header or footer can remain a component inside the content layout. Making it editable as a native theme part is separate optional work. Do not imply that wrapping a TSX renderer in the theme makes its generated markup editable in the Site Editor.

The older [pages design](../design-pages-and-agents.md#46-layouts--themes) explored the whole-document default and generated themes. The current renderer lives in `runtime/First/Wp/AppRouter.php`. The inside-theme default and `shell = false` spelling are proposals, not accepted runtime APIs.

## WordPress supplies the editing tools

WordPress's Site Editor already edits block-theme templates, header and footer parts, navigation and global styles. Its block editor edits item bodies. A TSX page can render inside a native template while its surrounding layout stays editable in the Site Editor. The TSX region remains code unless the compiler emits native editable blocks for it.

Use those existing editors for the initial workflow. An embedded Gutenberg editor is needed only for the optional experience of editing over the public page without leaving it. Basic site editing does not require a new editor or an overlay.

The optional on-page workflow marks the record and field that produced a region. An authorized editor can edit plain text on the page, open the WordPress media library for images, and open a focused WordPress block editor over a rich body. Saves create draft or staged changes; publishing remains a separate permission-checked action. Computed, transformed and unsupported fields open the full editor.

Public visitors receive no editing markers or editor scripts. Edit and preview responses bypass shared caches. Reading a preview never authorizes a write. Cache purges must include theme changes as well as content changes.

This needs field attribution, native editor integration, save and publication handling, and browser verification. Markers alone do not implement inline editing. The [interactive comparison](../prototypes/rendering-editing.html) is a local UI prototype, not a feature implementation.

EmDash already implements actual inline text and image editing. Its Portable Text body uses an embedded TipTap editor. It saves drafts and publishes separately. Its [preview guide](https://github.com/emdash-cms/emdash/blob/8852f3faf825b9a43595f73aedf951fae4f22d1f/docs/src/content/docs/guides/preview.mdx), [toolbar](https://github.com/emdash-cms/emdash/blob/8852f3faf825b9a43595f73aedf951fae4f22d1f/packages/core/src/visual-editing/toolbar.ts) and [Portable Text component](https://github.com/emdash-cms/emdash/blob/8852f3faf825b9a43595f73aedf951fae4f22d1f/packages/core/src/components/PortableText.astro) establish that behavior. A TypedPress WordPress editor overlay must not be described as equivalent to EmDash's inline rich-text editor.

## Deployment readiness

The one-plugin receiver is the right owner for an existing-site warning. At PR #489 head `20b89bdaf5f981c8c51be4a248b0c2a2a97fd9b9`, it detects another active First app but does not inspect ordinary existing content before installation. Existing content must not be deleted or silently adopted.

Before that PR can merge, its permission checks must apply before candidate PHP executes, its dry run must not update or activate plugins, and the one-plugin WordPress tests must cover the actual merged candidate. Earlier successful lightweight CI checks do not establish those facts.
