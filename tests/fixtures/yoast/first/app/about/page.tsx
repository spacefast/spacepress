export const metadata = {
  title: "First & Yoast",
  description: "About & details",
  canonical: "/about",
  robots: { follow: false },
  openGraph: { title: "Social & title", description: "Social description", image: "/og.png", type: "website" },
  twitter: { card: "summary_large_image" },
  links: [{ rel: "help", href: "/help" }],
};
export default function About() { return <h1>About</h1>; }
