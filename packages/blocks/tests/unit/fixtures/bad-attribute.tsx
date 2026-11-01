import { blockComponent } from "@spacefast/zero-blocks";

const Heading = blockComponent<{ level?: number; fmt?: string }>("core/heading");

export default function BadAttribute() {
  return (
    <>
      <Heading level={2}>fine</Heading>
      <Heading fmt="x">typo</Heading>
    </>
  );
}
