import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export default function AssessmentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
