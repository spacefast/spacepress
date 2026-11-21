import { Text } from "react-email";

export function Footer({ siteName }: { siteName: string }) {
  return <Text>Sent by {siteName}<br />Reply to this email for help.</Text>;
}
