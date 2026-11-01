import { defineTemplate, Group, PostContent, TemplatePart } from "@spacefast/zero-blocks/theme";

export const meta = defineTemplate({ title: "Contact", postTypes: ["page"] });

export default function Contact() {
  return (
    <>
      <TemplatePart slug="header" />
      <Group tagName="main" layout={{ type: "constrained" }}>
        <PostContent />
      </Group>
    </>
  );
}
