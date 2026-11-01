import { Group, Pattern, QueryLoop, PostTitle, PostExcerpt, Pagination, NoResults, TemplatePart } from "@spacefast/zero-blocks/theme";
import theme from "../theme.config.ts";

export default function Index() {
  return (
    <>
      <TemplatePart slug="header" />
      <Group tagName="main" layout={{ type: "constrained" }} backgroundColor={theme.tokens.color.base}>
        <Pattern slug="fixture-theme/hero" />
        <QueryLoop inherit>
          <PostTitle isLink />
          <PostExcerpt />
          <NoResults>
            <p>Nothing here yet.</p>
          </NoResults>
          <Pagination />
        </QueryLoop>
      </Group>
      <TemplatePart slug="footer" />
    </>
  );
}
