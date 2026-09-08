import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as document from "../components/tests/builder/builder-document.ts";
import type { BuilderSection } from "../lib/tests/builder-data.ts";

function actions(initial: BuilderSection[]) {
  const source = readFileSync(new URL("../components/tests/builder/use-builder-actions.ts", import.meta.url), "utf8");
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const exports = {} as typeof import("../components/tests/builder/use-builder-actions.ts");
  compileFunction(outputText, ["exports", "require"])(exports, (name: string) => {
    if (name === "react") return { useMemo: (factory: () => unknown) => factory() };
    assert.equal(name, "./builder-document"); return document;
  });
  let sections = initial;
  const methods = exports.useBuilderActions(update => { sections = update(sections); });
  return { ...methods, sections: () => sections };
}
function fixture() {
  const first = document.section("A"); first.questions.push(document.question(), document.question());
  first.questions[0].remediationQuestionId = first.questions[2].id;
  first.questions[0].incorrectFeedback = "Retry";
  first.contentBlocks.push(document.contentBlock(2));
  const second = document.section("B"); return [first, second];
}

test("builder patches retain identity of unrelated sections/questions/options for memo boundaries", () => {
  const initial = fixture(); const h = actions(initial); const first = initial[0].questions[0];
  h.patchOption(initial[0].id, first.id, first.options[0].id, { text: "Changed" });
  const next = h.sections();
  assert.notEqual(next, initial); assert.equal(next[1], initial[1]);
  assert.equal(next[0].contentBlocks, initial[0].contentBlocks);
  assert.equal(next[0].questions[1], initial[0].questions[1]);
  assert.equal(next[0].questions[0].options[1], first.options[1]);
  assert.equal(first.options[0].text, "Вариант 1");
  assert.equal(next[0].questions[0].options[0].text, "Changed");
  h.patchSection(initial[0].id, { title: "New title" });
  assert.equal(h.sections()[0].questions, next[0].questions);
  h.patchQuestion(initial[0].id, first.id, current => ({ options: current.options.slice(1) }));
  assert.equal(h.sections()[0].questions[0].options[0].id, first.options[1].id);
});

test("builder option movement uses the latest document, preserves IDs and does not mutate original", () => {
  const initial = fixture(); const h = actions(initial); const q = initial[0].questions[0];
  h.patchOption(initial[0].id, q.id, q.options[0].id, { text: "Latest" });
  h.moveOption(initial[0].id, q.id, q.options[0].id, 1);
  assert.equal(h.sections()[0].questions[0].options[1].text, "Latest");
  assert.equal(h.sections()[0].questions[0].options[1].id, q.options[0].id);
  assert.equal(h.sections()[1], initial[1]);
  assert.equal(q.options[0].text, "Вариант 1");
});

test("builder same-section movement clears only invalid backward remediation links", () => {
  const initial = fixture(); const h = actions(initial); const first = initial[0];
  h.moveQuestion({ sectionId: first.id, questionId: first.questions[2].id }, first.id, 0);
  assert.deepEqual(h.sections()[0].questions.map(q => q.id), [first.questions[2].id, first.questions[0].id, first.questions[1].id]);
  assert.equal(h.sections()[0].questions[1].remediationQuestionId, null);
  assert.equal(h.sections()[0].questions[1].incorrectFeedback, null);
  assert.equal(h.sections()[1], initial[1]);
  assert.equal(first.questions[0].remediationQuestionId, first.questions[2].id);
});

test("builder cross-section move preserves content and clears links crossing section boundaries", () => {
  const initial = fixture(); const h = actions(initial); const [first, second] = initial;
  h.moveQuestion({ sectionId: first.id, questionId: first.questions[2].id }, second.id, 1);
  assert.equal(h.sections()[0].questions.length, 2);
  assert.equal(h.sections()[0].questions[0].remediationQuestionId, null);
  assert.equal(h.sections()[1].questions[1].id, first.questions[2].id);
  assert.deepEqual(h.sections()[1].questions[1].options, first.questions[2].options);
  assert.equal(h.sections()[1].questions[1].remediationQuestionId, null);
});

test("builder invalid/no-op question drops do not create a new document", () => {
  const initial = fixture(); const h = actions(initial); const first = initial[0];
  h.moveQuestion({ sectionId: first.id, questionId: first.questions[0].id }, first.id, 0);
  assert.equal(h.sections(), initial);
  h.moveQuestion({ sectionId: first.id, questionId: first.questions[0].id }, first.id, 1);
  assert.equal(h.sections(), initial);
  h.moveQuestion({ sectionId: first.id, questionId: "missing" }, first.id, 0);
  assert.equal(h.sections(), initial);
});

test("builder insertion and content-block patches preserve positioning and unchanged nodes", () => {
  const initial = fixture(); const h = actions(initial); const first = initial[0];
  h.addQuestionAfter(first.id, first.questions[0].id);
  assert.equal(h.sections()[0].questions[1].text, "Повторный вопрос");
  assert.equal(h.sections()[0].contentBlocks[0].positionIndex, 3);
  const questions = h.sections()[0].questions;
  h.patchContentBlock(first.id, first.contentBlocks[0].id, { title: "Instructions" });
  assert.equal(h.sections()[0].questions, questions);
  assert.equal(h.sections()[1], initial[1]);
});

test("builder copies preserve scoring/settings while remapping IDs and remediation", () => {
  const [source] = fixture(); const copy = document.copySection(source);
  assert.notEqual(copy.id, source.id); assert.notEqual(copy.contentBlocks[0].id, source.contentBlocks[0].id);
  assert.equal(copy.questions[0].remediationQuestionId, copy.questions[2].id);
  assert.equal(copy.questions[0].incorrectFeedback, "Retry");
  assert.notEqual(copy.questions[0].options[0].id, source.questions[0].options[0].id);
  const questionCopy = document.copyQuestion(source.questions[0]);
  assert.equal(questionCopy.remediationQuestionId, null); assert.equal(questionCopy.incorrectFeedback, null);
  assert.equal(source.questions[0].incorrectFeedback, "Retry");
});

test("builder question presets retain legacy defaults for all supported formats", () => {
  for (const type of ["single_choice", "multiple_choice", "scale", "open_text", "ordering", "matching", "forced_choice"] as const) {
    const q = document.question(type);
    assert.equal(q.questionType, type); assert.equal(q.isRequired, true);
    assert.equal(q.isStructured, ["ordering", "matching"].includes(type));
    assert.equal(q.options.length, type === "forced_choice" ? 3 : ["scale", "open_text"].includes(type) ? 0 : 2);
    if (type === "matching") assert.ok(q.options.every(o => o.matchText));
    if (type === "forced_choice") assert.equal(q.points, 0);
  }
});
