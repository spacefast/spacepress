import { Button, Buttons, Cover, definePattern, Heading } from "@spacefast/zero-blocks/theme";
import theme from "../theme.config.ts";

export const meta = definePattern({ title: "Hero", description: "A full-width welcome.", categories: ["banner", "featured"], keywords: ["welcome"], blockTypes: ["core/post-content"], postTypes: ["page"], viewportWidth: 1400, inserter: true });

export default function Hero() {
  return (
    <>
      <Cover overlayColor={theme.tokens.color.primary} dimRatio={50} minHeight={40} minHeightUnit="vh">
        <Heading level={1} textColor={theme.tokens.color.base}>Welcome</Heading>
      </Cover>
      <Buttons layout={{ type: "flex", justifyContent: "center" }}>
        <Button text="Read the blog" url="/blog/" />
      </Buttons>
    </>
  );
}
