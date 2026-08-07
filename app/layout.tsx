import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Talvia | HR Assessment",
  description: "Platform for candidate assessment and comparison.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

