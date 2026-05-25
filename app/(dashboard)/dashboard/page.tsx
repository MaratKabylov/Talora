import { FeedbackMessage } from "@/components/feedback-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";

const areas = [
  {
    title: "Вакансии",
    description: "Управление позициями и требованиями появится в Milestone 3.",
  },
  {
    title: "Тесты",
    description: "Библиотека и версии тестов появятся в Milestone 4.",
  },
  {
    title: "Кандидаты",
    description: "Приглашения и список кандидатов появятся в Milestone 6.",
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
            Вы работаете в роли {context.activeCompany.role}. Здесь будет сводка по вакансиям,
            приглашениям и результатам.
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
