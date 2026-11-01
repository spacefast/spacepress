// A negative fixture for the type-level test: every line marked @ts-expect-error must be a
// type error, and every unmarked line must typecheck. `tsc` on this file is the assertion.
import { Block, Group, Paragraph, Image } from "@spacefast/zero-blocks";
import { defineTheme, PostDate, QueryLoop, PostTitle, TemplatePart } from "@spacefast/zero-blocks/theme";

const theme = defineTheme({
  name: "T",
  slug: "t",
  settings: { color: { palette: [{ slug: "base", name: "Base", color: "#fff" }, { slug: "primary", name: "Primary", color: "#00f" }] }, typography: { fontSizes: [{ slug: "lg", name: "Large", size: "2rem" }] } },
});

export const ok = [
  <Group tagName="main" backgroundColor={theme.tokens.color.primary} layout={{ type: "constrained" }}><Paragraph>x</Paragraph></Group>,
  <Paragraph dropCap align="wide">x</Paragraph>,
  <Image url="/a.png" alt="A" width="300px" />,
  <PostDate format="Y" isLink />,
  <QueryLoop inherit><PostTitle /></QueryLoop>,
  <QueryLoop query={{ postType: "post", perPage: 6, orderBy: "title" }}><PostTitle /></QueryLoop>,
  <TemplatePart slug="header" />,
  <Block.Core.PostFeaturedImage aspectRatio="3/2" />,
  <Block name="acme/thing" attrs={{ anything: 1 }} />,
];

export const bad = [
  // @ts-expect-error a slug the palette does not have
  theme.tokens.color.brand,
  // @ts-expect-error a slug the font sizes do not have
  theme.tokens.fontSize.huge,
  // @ts-expect-error core/post-date has no attribute `fmt`
  <PostDate fmt="Y" />,
  // @ts-expect-error `align` is an enum; `middle` is not in it
  <Paragraph align="middle">x</Paragraph>,
  // @ts-expect-error `dropCap` is a boolean
  <Paragraph dropCap="yes">x</Paragraph>,
  // @ts-expect-error `width` of core/image is a string
  <Image url="/a.png" width={300} />,
  // @ts-expect-error a loop needs `inherit` or `query`
  <QueryLoop><PostTitle /></QueryLoop>,
  // @ts-expect-error not both
  <QueryLoop inherit query={{ postType: "post" }}><PostTitle /></QueryLoop>,
  // @ts-expect-error `orderBy` is an enum
  <QueryLoop query={{ orderBy: "colour" }}><PostTitle /></QueryLoop>,
  // @ts-expect-error `slug` is required
  <TemplatePart />,
  // @ts-expect-error settings must fit theme.json: a palette entry needs name and color
  defineTheme({ name: "T", slug: "t", settings: { color: { palette: [{ slug: "x" }] } } }),
  // @ts-expect-error an unknown settings key
  defineTheme({ name: "T", slug: "t", settings: { colour: {} } }),
];
