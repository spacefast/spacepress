import { Group, PostContent } from "@spacefast/zero-blocks/theme";

/** A custom template declared in theme.config.ts, not in the file. */
export default function Landing() {
  return (
    <Group tagName="main" layout={{ type: "constrained" }}>
      <PostContent />
    </Group>
  );
}
