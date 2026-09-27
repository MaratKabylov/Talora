type AnswerCorrectness = {
  isCorrect: boolean | null;
};

export type ReportAnswerSummary =
  | {
      correct: number;
      incorrect: number;
      kind: "correctness";
    }
  | {
      answered: number;
      completionRate: number | null;
      eligible: number;
      kind: "completion";
    };

export function usesCorrectnessSummary(input: {
  assessmentDomain?: string | null;
  resultShape?: string | null;
  scoringType?: string | null;
}) {
  if (input.resultShape === "profile") return false;
  if (input.scoringType === "competency_profile") return false;
  return !["behavior", "motivation", "personality", "sjt"].includes(
    input.assessmentDomain ?? "",
  );
}

export function countAnswerCorrectness(answers: readonly AnswerCorrectness[]) {
  return answers.reduce(
    (counts, answer) => {
      if (answer.isCorrect === true) {
        counts.correct += 1;
      } else if (answer.isCorrect === false) {
        counts.incorrect += 1;
      }

      return counts;
    },
    { correct: 0, incorrect: 0 },
  );
}

export function buildReportAnswerSummary(input: {
  answeredCount: number;
  answers: readonly AnswerCorrectness[];
  eligibleCount: number;
  usesCorrectness: boolean;
}): ReportAnswerSummary {
  if (input.usesCorrectness) {
    return { kind: "correctness", ...countAnswerCorrectness(input.answers) };
  }

  const completionRate = input.eligibleCount > 0
    ? Math.round((input.answeredCount / input.eligibleCount) * 10_000) / 100
    : null;

  return {
    answered: input.answeredCount,
    completionRate,
    eligible: input.eligibleCount,
    kind: "completion",
  };
}

export function formatReportAnswerSummary(summary: ReportAnswerSummary) {
  if (summary.kind === "correctness") {
    return `Верных: ${summary.correct} / Неверных: ${summary.incorrect}`;
  }

  const completion = summary.completionRate === null
    ? "—"
    : `${summary.completionRate.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
  return `Ответов: ${summary.answered} / ${summary.eligible} / Полнота: ${completion}`;
}
