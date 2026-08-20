export const QUESTION_TYPE_VALUES = [
  "single_choice",
  "multiple_choice",
  "scale",
  "open_text",
  "ordering",
  "matching",
  "forced_choice",
] as const;

export const QUESTION_TYPE_LABELS: Record<(typeof QUESTION_TYPE_VALUES)[number], string> = {
  single_choice: "Один вариант",
  multiple_choice: "Несколько вариантов",
  scale: "Шкала",
  open_text: "Открытый ответ",
  ordering: "Сортировка",
  matching: "Сопоставление",
  forced_choice: "Вынужденный выбор",
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
  { key: "work_organization", label: "Организованность" },
  { key: "work_initiative", label: "Инициативность" },
  { key: "work_result_orientation", label: "Ориентация на результат" },
  { key: "work_collaboration", label: "Сотрудничество" },
  { key: "work_adaptability", label: "Самоконтроль и адаптивность" },
  { key: "motivation_result", label: "Мотивация: результат" },
  { key: "motivation_growth", label: "Мотивация: развитие" },
  { key: "motivation_autonomy", label: "Мотивация: автономия" },
  { key: "motivation_influence", label: "Мотивация: влияние" },
  { key: "motivation_team", label: "Мотивация: команда" },
  { key: "motivation_stability", label: "Мотивация: стабильность" },
  { key: "motivation_income", label: "Мотивация: вознаграждение" },
  { key: "motivation_recognition", label: "Мотивация: признание" },
  { key: "motivation_meaning", label: "Мотивация: смысл" },
  { key: "motivation_structure", label: "Мотивация: структура" },
] as const;

export type QuestionType = (typeof QUESTION_TYPE_VALUES)[number];
export type QuestionDifficulty = (typeof DIFFICULTY_VALUES)[number];
export type TestCompetencyKey = (typeof TEST_COMPETENCIES)[number]["key"];

export const TEST_COMPETENCY_LABELS = Object.fromEntries(
  TEST_COMPETENCIES.map((competency) => [competency.key, competency.label]),
) as Record<TestCompetencyKey, string>;
