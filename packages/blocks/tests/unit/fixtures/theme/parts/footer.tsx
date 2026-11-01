import { definePart, Group, Paragraph } from "@spacefast/zero-blocks/theme";
import theme from "../theme.config.ts";

export const meta = definePart({ title: "Site Footer", area: "footer" });

export default function Footer() {
  return (
    <Group layout={{ type: "constrained" }} fontSize={theme.tokens.fontSize.sm}>
      <Paragraph>Built with Zero Blocks.</Paragraph>
    </Group>
  );
}
