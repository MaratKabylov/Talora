import type { BuilderDocumentInput } from "./builder-document-schema";
import type { BuilderSection } from "./builder-data";
import type { TestVersion } from "./data";
export type BuilderVersionFields = { description: string; durationMinutes: string; instructions: string;
  presentationSettings: TestVersion["presentationSettings"]; scoringType: TestVersion["scoringType"] };
const nullableText = (value: string) => value.trim() || null;
export function serializeBuilderDocument(currentSections: BuilderSection[], currentVersion: BuilderVersionFields,
  templateId: string, versionId: string, versionTitle: string): BuilderDocumentInput {
  return {
      sections: currentSections.map((currentSection) => ({
        contentBlocks: currentSection.contentBlocks.map((block, orderIndex) => ({
          ...block,
          title: block.title.trim(),
          description: nullableText(block.description ?? ""),
          orderIndex: orderIndex + 1,
          positionIndex: Math.min(
            Math.max(block.positionIndex, 0),
            currentSection.questions.length,
          ),
        })),
        description: nullableText(currentSection.description ?? ""),
        id: currentSection.id,
        questions: currentSection.questions.map((currentQuestion) => ({
          competencyKey: currentQuestion.competencyKey,
          description: nullableText(currentQuestion.description ?? ""),
          difficulty: currentQuestion.difficulty,
          id: currentQuestion.id,
          incorrectFeedback: nullableText(currentQuestion.incorrectFeedback ?? ""),
          isRequired: currentQuestion.isRequired,
          isStructured: currentQuestion.isStructured,
          options: currentQuestion.options.map((currentOption) => ({
            competencyEffects: currentOption.competencyEffects,
            explanation: nullableText(currentOption.explanation ?? ""),
            id: currentOption.id,
            isCorrect: Boolean(currentOption.isCorrect),
            matchText: nullableText(currentOption.matchText ?? ""),
            points: Number(currentOption.points) || 0,
            text: currentOption.text.trim(),
          })),
          points: Number(currentQuestion.points) || 0,
          questionType: currentQuestion.questionType,
          matchingScoringMode: currentQuestion.matchingScoringMode,
          orderingScoringMode: currentQuestion.orderingScoringMode,
          remediationQuestionId: currentQuestion.remediationQuestionId,
          scaleMax: Number(currentQuestion.scaleMax) || 5,
          scaleMin: Number(currentQuestion.scaleMin) || 1,
          shuffleOptions: currentQuestion.shuffleOptions,
          text: currentQuestion.text.trim(),
        })),
        timeLimitMinutes: currentSection.timeLimitMinutes,
        title: currentSection.title.trim(),
      })),
      templateId,
      version: {
        description: nullableText(currentVersion.description),
        durationMinutes: currentVersion.durationMinutes ? Number(currentVersion.durationMinutes) : null,
        instructions: nullableText(currentVersion.instructions),
        presentationSettings: currentVersion.presentationSettings,
        scoringType: currentVersion.scoringType,
        title: versionTitle,
      },
      versionId: versionId,
    };
}
