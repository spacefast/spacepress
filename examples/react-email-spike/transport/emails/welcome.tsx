import { Body, Button, Html, Text } from "react-email";
import { Footer } from "./_components/Footer";

export interface WelcomeProps {
  name: string;
  dashboardUrl: string;
  siteName: string;
}

export default function Welcome({ name, dashboardUrl, siteName }: WelcomeProps) {
  return (
    <Html lang="en">
      <Body>
        <Text>Welcome, {name}!</Text>
        <Button href={dashboardUrl}>Open your dashboard</Button>
        <Footer siteName={siteName} />
      </Body>
    </Html>
  );
}

Welcome.PreviewProps = {
  name: "Ada",
  dashboardUrl: "https://example.test/dashboard",
  siteName: "Example site",
} satisfies WelcomeProps;
