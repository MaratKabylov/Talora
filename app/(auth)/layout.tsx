import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-6">
          <Link className="text-xl font-semibold tracking-tight" href="/">
            Talvia
          </Link>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-12">{children}</div>
    </main>
  );
}

