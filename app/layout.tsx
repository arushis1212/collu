import type { Metadata } from "next";
import {
  CalSansGeo,
  CalSansText,
  CalSansUI,
} from "@calcom/cal-sans-ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "COLLU — Agent Security Observatory",
  description:
    "Run a live agent workflow, inject a controlled attack, and trace every security decision to its origin.",
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
