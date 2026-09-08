import type { BuilderDocumentInput } from "./builder-document-schema";
import { builderFingerprint } from "./builder-delta";
import type { SectionRecord } from "./builder-data";

export function builderStorageRows(document: BuilderDocumentInput) {
  return {
    version: { title: document.version.title, description: document.version.description,
      instructions: document.version.instructions, duration_minutes: document.version.durationMinutes,
      scoring_type: document.version.scoringType, settings_json: document.version.presentationSettings },
    sections: document.sections.map((s, i) => ({ id: s.id, title: s.title, description: s.description,
      order_index: i + 1, time_limit_minutes: s.timeLimitMinutes, settings_json: { contentBlocks: s.contentBlocks } })),
    questions: document.sections.flatMap(s => s.questions.map((q, i) => ({ id: q.id, section_id: s.id,
      question_type: q.questionType, text: q.text, description: q.description, order_index: i + 1,
      points: q.questionType === "forced_choice" ? 0 : q.points,
      competency_key: q.questionType === "forced_choice" ? null : q.competencyKey, difficulty: q.difficulty,
      settings_json: {
        ...(q.questionType === "scale" ? { min: q.scaleMin, max: q.scaleMax } : {}),
        ...(q.questionType === "forced_choice" ? { mode: "most_least" } : {}),
        ...(["single_choice", "multiple_choice"].includes(q.questionType) ? { shuffleOptions: q.shuffleOptions } : {}),
        ...(q.isStructured && q.questionType === "ordering" ? { orderingScoringMode: q.orderingScoringMode, structuredResponseVersion: 1 } : {}),
        ...(q.isStructured && q.questionType === "matching" ? { matchingScoringMode: q.matchingScoringMode, structuredResponseVersion: 1 } : {}),
        ...(q.remediationQuestionId ? { remediationQuestionId: q.remediationQuestionId, incorrectFeedback: q.incorrectFeedback?.trim() } : {}),
        required: q.isRequired,
      },
    }))),
    options: document.sections.flatMap(s => s.questions.flatMap(q => q.options.map((o, i) => {
      const structured = q.isStructured && ["ordering", "matching"].includes(q.questionType);
      const neutral = structured || q.questionType === "forced_choice";
      return { id: o.id, question_id: q.id, text: o.text, order_index: i + 1,
        points: neutral ? 0 : o.points, is_correct: neutral ? null : o.isCorrect,
        competency_effect_json: structured ? {} : o.competencyEffects, explanation: structured ? null : o.explanation,
        match_text: q.isStructured && q.questionType === "matching" ? o.matchText : null };
    }))),
  };
}
export function buildStorageDelta(before: BuilderDocumentInput, after: BuilderDocumentInput, stored?: SectionRecord[]) {
  const old = builderStorageRows(before), next = builderStorageRows(after);
  if (stored) {
    // Legacy indexes may start at zero, contain gaps or ties. A text edit must
    // preserve them; only an actual sibling-order change assigns new ordinals.
    const sectionOrders = new Map(stored.map(s => [s.id, s.order_index]));
    const questionOrders = new Map(stored.flatMap(s => (s.questions ?? []).map(q => [q.id, q.order_index] as const)));
    const optionOrders = new Map(stored.flatMap(s => (s.questions ?? []).flatMap(q =>
      (q.answer_options ?? []).map(o => [o.id, o.order_index] as const))));
    function preserveOrder<T extends { id: string; order_index: number }>(a: T[], b: T[], orders: Map<string, number>, parent: (r: T) => string) {
      const groups = (rows: T[]) => {
        const result = new Map<string, string[]>();
        for (const row of rows) { const key = parent(row), ids = result.get(key) ?? []; ids.push(row.id); result.set(key, ids); }
        return result;
      };
      const oldGroups = groups(a), newGroups = groups(b);
      for (const row of a) row.order_index = orders.get(row.id) ?? row.order_index;
      for (const row of b) if (builderFingerprint(oldGroups.get(parent(row))) === builderFingerprint(newGroups.get(parent(row)))) {
        row.order_index = orders.get(row.id) ?? row.order_index;
      }
    }
    preserveOrder(old.sections, next.sections, sectionOrders, () => "version");
    preserveOrder(old.questions, next.questions, questionOrders, q => q.section_id);
    preserveOrder(old.options, next.options, optionOrders, o => o.question_id);
  }
  function changes<T extends { id: string }>(a: T[], b: T[]) {
    const map = new Map(a.map(r => [r.id, builderFingerprint(r)]));
    return b.filter(r => map.get(r.id) !== builderFingerprint(r));
  }
  const removed = (a: { id: string }[], b: { id: string }[]) => {
    const ids = new Set(b.map(r => r.id)); return a.filter(r => !ids.has(r.id)).map(r => r.id);
  };
  return { version: builderFingerprint(old.version) === builderFingerprint(next.version) ? null : next.version,
    sections: changes(old.sections, next.sections), questions: changes(old.questions, next.questions), options: changes(old.options, next.options),
    deletedSections: removed(old.sections, next.sections), deletedQuestions: removed(old.questions, next.questions), deletedOptions: removed(old.options, next.options) };
}
