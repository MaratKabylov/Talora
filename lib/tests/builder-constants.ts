export const QUESTION_TYPE_VALUES = [
  "single_choice",
  "multiple_choice",
  "scale",
  "open_text",
  "ordering",
  "matching",
] as const;

export const QUESTION_TYPE_LABELS: Record<(typeof QUESTION_TYPE_VALUES)[number], string> = {
  single_choice: "Один вариант",
  multiple_choice: "Несколько вариантов",
  scale: "Шкала",
  open_text: "Открытый ответ",
  ordering: "Сортировка",
  matching: "Сопоставление",
};

export const DIFFICULTY_VALUES = ["easy", "medium", "hard"] as const;

export const DIFFICULTY_LABELS: Record<(typeof DIFFICULTY_VALUES)[number], string> = {
  easy: "Легкий",
  medium: "Средний",
  hard: "Сложный",
};

export const TEST_COMPETENCIES = [
  { key: "learning_ability", label: "Обучаемость" },
  { key: "attention_to_detail", label: "Внимательность" },
  { key: "logical_reasoning", label: "Логика" },
  { key: "work_behavior", label: "Рабочее поведение" },
  { key: "communication", label: "Коммуникация" },
  { key: "responsibility", label: "Ответственность" },
  { key: "motivation_income", label: "Мотивация: доход" },
  { key: "motivation_growth", label: "Мотивация: рост" },
  { key: "motivation_stability", label: "Мотивация: стабильность" },
  { key: "motivation_autonomy", label: "Мотивация: самостоятельность" },
  { key: "motivation_structure", label: "Мотивация: структура" },
  { key: "motivation_recognition", label: "Мотивация: признание" },
] as const;

export type QuestionType = (typeof QUESTION_TYPE_VALUES)[number];
export type QuestionDifficulty = (typeof DIFFICULTY_VALUES)[number];
export type TestCompetencyKey = (typeof TEST_COMPETENCIES)[number]["key"];

export const TEST_COMPETENCY_LABELS = Object.fromEntries(
  TEST_COMPETENCIES.map((competency) => [competency.key, competency.label]),
) as Record<TestCompetencyKey, string>;
