import { Group, Navigation, NavigationLink, SiteTitle } from "@spacefast/zero-blocks/theme";

export default function Header() {
  return (
    <Group layout={{ type: "flex", justifyContent: "space-between" }}>
      <SiteTitle level={0} />
      <Navigation overlayMenu="never">
        <NavigationLink label="Home" url="/" />
        <NavigationLink label="About" url="/about/" />
      </Navigation>
    </Group>
  );
}
