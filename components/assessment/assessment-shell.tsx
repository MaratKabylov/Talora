import Link from "next/link";

export function AssessmentShell({
  children,
  companyName,
}: {
  children: React.ReactNode;
  companyName?: string;
}) {
  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <Link className="text-xl font-semibold tracking-tight" href="/">
            Talora
          </Link>
          {companyName ? <p className="text-sm text-muted-foreground">{companyName}</p> : null}
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-10">{children}</div>
    </main>
  );
}

export function AssessmentUnavailable({
  state,
}: {
  state: "invalid" | "expired" | "cancelled";
}) {
  const content = {
    cancelled: {
      description: "Приглашение отменено работодателем. Уточните дальнейшие шаги у контактного лица.",
      title: "Приглашение отменено",
    },
    expired: {
      description: "Срок действия ссылки закончился. Запросите новое приглашение у работодателя.",
      title: "Ссылка истекла",
    },
    invalid: {
      description: "Проверьте адрес ссылки или запросите новое приглашение у работодателя.",
      title: "Приглашение не найдено",
    },
  }[state];

  return (
    <AssessmentShell>
      <div className="rounded-xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">{content.title}</h1>
        <p className="mt-3 text-muted-foreground">{content.description}</p>
      </div>
    </AssessmentShell>
  );
}
