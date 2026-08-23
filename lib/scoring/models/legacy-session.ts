import {
  COMPETENCIES,
  type CompetencyKey,
} from "../../jobs/constants.ts";
import {
  isMultipleChoiceV1,
  scoreMultipleChoiceQuestion,
  validateMultipleChoiceAnswer,
  validateMultipleChoiceDefinition,
  type MultipleChoiceScoreResult,
  type NormalizedMultipleChoiceDefinition,
} from "../../answers/multiple-choice.ts";
import {
  scoreForcedChoiceQuestion,
  validateForcedChoiceAnswer,
} from "../../forced-choice.ts";
import type { QuestionType } from "../../tests/builder-constants.ts";
import type { QuestionSettings } from "../../tests/remediation.ts";
import {
  isStructuredQuestion,
  normalizeMatchingScoringMode,
  normalizeOrderingScoringMode,
  scoreMatchingAnswer,
  scoreOrderingAnswer,
  validateMatchingAnswer,
  validateOrderingAnswer,
} from "../../structured-questions.ts";

export type LegacyScoringType = "points" | "competency_profile" | "manual" | "mixed";

export type LegacyRelation<T> = T | T[] | null;

export type LegacyVersionRecord = {
  assessment_domain?: string | null;
  result_shape?: string | null;
  scoring_config_json?: unknown;
  scoring_schema_version?: string | null;
  scoring_type: LegacyScoringType;
  title: string;
};

export type LegacySessionRecord = {
  id: string;
  status: string;
  test_version_id: string;
  test_versions: LegacyRelation<LegacyVersionRecord>;
};

export type LegacyPackageTestRecord = {
  is_required: boolean;
  passing_score: number | null;
  test_version_id: string;
  weight: number;
};

export type LegacyOptionRecord = {
  competency_effect_json: Record<string, number> | null;
  id: string;
  is_correct: boolean | null;
  match_target_id: string;
  order_index: number;
  points: number;
};

export type LegacyQuestionRecord = {
  answer_options?: LegacyOptionRecord[] | null;
  competency_key: CompetencyKey | null;
  id: string;
  points: number;
  question_type: QuestionType;
  scoring_config_json?: unknown;
  scoring_model?: "criterion" | "scale" | "forced_choice" | null;
  settings_json: QuestionSettings | null;
};

export type LegacySectionRecord = {
  questions?: LegacyQuestionRecord[] | null;
  test_version_id: string;
};

export type LegacyAnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  id: string;
  question_id: string;
  selected_option_id: string | null;
  session_id: string;
};

export type LegacyCompetencyTotal = {
  maxScore: number;
  minScore: number;
  score: number;
};

export type LegacySessionScore = {
  competencies: Map<CompetencyKey, LegacyCompetencyTotal>;
  maxScore: number;
  hasForcedChoice: boolean;
  packageTest: LegacyPackageTestRecord;
  percentage: number | null;
  rawScore: number;
  requiresReview: boolean;
  scoringType: LegacyScoringType;
  session: LegacySessionRecord;
};

export type LegacyAnswerScore = {
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  rawScore: number | null;
};

const COMPETENCY_KEYS = new Set<CompetencyKey>(
  COMPETENCIES.map((competency) => competency.key),
);

function related<T>(value: LegacyRelation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function percentage(score: number, maxScore: number) {
  return maxScore > 0 ? round(Math.min(Math.max((score / maxScore) * 100, 0), 100)) : null;
}

function isCompetencyKey(value: string): value is CompetencyKey {
  return COMPETENCY_KEYS.has(value as CompetencyKey);
}

function addCompetency(
  competencies: Map<CompetencyKey, LegacyCompetencyTotal>,
  key: CompetencyKey,
  score: number,
  maxScore: number,
) {
  if (maxScore <= 0) return;
  const existing = competencies.get(key) ?? { maxScore: 0, minScore: 0, score: 0 };
  existing.score += Math.min(Math.max(score, 0), maxScore);
  existing.maxScore += maxScore;
  competencies.set(key, existing);
}

function addCompetencyRange(
  competencies: Map<CompetencyKey, LegacyCompetencyTotal>,
  key: CompetencyKey,
  score: number,
  minScore: number,
  maxScore: number,
) {
  if (maxScore <= minScore) return;
  const existing = competencies.get(key) ?? { maxScore: 0, minScore: 0, score: 0 };
  existing.score += Math.min(Math.max(score, minScore), maxScore);
  existing.minScore += minScore;
  existing.maxScore += maxScore;
  competencies.set(key, existing);
}

function getStoredMultipleChoiceScore(
  question: LegacyQuestionRecord,
  answer: LegacyAnswerRecord | undefined,
  options: LegacyOptionRecord[],
): {
  definition: NormalizedMultipleChoiceDefinition;
  score: MultipleChoiceScoreResult | null;
  skipped: boolean;
} {
  const definitionValidation = validateMultipleChoiceDefinition({
    competencyKey: question.competency_key,
    maxPoints: numberValue(question.points),
    options: options.map((option) => ({
      competencyEffects: option.competency_effect_json,
      id: option.id,
      isCorrect: option.is_correct,
      points: numberValue(option.points),
    })),
    required: question.settings_json?.required ?? true,
    settings: question.settings_json,
  });
  if (!definitionValidation.ok) {
    throw new Error(
      `Invalid published multiple_choice definition for question ${question.id}: ${definitionValidation.errors.join("; ")}`,
    );
  }

  if (!answer) {
    return { definition: definitionValidation.definition, score: null, skipped: false };
  }

  const answerValidation = validateMultipleChoiceAnswer(
    answer.answer_json,
    options.map((option) => option.id),
    {
      maxSelections: definitionValidation.definition.maxSelections,
      minSelections: definitionValidation.definition.minSelections,
      required: definitionValidation.definition.required,
    },
    { rejectDuplicates: true, requireUuid: true },
  );
  if (!answerValidation.ok) {
    throw new Error(
      `Invalid stored multiple_choice answer for question ${question.id}: ${answerValidation.error}`,
    );
  }
  if ("skipped" in answerValidation.answer) {
    return { definition: definitionValidation.definition, score: null, skipped: true };
  }

  return {
    definition: definitionValidation.definition,
    score: scoreMultipleChoiceQuestion({
      definition: definitionValidation.definition,
      selectedOptionIds: answerValidation.answer.selectedOptionIds,
    }),
    skipped: false,
  };
}

/**
 * Frozen legacy scorer used whenever a test version has no v2 schema marker.
 * Keep its arithmetic stable so historical v1 definitions remain reproducible.
 */
export function scoreLegacySession(
  session: LegacySessionRecord,
  packageTest: LegacyPackageTestRecord,
  questions: LegacyQuestionRecord[],
  answers: LegacyAnswerRecord[],
) {
  const version = related(session.test_versions);
  if (!version) {
    throw new Error("Unable to determine test scoring type.");
  }

  const answersByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const remediationParentByTarget = new Map<string, string>();
  for (const question of questions) {
    const remediationQuestionId = question.settings_json?.remediationQuestionId;
    if (typeof remediationQuestionId === "string") {
      remediationParentByTarget.set(remediationQuestionId, question.id);
    }
  }
  const competencies = new Map<CompetencyKey, LegacyCompetencyTotal>();
  const answerScores = new Map<string, LegacyAnswerScore>();
  let rawScore = 0;
  let maxScore = 0;
  let hasForcedChoice = false;
  let requiresReview = version.scoring_type === "manual";

  for (const question of questions) {
    const remediationParentId = remediationParentByTarget.get(question.id);
    if (remediationParentId) {
      const parent = questionsById.get(remediationParentId);
      const parentAnswer = answersByQuestion.get(remediationParentId);
      const parentOptions = parent?.answer_options ?? [];
      const selectedParentOption = parentOptions.find(
        (option) => option.id === parentAnswer?.selected_option_id,
      );
      const multipleChoiceParentIsIncorrect =
        parent?.question_type === "multiple_choice" &&
        isMultipleChoiceV1(parent.settings_json) &&
        getStoredMultipleChoiceScore(parent, parentAnswer, parentOptions).score?.isCorrect === false;
      if (selectedParentOption?.is_correct !== false && !multipleChoiceParentIsIncorrect) {
        const inactiveAnswer = answersByQuestion.get(question.id);
        if (inactiveAnswer) {
          answerScores.set(inactiveAnswer.id, {
            isCorrect: null,
            pointsAwarded: null,
            rawScore: null,
          });
        }
        continue;
      }
    }

    const answer = answersByQuestion.get(question.id);
    const options = question.answer_options ?? [];

    if (question.question_type === "forced_choice") {
      hasForcedChoice = true;
      const answerValidation = validateForcedChoiceAnswer(
        {
          leastOptionId: answer?.answer_json?.leastOptionId,
          mostOptionId: answer?.answer_json?.mostOptionId,
        },
        options.map((option) => option.id),
        question.settings_json?.mode,
      );
      const forcedChoiceScores = scoreForcedChoiceQuestion(
        options.map((option) => ({
          competencyEffects: option.competency_effect_json,
          id: option.id,
        })),
        answerValidation.ok ? answerValidation.answer : null,
      );

      for (const [key, score] of Object.entries(forcedChoiceScores)) {
        if (isCompetencyKey(key)) {
          addCompetencyRange(
            competencies,
            key,
            score.rawScore,
            score.minPossible,
            score.maxPossible,
          );
        }
      }
      if (answer) {
        answerScores.set(answer.id, { isCorrect: null, pointsAwarded: null, rawScore: null });
      }
      continue;
    }

    if (question.question_type === "multiple_choice") {
      if (!isMultipleChoiceV1(question.settings_json)) {
        requiresReview = true;
        if (answer) {
          answerScores.set(answer.id, {
            isCorrect: null,
            pointsAwarded: null,
            rawScore: null,
          });
        }
        continue;
      }

      const multipleChoice = getStoredMultipleChoiceScore(question, answer, options);
      maxScore += multipleChoice.definition.maxPoints;
      const pointsAwarded = multipleChoice.score?.pointsAwarded ?? 0;
      rawScore += pointsAwarded;

      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: multipleChoice.skipped ? null : (multipleChoice.score?.isCorrect ?? null),
          pointsAwarded: multipleChoice.skipped ? 0 : pointsAwarded,
          rawScore: multipleChoice.skipped ? 0 : (multipleChoice.score?.rawScore ?? 0),
        });
      }

      const effectKeys = new Set(
        options.flatMap((option) => Object.keys(option.competency_effect_json ?? {})),
      );
      if (effectKeys.size > 0) {
        const selectedIds = new Set(multipleChoice.score?.selectedOptionIds ?? []);
        for (const key of effectKeys) {
          if (!isCompetencyKey(key)) continue;
          const selectedEffect = options
            .filter((option) => selectedIds.has(option.id))
            .reduce(
              (sum, option) => sum + numberValue(option.competency_effect_json?.[key]),
              0,
            );
          const effectMax = options
            .map((option) => numberValue(option.competency_effect_json?.[key]))
            .filter((value) => value > 0)
            .sort((left, right) => right - left)
            .slice(0, multipleChoice.definition.maxSelections)
            .reduce((sum, value) => sum + value, 0);
          addCompetency(competencies, key, selectedEffect, effectMax);
        }
      } else if (question.competency_key) {
        addCompetency(
          competencies,
          question.competency_key,
          pointsAwarded,
          multipleChoice.definition.maxPoints,
        );
      }
      continue;
    }

    if (question.question_type === "single_choice") {
      const selectedOption = options.find((option) => option.id === answer?.selected_option_id);
      const questionMax = Math.max(
        numberValue(question.points),
        ...options.map((option) => numberValue(option.points)),
        0,
      );
      const pointsAwarded = selectedOption ? numberValue(selectedOption.points) : 0;

      rawScore += pointsAwarded;
      maxScore += questionMax;

      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: selectedOption?.is_correct ?? null,
          pointsAwarded: round(pointsAwarded),
          rawScore: round(pointsAwarded),
        });
      }

      const effectKeys = new Set(
        options.flatMap((option) => Object.keys(option.competency_effect_json ?? {})),
      );
      if (effectKeys.size > 0) {
        for (const key of effectKeys) {
          if (!isCompetencyKey(key)) continue;
          const effectMax = Math.max(
            ...options.map((option) => numberValue(option.competency_effect_json?.[key])),
            0,
          );
          const selectedEffect = numberValue(selectedOption?.competency_effect_json?.[key]);
          addCompetency(competencies, key, selectedEffect, effectMax);
        }
      } else if (question.competency_key) {
        addCompetency(competencies, question.competency_key, pointsAwarded, questionMax);
      }
      continue;
    }

    if (question.question_type === "scale") {
      const minimum = numberValue(question.settings_json?.min, 1);
      const maximum = numberValue(question.settings_json?.max, 5);
      const answerValue =
        typeof answer?.answer_json?.value === "number" && Number.isFinite(answer.answer_json.value)
          ? answer.answer_json.value
          : null;
      const boundedValue =
        answerValue === null ? 0 : Math.min(Math.max(answerValue, minimum), maximum);

      rawScore += boundedValue;
      maxScore += maximum;

      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: null,
          pointsAwarded: round(boundedValue),
          rawScore: round(boundedValue),
        });
      }

      if (question.competency_key) {
        addCompetency(competencies, question.competency_key, boundedValue, maximum);
      }
      continue;
    }

    if (question.question_type === "ordering" && isStructuredQuestion(question.settings_json)) {
      const canonicalOptions = options
        .slice()
        .sort((left, right) => left.order_index - right.order_index);
      const validation = validateOrderingAnswer(
        { orderedOptionIds: answer?.answer_json?.orderedOptionIds },
        canonicalOptions.map((option) => option.id),
      );
      const accuracy = scoreOrderingAnswer(
        canonicalOptions.map((option) => option.id),
        validation.ok ? validation.answer : null,
        normalizeOrderingScoringMode(question.settings_json?.orderingScoringMode),
      );
      const questionMax = Math.max(numberValue(question.points), 0);
      const pointsAwarded = questionMax * accuracy;
      rawScore += pointsAwarded;
      maxScore += questionMax;
      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: validation.ok ? accuracy === 1 : null,
          pointsAwarded: round(pointsAwarded),
          rawScore: round(pointsAwarded),
        });
      }
      if (question.competency_key) {
        addCompetency(competencies, question.competency_key, pointsAwarded, questionMax);
      }
      continue;
    }

    if (question.question_type === "matching" && isStructuredQuestion(question.settings_json)) {
      const matchingOptions = options.map((option) => ({
        id: option.id,
        matchTargetId: option.match_target_id,
      }));
      const validation = validateMatchingAnswer(
        { matches: answer?.answer_json?.matches },
        matchingOptions,
      );
      const accuracy = scoreMatchingAnswer(
        matchingOptions,
        validation.ok ? validation.answer : null,
        normalizeMatchingScoringMode(question.settings_json?.matchingScoringMode),
      );
      const questionMax = Math.max(numberValue(question.points), 0);
      const pointsAwarded = questionMax * accuracy;
      rawScore += pointsAwarded;
      maxScore += questionMax;
      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: validation.ok ? accuracy === 1 : null,
          pointsAwarded: round(pointsAwarded),
          rawScore: round(pointsAwarded),
        });
      }
      if (question.competency_key) {
        addCompetency(competencies, question.competency_key, pointsAwarded, questionMax);
      }
      continue;
    }

    // Unsupported and free-text responses must be reviewed before they influence a decision.
    requiresReview = true;
    if (answer) {
      answerScores.set(answer.id, { isCorrect: null, pointsAwarded: null, rawScore: null });
    }
  }

  return {
    answerScores,
    score: {
      competencies,
      hasForcedChoice,
      maxScore: round(maxScore),
      packageTest,
      percentage: percentage(rawScore, maxScore),
      rawScore: round(rawScore),
      requiresReview,
      scoringType: version.scoring_type,
      session,
    } satisfies LegacySessionScore,
  };
}
