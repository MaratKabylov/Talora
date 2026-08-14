export const TEST_PRESENTATION_MODES = ["section", "one_question"] as const;

export type TestPresentationMode = (typeof TEST_PRESENTATION_MODES)[number];

export type TestPresentationSettings = {
  allowBack: boolean;
  captureQuestionTime: boolean;
  presentationMode: TestPresentationMode;
};

export const DEFAULT_TEST_PRESENTATION_SETTINGS: TestPresentationSettings = {
  allowBack: true,
  captureQuestionTime: false,
  presentationMode: "section",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePresentationSettings(value: unknown): TestPresentationSettings {
  if (!isRecord(value)) {
    return { ...DEFAULT_TEST_PRESENTATION_SETTINGS };
  }

  return {
    allowBack:
      typeof value.allowBack === "boolean"
        ? value.allowBack
        : DEFAULT_TEST_PRESENTATION_SETTINGS.allowBack,
    captureQuestionTime:
      typeof value.captureQuestionTime === "boolean"
        ? value.captureQuestionTime
        : DEFAULT_TEST_PRESENTATION_SETTINGS.captureQuestionTime,
    presentationMode:
      value.presentationMode === "one_question" || value.presentationMode === "section"
        ? value.presentationMode
        : DEFAULT_TEST_PRESENTATION_SETTINGS.presentationMode,
  };
}

export function mergePresentationSettings(
  currentValue: unknown,
  presentationSettings: TestPresentationSettings,
): Record<string, unknown> {
  return {
    ...(isRecord(currentValue) ? currentValue : {}),
    allowBack: presentationSettings.allowBack,
    captureQuestionTime: presentationSettings.captureQuestionTime,
    presentationMode: presentationSettings.presentationMode,
  };
}
