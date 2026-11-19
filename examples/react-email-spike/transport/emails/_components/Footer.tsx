import { Text } from "react-email";

export function Footer({ siteName }: { siteName: string }) {
  return <Text>Sent by {siteName}</Text>;
}
