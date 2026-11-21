import { Body, Button, Html, Text } from "react-email";

export interface InvitationProps {
  name: string;
  url: string;
}

export default function Invitation({ name, url }: InvitationProps) {
  return (
    <Html lang="en">
      <Body>
        <Text>Hello, {name}!</Text>
        <Button href={url}>Accept invitation</Button>
      </Body>
    </Html>
  );
}

Invitation.PreviewProps = { name: "Ada", url: "https://example.test/invite?org=1&code=demo" };
