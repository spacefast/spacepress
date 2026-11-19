import { Body, Button, Html, Text } from "react-email";

export interface InvitationProps {
  siteName: string;
  identityUrl: string;
  invitationCode: string;
  expiresIn: string;
}

export default function Invitation({ siteName, identityUrl, invitationCode, expiresIn }: InvitationProps) {
  return (
    <Html lang="en">
      <Body>
        <Text>Join your organization on {siteName}</Text>
        <Text>Verify your email and enter this invitation code in Organizations: <span style={{ wordBreak: "break-all" }}>{invitationCode}</span></Text>
        <Text>Expires in {expiresIn}.</Text>
        <Button href={identityUrl}>Open Identity</Button>
      </Body>
    </Html>
  );
}

Invitation.PreviewProps = {
  siteName: "Example site",
  identityUrl: "https://example.test/identity",
  invitationCode: "example.code",
  expiresIn: "seven days",
};
