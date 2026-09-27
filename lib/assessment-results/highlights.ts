import type { AssessmentDimensionGroup, AssessmentDimensionResult, AssessmentHighlight } from "./types";
import { assignCompetitionRanks } from "../reports/profile-ranking.ts";

function withScores(dimensions: readonly AssessmentDimensionResult[]) {
  return dimensions.filter(
    (dimension): dimension is AssessmentDimensionResult & { normalizedScore: number } =>
      dimension.normalizedScore !== null,
  );
}

function names(dimensions: readonly AssessmentDimensionResult[]) {
  return dimensions.map((dimension) => dimension.title.toLocaleLowerCase("ru-RU")).join(", ");
}

export function buildAssessmentHighlights(
  groups: readonly AssessmentDimensionGroup[],
  maximum = 5,
): AssessmentHighlight[] {
  const highlights: AssessmentHighlight[] = [];
  for (const group of groups) {
    const scored = withScores(group.dimensions);
    if (scored.length === 0) continue;
    const ranked = scored.slice().sort((left, right) => right.normalizedScore - left.normalizedScore);

    if (group.key === "motivation") {
      const rankedWithTies = assignCompetitionRanks(ranked, (dimension) => dimension.normalizedScore);
      const leadingRank = rankedWithTies[0]?.rank ?? null;
      const leading = rankedWithTies
        .filter((entry) => entry.rank === leadingRank)
        .map((entry) => entry.value);
      const lower = rankedWithTies
        .filter((entry) => entry.rank !== null && entry.rank !== leadingRank)
        .map((entry) => entry.value);
      highlights.push({
        group: group.key,
        text: `Более приоритетные факторы профиля: ${names(leading)}.`,
        title: "Мотивация",
      });
      if (lower.length > 0) {
        const lowestScore = lower.at(-1)?.normalizedScore ?? null;
        const lowest = lower.filter((dimension) => dimension.normalizedScore === lowestScore);
        highlights.push({
          group: group.key,
          text: `Относительно менее приоритетные факторы: ${names(lowest)}.`,
          title: "Относительные приоритеты",
        });
      }
    } else if (group.key === "work_competencies") {
      highlights.push({
        group: group.key,
        text: `Наиболее выражены: ${names(ranked.slice(0, 2))}.`,
        title: "Рабочие компетенции",
      });
      const failed = ranked.filter((dimension) => dimension.threshold?.status === "failed").slice(0, 2);
      if (failed.length > 0) {
        highlights.push({
          group: group.key,
          text: `Ниже обязательного минимума: ${names(failed)}.`,
          title: "Обязательные минимумы",
        });
      }
    } else if (group.key === "cognitive") {
      highlights.push({
        group: group.key,
        text: ranked
          .slice(0, 3)
          .map((dimension) => `${dimension.title} — ${dimension.normalizedScore.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`)
          .join("; ") + ".",
        title: "Когнитивный профиль",
      });
    } else if (group.key === "behavior" || group.key === "personality") {
      highlights.push({
        group: group.key,
        text: `Наиболее выраженные шкалы профиля: ${names(ranked.slice(0, 3))}.`,
        title: group.title,
      });
    } else {
      highlights.push({
        group: group.key,
        text: ranked
          .slice(0, 3)
          .map((dimension) => `${dimension.title} — ${dimension.normalizedScore.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`)
          .join("; ") + ".",
        title: group.title,
      });
    }
    if (highlights.length >= maximum) break;
  }
  return highlights.slice(0, maximum);
}
