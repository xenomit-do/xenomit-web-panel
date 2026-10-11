import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xenomit Panel",
  description: "Multi-instance web control panel for the Xenomit bot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
