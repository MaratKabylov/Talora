import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  ACCESS_REASON_LABELS,
  ACCESS_REASON_VALUES,
  type AccessReason,
  canViewCandidatePii,
} from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { getAdminApplicationDetail } from "@/lib/admin/data";
import {
  APPLICATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { COMPETENCIES } from "@/lib/jobs/constants";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ reason?: string }>;
type Option = { id: string; text: string };
type Question = {
  answer_options?: Option[] | null;
  question_type: string;
  text: string;
};
type Answer = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  id: string;
  is_correct: boolean | null;
  points_awarded: number | null;
  questions: Question | Question[] | null;
  selected_option_id: string | null;
};
type Version = { title: string };
type Session = {
  candidate_answers?: Answer[] | null;
  completed_at: string | null;
  id: string;
  percentage: number | null;
  status: string;
  test_versions: Version | Version[] | null;
};

function validReason(value: string | undefined): AccessReason | null {
  return ACCESS_REASON_VALUES.includes(value as AccessReason) ? (value as AccessReason) : null;
}

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function renderAnswer(answer: Answer) {
  const question = one(answer.questions);
  if (!question) {
    return { response: "Ответ недоступен", text: "Вопрос" };
  }
  const options = question.answer_options ?? [];
  if (question.question_type === "single_choice") {
    return {
      response: options.find((option) => option.id === answer.selected_option_id)?.text ?? "Ответ не выбран",
      text: question.text,
    };
  }
  if (question.question_type === "multiple_choice") {
    const ids = Array.isArray(answer.answer_json?.selectedOptionIds)
      ? answer.answer_json.selectedOptionIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      response: options.filter((option) => ids.includes(option.id)).map((option) => option.text).join(", ") || "Ответ не выбран",
      text: question.text,
    };
  }
  if (question.question_type === "forced_choice") {
    const mostOptionId = answer.answer_json?.mostOptionId;
    const leastOptionId = answer.answer_json?.leastOptionId;
    const mostText =
      typeof mostOptionId === "string"
        ? options.find((option) => option.id === mostOptionId)?.text
        : null;
    const leastText =
      typeof leastOptionId === "string"
        ? options.find((option) => option.id === leastOptionId)?.text
        : null;
    return {
      response: `Больше всего: ${mostText ?? "не выбрано"}\nМеньше всего: ${leastText ?? "не выбрано"}`,
      text: question.text,
    };
  }
  if (question.question_type === "scale") {
    return { response: String(answer.answer_json?.value ?? "Ответ не выбран"), text: question.text };
  }
  return { response: answer.answer_text ?? "Ответ не указан", text: question.text };
}

export default async function AdminApplicationPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ id }, query, context] = await Promise.all([params, searchParams, requirePlatformContext()]);
  const reason = validReason(query.reason);

  if (!canViewCandidatePii(context.role)) {
    return (
      <EmptyState
        description="Роль аналитика не дает доступ к персональным данным и ответам кандидатов."
        title="Доступ ограничен"
      />
    );
  }

  if (!reason) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Персональные данные кандидата</p>
          <h1 className="text-3xl font-semibold tracking-tight">Укажите причину доступа</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Privacy control</CardTitle>
            <CardDescription>
              Открытие отчета и ответов будет записано в журнал аудита от вашего имени.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form className="space-y-4">
              <Select name="reason" required>
                <option value="">Выберите причину</option>
                {ACCESS_REASON_VALUES.map((value) => (
                  <option key={value} value={value}>{ACCESS_REASON_LABELS[value]}</option>
                ))}
              </Select>
              <button className={buttonVariants()} type="submit">Открыть данные кандидата</button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = await getAdminApplicationDetail(id, reason);
  if (!data) {
    notFound();
  }

  const candidate = data.application.candidate;
  const competencies = new Map(COMPETENCIES.map((item) => [item.key, item.label]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-primary">Доступ зафиксирован: {ACCESS_REASON_LABELS[reason]}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{candidate?.full_name ?? "Кандидат"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[candidate?.email, candidate?.phone, candidate?.city].filter(Boolean).join(" / ") || "Контакты не указаны"}
          </p>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/applications">
          К списку
        </Link>
      </div>

      <p className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        {data.application.company?.name ?? "Компания"} / {data.application.job?.title ?? "Вакансия"}.
        Персональные данные и ответы отображаются только для служебной проверки.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardDescription>Overall score</CardDescription><CardTitle className="text-3xl">{data.application.overall_score ?? "-"}%</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Fit score</CardDescription><CardTitle className="text-3xl">{data.application.fit_score ?? "-"}%</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Рекомендация</CardDescription><CardTitle>{data.application.recommendation ? RECOMMENDATION_LABELS[data.application.recommendation] ?? data.application.recommendation : "-"}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Статус / риск</CardDescription><CardTitle>{APPLICATION_STATUS_LABELS[data.application.status as keyof typeof APPLICATION_STATUS_LABELS] ?? data.application.status}</CardTitle><p className="text-sm text-muted-foreground">{data.application.risk_level ? RISK_LEVEL_LABELS[data.application.risk_level] ?? data.application.risk_level : "Нет риска"}</p></CardHeader></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Компетенции</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-6">
            {data.competencies.map((score) => (
              <div className="flex justify-between gap-3 text-sm" key={score.competency_key}>
                <span>{competencies.get(score.competency_key as never) ?? score.competency_key}</span>
                <span className={score.is_below_minimum ? "text-destructive" : "text-muted-foreground"}>
                  {score.percentage ?? "-"}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Риски</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-6">
            {data.risks.length === 0 ? <p className="text-sm text-muted-foreground">Риски не зафиксированы.</p> : null}
            {data.risks.map((risk) => (
              <div className="rounded-md border p-3 text-sm" key={risk.id}>
                <p className="font-medium">{risk.title}</p>
                <p className="mt-1 text-muted-foreground">{risk.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сессии и ответы</CardTitle>
          <CardDescription>Ответы доступны только для поддержки и проверки корректности результата.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {(data.sessions as unknown as Session[]).map((session) => {
            const version = one(session.test_versions);
            return (
              <details className="rounded-lg border p-4" key={session.id}>
                <summary className="cursor-pointer font-medium">
                  {version?.title ?? "Тест"} / {session.status} / {session.percentage ?? "-"}%
                </summary>
                <div className="mt-4 space-y-4">
                  {(session.candidate_answers ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ответы не найдены.</p>
                  ) : null}
                  {(session.candidate_answers ?? []).map((answer) => {
                    const rendered = renderAnswer(answer);
                    return (
                      <div className="space-y-2 text-sm" key={answer.id}>
                        <p className="font-medium">{rendered.text}</p>
                        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{rendered.response}</p>
                        {answer.points_awarded !== null ? (
                          <p className="text-muted-foreground">Баллы: {answer.points_awarded}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
