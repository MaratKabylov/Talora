import { FeedbackMessage } from "@/components/feedback-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";

const areas = [
  {
    title: "Вакансии",
    description: "Создавайте позиции, назначайте пакет оценки и настраивайте веса компетенций.",
  },
  {
    title: "Тесты",
    description: "Используйте системные тесты и создавайте версии собственных методик.",
  },
  {
    title: "Кандидаты",
    description: "Отслеживайте приглашения, результаты оценки, отчеты и шорт-листы.",
  },
];

type DashboardSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>
            Добро пожаловать, {context.profile?.fullName ?? context.user.email ?? "коллега"}
          </CardTitle>
          <CardDescription>
            Вы работаете в роли {context.activeCompany.role}. Перейдите в вакансии, чтобы
            пригласить кандидатов и сравнить результаты оценки.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {areas.map((area) => (
          <Card key={area.title}>
            <CardHeader>
              <CardTitle>{area.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {area.description}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
