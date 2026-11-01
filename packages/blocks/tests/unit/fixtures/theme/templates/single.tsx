import { Group, PostContent, PostDate, PostTitle, TemplatePart } from "@spacefast/zero-blocks/theme";
import theme from "../theme.config.ts";

export default function Single() {
  return (
    <>
      <TemplatePart slug="header" />
      <Group tagName="main" layout={{ type: "constrained" }}>
        <PostTitle level={1} fontSize={theme.tokens.fontSize.lg} />
        <PostDate />
        <PostContent />
      </Group>
      <TemplatePart slug="footer" />
    </>
  );
}
