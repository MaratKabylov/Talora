import type { BuilderContentBlock, BuilderQuestion, BuilderSection } from "@/lib/tests/builder-data";
import type { QuestionType } from "@/lib/tests/builder-constants";

export const QUESTION_PRESETS: Array<{
  label: string;
  questionType: QuestionType;
  text: string;
}> = [
    { label: "Один выбор", questionType: "single_choice", text: "Выберите наиболее подходящий вариант." },
    { label: "Forced Choice", questionType: "forced_choice", text: "Выберите, что больше и меньше всего похоже на вас." },
    { label: "Шкала", questionType: "scale", text: "Оцените утверждение по шкале." },
    { label: "Развернутый ответ", questionType: "open_text", text: "Опишите ваш подход к ситуации." },
    { label: "Сортировка", questionType: "ordering", text: "Расположите элементы в правильном порядке." },
    { label: "Сопоставление", questionType: "matching", text: "Сопоставьте элементы из двух колонок." },
  ];

export function uuid() {
  return crypto.randomUUID();
}

export function option(text = "Вариант ответа") {
  return {
    competencyEffects: {},
    explanation: null,
    id: uuid(),
    isCorrect: false,
    matchText: null,
    orderIndex: 1,
    points: 0,
    text,
  };
}

export function question(questionType: QuestionType = "single_choice", text = "Новый вопрос"): BuilderQuestion {
  return {
    competencyKey: null,
    description: null,
    difficulty: null,
    id: uuid(),
    incorrectFeedback: null,
    isRequired: true,
    isStructured: questionType === "ordering" || questionType === "matching",
    matchingScoringMode: "per_pair",
    options:
      questionType === "forced_choice"
        ? [option("Утверждение 1"), option("Утверждение 2"), option("Утверждение 3")]
        : questionType === "single_choice" || questionType === "multiple_choice" || questionType === "ordering"
          ? [option("Вариант 1"), option("Вариант 2")]
          : questionType === "matching"
            ? [
              { ...option("Элемент 1"), matchText: "Соответствие 1" },
              { ...option("Элемент 2"), matchText: "Соответствие 2" },
            ]
            : [],
    orderIndex: 1,
    orderingScoringMode: "pairwise",
    points: questionType === "forced_choice" ? 0 : 1,
    questionType,
    remediationQuestionId: null,
    scaleMax: 5,
    scaleMin: 1,
    shuffleOptions: false,
    text,
  };
}

export function contentBlock(positionIndex: number): BuilderContentBlock {
  return {
    description: null,
    id: uuid(),
    orderIndex: 1,
    positionIndex,
    title: "Без названия",
  };
}

export function section(title = "Новая секция"): BuilderSection {
  return {
    contentBlocks: [],
    description: null,
    id: uuid(),
    orderIndex: 1,
    questions: [question()],
    timeLimitMinutes: null,
    title,
  };
}

export function copyQuestion(source: BuilderQuestion): BuilderQuestion {
  return {
    ...source,
    id: uuid(),
    incorrectFeedback: null,
    isRequired: source.isRequired ?? true,
    options: source.options.map((entry) => ({ ...entry, id: uuid(), isCorrect: Boolean(entry.isCorrect) })),
    remediationQuestionId: null,
  };
}

export function copySection(source: BuilderSection): BuilderSection {
  const questionIds = new Map(source.questions.map((entry) => [entry.id, uuid()]));
  return {
    ...source,
    contentBlocks: source.contentBlocks.map((block) => ({ ...block, id: uuid() })),
    id: uuid(),
    questions: source.questions.map((entry) => ({
      ...entry,
      id: questionIds.get(entry.id)!,
      options: entry.options.map((optionEntry) => ({
        ...optionEntry,
        id: uuid(),
        isCorrect: Boolean(optionEntry.isCorrect),
      })),
      remediationQuestionId: entry.remediationQuestionId
        ? questionIds.get(entry.remediationQuestionId) ?? null
        : null,
    })),
  };
}

export function editableSections(sections: BuilderSection[]) {
  return sections.map((entry) => ({
    ...entry,
    contentBlocks: (entry.contentBlocks ?? []).map((block) => ({
      ...block,
      positionIndex: Math.min(Math.max(block.positionIndex, 0), entry.questions.length),
    })),
    questions: entry.questions.map((currentQuestion) => ({
      ...currentQuestion,
      incorrectFeedback: currentQuestion.incorrectFeedback ?? null,
      isRequired: currentQuestion.isRequired ?? true,
      options: currentQuestion.options.map((currentOption) => ({
        ...currentOption,
        isCorrect: Boolean(currentOption.isCorrect),
        matchText: nullableText(currentOption.matchText ?? ""),
      })),
      remediationQuestionId: currentQuestion.remediationQuestionId ?? null,
    })),
  }));
}

export function nullableText(text: string) {
  return text.trim() ? text : null;
}


export function normalizeRemediationQuestions(questions: BuilderQuestion[]) {
  const questionIndexes = new Map(
    questions.map((currentQuestion, index) => [currentQuestion.id, index]),
  );

  return questions.map((currentQuestion, index) => {
    const remediationIndex = currentQuestion.remediationQuestionId
      ? questionIndexes.get(currentQuestion.remediationQuestionId)
      : undefined;

    if (remediationIndex === undefined || remediationIndex <= index) {
      return currentQuestion.remediationQuestionId
        ? {
          ...currentQuestion,
          incorrectFeedback: null,
          remediationQuestionId: null,
        }
        : currentQuestion;
    }

    return currentQuestion;
  });
}
