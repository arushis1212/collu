import type { Metadata } from "next";
import {
  CalSansGeo,
  CalSansText,
  CalSansUI,
} from "@calcom/cal-sans-ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Security Observatory",
  description:
    "Watch risk move through a live multi-agent system and trace every action to its origin.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${CalSansUI.variable} ${CalSansText.variable} ${CalSansGeo.variable}`}
      lang="en"
    >
      <body>{children}</body>
    </html>
  );
}
