import { definePattern, Group, Heading, Paragraph } from "@spacefast/zero-blocks/theme";

export const meta = definePattern({ title: "Call to action", slug: "fixture-theme/call-to-action", categories: ["call-to-action"], inserter: false });

export default function Cta() {
  return (
    <Group layout={{ type: "constrained" }}>
      <Heading level={2}>Ready?</Heading>
      <Paragraph>Get in touch, or <a href="/pricing/">see pricing</a>.</Paragraph>
    </Group>
  );
}
