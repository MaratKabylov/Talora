"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { scoreCompletedEmployeeAssessmentParticipant } from "@/lib/scoring/service";
import { validateForcedChoiceAnswer } from "@/lib/forced-choice";
import {
  validateMatchingAnswer,
  validateOrderingAnswer,
} from "@/lib/structured-questions";
import { evaluateRemediationBranches } from "@/lib/assessment/remediation";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  getEmployeeAssessmentByToken,
  getEmployeeAssessmentQuestionPageData,
  type ActiveEmployeeAssessment,
  type EmployeeFlowQuestion,
} from "./public-data";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const profileSchema = z.object({
  department: z.string().trim().max(120, "Название отдела слишком длинное.").nullable(),
  email: z.string().trim().email("Укажите корректный email.").max(255),
  fullName: z.string().trim().min(2, "Укажите имя и фамилию.").max(180),
  phone: z.string().trim().max(40, "Телефон слишком длинный.").nullable(),
  roleTitle: z.string().trim().max(160, "Название должности слишком длинное.").nullable(),
  token: z.string().regex(TOKEN_PATTERN),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function optionalFormString(formData: FormData, key: string) {
  const value = formString(formData, key).trim();
  return value || null;
}

function startPath(token: string) {
  return `/employee-assessment/${token}`;
}

function profilePath(token: string) {
  return `/employee-assessment/${token}/profile`;
}

function testPath(token: string, sessionId: string, section = 0) {
  return `/employee-assessment/${token}/test/${sessionId}?section=${section}`;
}

function redirectWithError(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}error=${encodeURIComponent(message)}`);
}

function getToken(formData: FormData) {
  const parsed = z.string().regex(TOKEN_PATTERN).safeParse(formString(formData, "token"));
  return parsed.success ? parsed.data : null;
}

async function requireActiveAssessment(token: string) {
  const assessment = await getEmployeeAssessmentByToken(token);

  if (assessment.availability === "completed") {
    redirect(`/employee-assessment/${token}/complete`);
  }

  if (assessment.availability !== "active") {
    redirectWithError(startPath(token), "Ссылка больше не доступна.");
  }

  return assessment;
}

function nextPendingSession(assessment: ActiveEmployeeAssessment, excludedSessionId?: string) {
  return assessment.sessions.find(
    (session) => session.id !== excludedSessionId && session.status !== "completed",
  );
}

async function startSession(token: string, assessment: ActiveEmployeeAssessment, sessionId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("employee_assessment_sessions")
    .update({ started_at: new Date().toISOString(), status: "in_progress" })
    .eq("participant_id", assessment.participantId)
    .eq("id", sessionId)
    .eq("status", "not_started");

  if (error) {
    redirectWithError(profilePath(token), "Не удалось начать тест.");
  }
}

async function finishSessionAndContinue(
  token: string,
  assessment: ActiveEmployeeAssessment,
  sessionId: string,
) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("employee_assessment_sessions")
    .update({ completed_at: now, status: "completed" })
    .eq("participant_id", assessment.participantId)
    .eq("id", sessionId)
    .eq("status", "in_progress");

  if (error) {
    redirectWithError(testPath(token, sessionId), "Не удалось завершить тест.");
  }

  const nextSession = nextPendingSession(assessment, sessionId);
  if (nextSession) {
    await startSession(token, assessment, nextSession.id);
    redirect(testPath(token, nextSession.id));
  }

  try {
    await scoreCompletedEmployeeAssessmentParticipant(assessment.participantId);
  } catch {
    redirectWithError(testPath(token, sessionId), "Не удалось рассчитать результат оценки.");
  }

  const [{ error: invitationError }, { error: participantError }] = await Promise.all([
    admin
      .from("employee_assessment_invitations")
      .update({ status: "completed" })
      .eq("id", assessment.invitationId)
      .eq("status", "started"),
    admin
      .from("employee_assessment_participants")
      .update({ completed_at: now, current_stage: "assessment_completed", status: "completed" })
      .eq("id", assessment.participantId)
      .eq("status", "in_progress"),
  ]);

  if (invitationError || participantError) {
    redirectWithError(testPath(token, sessionId), "Не удалось завершить оценку.");
  }

  redirect(`/employee-assessment/${token}/complete`);
}

export async function acceptEmployeeAssessmentConsentAction(formData: FormData) {
  const token = getToken(formData);

  if (!token) {
    redirect("/");
  }

  if (formData.get("consent") !== "accepted") {
    redirectWithError(
      startPath(token),
      "Для продолжения необходимо согласие на обработку данных.",
    );
  }

  const assessment = await requireActiveAssessment(token);
  const admin = createAdminClient();
  const { error } = await admin
    .from("employee_assessment_invitations")
    .update({
      consent_given_at: new Date().toISOString(),
      consent_version: "mvp_v1",
      status: assessment.invitationStatus === "sent" ? "opened" : assessment.invitationStatus,
    })
    .eq("id", assessment.invitationId);

  if (error) {
    redirectWithError(startPath(token), "Не удалось сохранить согласие.");
  }

  redirect(profilePath(token));
}

export async function submitEmployeeAssessmentProfileAction(formData: FormData) {
  const parsed = profileSchema.safeParse({
    department: optionalFormString(formData, "department"),
    email: formString(formData, "email"),
    fullName: formString(formData, "fullName"),
    phone: optionalFormString(formData, "phone"),
    roleTitle: optionalFormString(formData, "roleTitle"),
    token: formString(formData, "token"),
  });

  if (!parsed.success) {
    const token = getToken(formData);
    redirectWithError(token ? profilePath(token) : "/", parsed.error.issues[0].message);
  }

  const assessment = await requireActiveAssessment(parsed.data.token);
  if (!assessment.consentGivenAt) {
    redirectWithError(startPath(parsed.data.token), "Подтвердите согласие перед анкетой.");
  }

  if (assessment.tests.length === 0) {
    redirectWithError(profilePath(parsed.data.token), "Для оценки не настроены опубликованные тесты.");
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error: employeeError } = await admin
    .from("employees")
    .update({
      department: parsed.data.department,
      email: parsed.data.email.toLowerCase(),
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      profile_completed_at: now,
      role_title: parsed.data.roleTitle,
    })
    .eq("id", assessment.employee.id);

  if (employeeError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось сохранить анкету сотрудника.");
  }

  const { error: sessionError } = await admin.from("employee_assessment_sessions").upsert(
    assessment.tests.map((test) => ({
      employee_id: assessment.employee.id,
      participant_id: assessment.participantId,
      status: "not_started",
      test_version_id: test.versionId,
    })),
    { ignoreDuplicates: true, onConflict: "participant_id,test_version_id" },
  );

  if (sessionError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось подготовить тесты.");
  }

  const refreshed = await getEmployeeAssessmentByToken(parsed.data.token);
  if (refreshed.availability !== "active") {
    redirectWithError(startPath(parsed.data.token), "Ссылка больше не доступна.");
  }

  const firstSession = nextPendingSession(refreshed);
  if (!firstSession) {
    redirect(`/employee-assessment/${parsed.data.token}/complete`);
  }

  const [{ error: invitationError }, { error: participantError }] = await Promise.all([
    admin
      .from("employee_assessment_invitations")
      .update({ status: "started" })
      .eq("id", refreshed.invitationId)
      .in("status", ["sent", "opened", "started"]),
    admin
      .from("employee_assessment_participants")
      .update({ current_stage: "assessment", status: "in_progress" })
      .eq("id", refreshed.participantId)
      .in("status", ["invited", "in_progress"]),
  ]);

  if (invitationError || participantError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось начать оценку.");
  }

  await startSession(parsed.data.token, refreshed, firstSession.id);
  redirect(testPath(parsed.data.token, firstSession.id));
}

function buildAnswer(question: EmployeeFlowQuestion, formData: FormData, inputPrefix = "") {
  const field = (name: string) => `${inputPrefix}${name}`;

  if (question.questionType === "forced_choice") {
    const validation = validateForcedChoiceAnswer(
      {
        leastOptionId: formString(formData, field("leastOptionId")),
        mostOptionId: formString(formData, field("mostOptionId")),
      },
      question.options.map((option) => option.id),
      question.forcedChoiceMode,
    );
    return validation.ok
      ? { answer_json: validation.answer, answer_text: null, selected_option_id: null }
      : null;
  }

  if (question.questionType === "single_choice") {
    const optionId = formString(formData, field("optionId"));
    const option = question.options.find((entry) => entry.id === optionId);

    return option ? { answer_json: {}, answer_text: null, selected_option_id: option.id } : null;
  }

  if (question.questionType === "multiple_choice") {
    const optionIds = formData
      .getAll(field("optionIds"))
      .filter((value): value is string => typeof value === "string");
    const allowedIds = new Set(question.options.map((option) => option.id));

    if (optionIds.length === 0 || optionIds.some((id) => !allowedIds.has(id))) {
      return null;
    }

    return { answer_json: { selectedOptionIds: optionIds }, answer_text: null, selected_option_id: null };
  }

  if (question.questionType === "scale") {
    const scaleValueText = formString(formData, field("scaleValue"));
    const scaleValue = Number(scaleValueText);

    if (
      !scaleValueText ||
      !Number.isInteger(scaleValue) ||
      scaleValue < question.scaleMin ||
      scaleValue > question.scaleMax
    ) {
      return null;
    }

    return { answer_json: { value: scaleValue }, answer_text: String(scaleValue), selected_option_id: null };
  }

  if (question.questionType === "ordering" && question.isStructured) {
    const validation = validateOrderingAnswer(
      { orderedOptionIds: formData.getAll(field("orderedOptionIds")) },
      question.options.map((option) => option.id),
    );
    return validation.ok
      ? { answer_json: validation.answer, answer_text: null, selected_option_id: null }
      : null;
  }

  if (question.questionType === "matching" && question.isStructured) {
    const matches = question.options.flatMap((option) => {
      const targetId = formString(formData, field(`match_${option.id}`));
      return targetId ? [{ optionId: option.id, targetId }] : [];
    });
    const validation = validateMatchingAnswer(
      { matches },
      question.options.map((option, index) => ({
        id: option.id,
        matchTargetId: question.matchingTargets[index]?.id ?? null,
      })),
    );
    return validation.ok
      ? { answer_json: validation.answer, answer_text: null, selected_option_id: null }
      : null;
  }

  const answerText = formString(formData, field("answerText")).trim();
  if (!answerText || answerText.length > 4000) {
    return null;
  }

  return { answer_json: {}, answer_text: answerText, selected_option_id: null };
}

export async function saveEmployeeAssessmentSectionAction(formData: FormData) {
  const token = getToken(formData);
  const sessionId = z.string().uuid().safeParse(formString(formData, "sessionId"));
  const requestedSection = Number(formString(formData, "sectionIndex"));
  const direction = formString(formData, "direction") === "previous" ? "previous" : "next";
  if (!token || !sessionId.success || !Number.isInteger(requestedSection)) {
    redirect("/");
  }

  const data = await getEmployeeAssessmentQuestionPageData(token, sessionId.data);
  if (!data || data.assessment.availability !== "active" || data.session.status !== "in_progress") {
    redirectWithError(startPath(token), "Тест недоступен для прохождения.");
  }

  const sectionIndex = Math.min(Math.max(requestedSection, 0), Math.max(data.sections.length - 1, 0));
  const section = data.sections[sectionIndex];
  if (!section) {
    redirectWithError(testPath(token, sessionId.data), "Секция не найдена.");
  }

  for (const question of section.questions) {
    if (question.questionType !== "forced_choice" || question.remediationParentId) continue;
    const prefix = `q_${question.id}_`;
    const mostOptionId = formString(formData, `${prefix}mostOptionId`);
    const leastOptionId = formString(formData, `${prefix}leastOptionId`);
    if (!question.isRequired && !mostOptionId && !leastOptionId) continue;
    const validation = validateForcedChoiceAnswer(
      { leastOptionId, mostOptionId },
      question.options.map((option) => option.id),
      question.forcedChoiceMode,
    );
    if (!validation.ok) {
      redirectWithError(testPath(token, sessionId.data, sectionIndex), validation.error);
    }
  }

  const answers = section.questions.map((question) => ({
    answer: buildAnswer(question, formData, `q_${question.id}_`),
    question,
  }));
  const missingRequired = answers.find(
    ({ answer, question }) =>
      !question.remediationParentId && question.isRequired && !answer,
  );
  if (missingRequired) {
    const prefix = `q_${missingRequired.question.id}_`;
    const forcedChoiceValidation =
      missingRequired.question.questionType === "forced_choice"
        ? validateForcedChoiceAnswer(
            {
              leastOptionId: formString(formData, `${prefix}leastOptionId`),
              mostOptionId: formString(formData, `${prefix}mostOptionId`),
            },
            missingRequired.question.options.map((option) => option.id),
            missingRequired.question.forcedChoiceMode,
          )
        : null;
    redirectWithError(
      testPath(token, sessionId.data, sectionIndex),
      forcedChoiceValidation && !forcedChoiceValidation.ok
        ? forcedChoiceValidation.error
        : "Ответьте на обязательные вопросы текущей секции.",
    );
  }

  const admin = createAdminClient();
  const upserts = answers
    .filter((entry) => entry.answer)
    .map(({ answer, question }) => ({
      ...answer!,
      is_correct: null,
      points_awarded: null,
      question_id: question.id,
      session_id: sessionId.data,
    }));
  if (upserts.length > 0) {
    const { error } = await admin
      .from("employee_assessment_answers")
      .upsert(upserts, { onConflict: "session_id,question_id" });
    if (error) {
      redirectWithError(testPath(token, sessionId.data, sectionIndex), "Не удалось сохранить ответы.");
    }
  }

  const clearedOptionalIds = answers
    .filter(({ answer, question }) => !question.isRequired && !answer)
    .map(({ question }) => question.id);
  if (clearedOptionalIds.length > 0) {
    const { error } = await admin
      .from("employee_assessment_answers")
      .delete()
      .eq("session_id", sessionId.data)
      .in("question_id", clearedOptionalIds);
    if (error) {
      redirectWithError(testPath(token, sessionId.data, sectionIndex), "Не удалось обновить ответы.");
    }
  }

  const remediationDecisions = await evaluateRemediationBranches(
    admin,
    section.questions,
    answers.map(({ answer, question }) => ({
      questionId: question.id,
      selectedOptionId: answer?.selected_option_id ?? null,
    })),
  );
  const remediationUpdates = await Promise.all(
    remediationDecisions.map((decision) =>
      admin
        .from("employee_assessment_answers")
        .update({ is_correct: decision.isCorrect })
        .eq("session_id", sessionId.data)
        .eq("question_id", decision.parentQuestionId),
    ),
  );
  if (remediationUpdates.some((result) => result.error)) {
    redirectWithError(testPath(token, sessionId.data, sectionIndex), "Не удалось проверить ответ.");
  }

  const inactiveTargetIds = remediationDecisions
    .filter((decision) => decision.isCorrect !== false)
    .map((decision) => decision.targetQuestionId);
  if (inactiveTargetIds.length > 0) {
    const { error } = await admin
      .from("employee_assessment_answers")
      .delete()
      .eq("session_id", sessionId.data)
      .in("question_id", inactiveTargetIds);
    if (error) {
      redirectWithError(testPath(token, sessionId.data, sectionIndex), "Не удалось обновить повторный вопрос.");
    }
  }

  if (direction === "next") {
    const missingRemediation = remediationDecisions.find((decision) => {
      if (decision.isCorrect !== false) {
        return false;
      }
      const target = section.questions.find(
        (question) => question.id === decision.targetQuestionId,
      );
      return target && !answers.find(({ answer, question }) => question.id === target.id && answer);
    });
    if (missingRemediation) {
      redirect(testPath(token, sessionId.data, sectionIndex));
    }
  }

  if (direction === "previous") {
    redirect(testPath(token, sessionId.data, Math.max(sectionIndex - 1, 0)));
  }

  if (sectionIndex < data.sections.length - 1) {
    redirect(testPath(token, sessionId.data, sectionIndex + 1));
  }

  await finishSessionAndContinue(token, data.assessment, sessionId.data);
}

export async function completeEmptyEmployeeAssessmentSessionAction(formData: FormData) {
  const token = getToken(formData);
  const sessionId = z.string().uuid().safeParse(formString(formData, "sessionId"));

  if (!token || !sessionId.success) {
    redirect("/");
  }

  const data = await getEmployeeAssessmentQuestionPageData(token, sessionId.data);
  if (!data || data.questions.length !== 0 || data.session.status !== "in_progress") {
    redirectWithError(startPath(token), "Тест недоступен.");
  }

  await finishSessionAndContinue(token, data.assessment, sessionId.data);
}
