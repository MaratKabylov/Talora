"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  completeCandidateSessionAndGetPath,
  startCandidateSession,
} from "./completion";
import {
  getAssessmentByToken,
  getAssessmentQuestionPageData,
  type ActiveAssessment,
  type FlowQuestion,
} from "./data";
import { guardCandidateSessionSubmission } from "./session-control";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const profileSchema = z.object({
  city: z.string().trim().max(120, "Название города слишком длинное.").nullable(),
  email: z.string().trim().email("Укажите корректный email.").max(255),
  fullName: z.string().trim().min(2, "Укажите имя и фамилию.").max(180),
  phone: z.string().trim().max(40, "Телефон слишком длинный.").nullable(),
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
  return `/assessment/${token}`;
}

function profilePath(token: string) {
  return `/assessment/${token}/profile`;
}

function testPath(token: string, sessionId: string, section = 0) {
  return `/assessment/${token}/test/${sessionId}?section=${section}`;
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
  const assessment = await getAssessmentByToken(token);

  if (assessment.availability === "completed") {
    redirect(`/assessment/${token}/complete`);
  }

  if (assessment.availability !== "active") {
    redirectWithError(startPath(token), "Ссылка больше не доступна.");
  }

  return assessment;
}

function nextPendingSession(assessment: ActiveAssessment, excludedSessionId?: string) {
  return assessment.sessions.find(
    (session) => session.id !== excludedSessionId && session.status !== "completed",
  );
}

async function startSession(token: string, assessment: ActiveAssessment, sessionId: string) {
  try {
    await startCandidateSession(assessment, sessionId);
  } catch {
    redirectWithError(profilePath(token), "Не удалось начать тест.");
  }
}

async function finishSessionAndContinue(
  token: string,
  assessment: ActiveAssessment,
  sessionId: string,
) {
  let redirectTo: string;
  try {
    redirectTo = await completeCandidateSessionAndGetPath(
      token,
      assessment,
      sessionId,
      "candidate",
    );
  } catch {
    redirectWithError(testPath(token, sessionId), "Не удалось завершить оценку.");
  }
  redirect(redirectTo);
}

async function requireOwnedSession(formData: FormData, token: string, sessionId: string) {
  const clientId = z.string().uuid().safeParse(formString(formData, "clientId"));
  const deviceId = z.string().uuid().safeParse(formString(formData, "deviceId"));
  if (!clientId.success || !deviceId.success) {
    redirectWithError(testPath(token, sessionId), "Не удалось подтвердить активную вкладку теста.");
  }

  const control = await guardCandidateSessionSubmission({
    clientId: clientId.data,
    deviceId: deviceId.data,
    sessionId,
    token,
  });

  if (control.status === "redirect") {
    redirect(control.redirectTo);
  }
  if (control.status === "blocked") {
    redirectWithError(
      testPath(token, sessionId),
      "Тест уже открыт в другой вкладке или на другом устройстве.",
    );
  }
}

export async function acceptAssessmentConsentAction(formData: FormData) {
  const token = getToken(formData);

  if (!token) {
    redirect("/");
  }

  if (formData.get("consent") !== "accepted") {
    redirectWithError(startPath(token), "Для продолжения необходимо согласие на обработку данных.");
  }

  const assessment = await requireActiveAssessment(token);
  const admin = createAdminClient();
  const { error } = await admin
    .from("invitations")
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

export async function submitCandidateProfileAction(formData: FormData) {
  const parsed = profileSchema.safeParse({
    city: optionalFormString(formData, "city"),
    email: formString(formData, "email"),
    fullName: formString(formData, "fullName"),
    phone: optionalFormString(formData, "phone"),
    token: formString(formData, "token"),
  });

  if (!parsed.success) {
    const token = getToken(formData);
    redirectWithError(token ? profilePath(token) : "/", parsed.error.issues[0].message);
  }

  const assessment = await requireActiveAssessment(parsed.data.token);
  if (!assessment.consentGivenAt) {
    redirectWithError(startPath(parsed.data.token), "Подтвердите согласие перед заполнением анкеты.");
  }

  if (assessment.tests.length === 0) {
    redirectWithError(profilePath(parsed.data.token), "Для вакансии не настроены опубликованные тесты.");
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error: candidateError } = await admin
    .from("candidates")
    .update({
      city: parsed.data.city,
      email: parsed.data.email.toLowerCase(),
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      profile_completed_at: now,
    })
    .eq("id", assessment.candidate.id);

  if (candidateError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось сохранить анкету кандидата.");
  }

  const { error: sessionError } = await admin.from("test_sessions").upsert(
    assessment.tests.map((test) => ({
      application_id: assessment.applicationId,
      candidate_id: assessment.candidate.id,
      status: "not_started",
      test_version_id: test.versionId,
    })),
    { ignoreDuplicates: true, onConflict: "application_id,test_version_id" },
  );

  if (sessionError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось подготовить тесты.");
  }

  const refreshed = await getAssessmentByToken(parsed.data.token);
  if (refreshed.availability !== "active") {
    redirectWithError(startPath(parsed.data.token), "Ссылка больше не доступна.");
  }

  const firstSession = nextPendingSession(refreshed);
  if (!firstSession) {
    redirect(`/assessment/${parsed.data.token}/complete`);
  }

  const [{ error: invitationError }, { error: applicationError }] = await Promise.all([
    admin
      .from("invitations")
      .update({ status: "started" })
      .eq("id", refreshed.invitationId)
      .in("status", ["sent", "opened", "started"]),
    admin
      .from("candidate_applications")
      .update({ current_stage: "assessment", status: "in_progress" })
      .eq("id", refreshed.applicationId)
      .in("status", ["invited", "in_progress"]),
  ]);

  if (invitationError || applicationError) {
    redirectWithError(profilePath(parsed.data.token), "Не удалось начать оценку.");
  }

  await startSession(parsed.data.token, refreshed, firstSession.id);
  redirect(testPath(parsed.data.token, firstSession.id));
}

function buildAnswer(question: FlowQuestion, formData: FormData, inputPrefix = "") {
  const field = (name: string) => `${inputPrefix}${name}`;

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

  const answerText = formString(formData, field("answerText")).trim();
  if (!answerText || answerText.length > 4000) {
    return null;
  }

  return { answer_json: {}, answer_text: answerText, selected_option_id: null };
}

export async function saveCandidateAnswerAction(formData: FormData) {
  const token = getToken(formData);
  const sessionId = z.string().uuid().safeParse(formString(formData, "sessionId"));
  const questionId = z.string().uuid().safeParse(formString(formData, "questionId"));
  const direction = formString(formData, "direction") === "previous" ? "previous" : "next";

  if (!token || !sessionId.success || !questionId.success) {
    redirect("/");
  }

  await requireOwnedSession(formData, token, sessionId.data);

  const data = await getAssessmentQuestionPageData(token, sessionId.data);
  if (!data || data.assessment.availability !== "active" || data.session.status !== "in_progress") {
    redirectWithError(startPath(token), "Тест недоступен для прохождения.");
  }

  const questionIndex = data.questions.findIndex((question) => question.id === questionId.data);
  const question = data.questions[questionIndex];
  if (!question) {
    redirectWithError(testPath(token, sessionId.data), "Вопрос не найден.");
  }

  const answer = buildAnswer(question, formData);
  if (!answer) {
    redirectWithError(testPath(token, sessionId.data, questionIndex), "Выберите или укажите ответ.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("candidate_answers").upsert(
    {
      ...answer,
      question_id: question.id,
      session_id: sessionId.data,
    },
    { onConflict: "session_id,question_id" },
  );

  if (error) {
    redirectWithError(testPath(token, sessionId.data, questionIndex), "Не удалось сохранить ответ.");
  }

  if (direction === "previous") {
    redirect(testPath(token, sessionId.data, Math.max(questionIndex - 1, 0)));
  }

  if (questionIndex < data.questions.length - 1) {
    redirect(testPath(token, sessionId.data, questionIndex + 1));
  }

  await finishSessionAndContinue(token, data.assessment, sessionId.data);
}

export async function saveCandidateSectionAction(formData: FormData) {
  const token = getToken(formData);
  const sessionId = z.string().uuid().safeParse(formString(formData, "sessionId"));
  const requestedSection = Number(formString(formData, "sectionIndex"));
  const direction = formString(formData, "direction") === "previous" ? "previous" : "next";
  if (!token || !sessionId.success || !Number.isInteger(requestedSection)) {
    redirect("/");
  }

  await requireOwnedSession(formData, token, sessionId.data);

  const data = await getAssessmentQuestionPageData(token, sessionId.data);
  if (!data || data.assessment.availability !== "active" || data.session.status !== "in_progress") {
    redirectWithError(startPath(token), "Тест недоступен для прохождения.");
  }

  const sectionIndex = Math.min(Math.max(requestedSection, 0), Math.max(data.sections.length - 1, 0));
  const section = data.sections[sectionIndex];
  if (!section) {
    redirectWithError(testPath(token, sessionId.data), "Секция не найдена.");
  }

  const answers = section.questions.map((question) => ({
    answer: buildAnswer(question, formData, `q_${question.id}_`),
    question,
  }));
  const missingRequired = answers.find(({ answer, question }) => question.isRequired && !answer);
  if (missingRequired) {
    redirectWithError(
      testPath(token, sessionId.data, sectionIndex),
      "Ответьте на обязательные вопросы текущей секции.",
    );
  }

  const admin = createAdminClient();
  const upserts = answers
    .filter((entry) => entry.answer)
    .map(({ answer, question }) => ({
      ...answer!,
      question_id: question.id,
      session_id: sessionId.data,
    }));
  if (upserts.length > 0) {
    const { error } = await admin
      .from("candidate_answers")
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
      .from("candidate_answers")
      .delete()
      .eq("session_id", sessionId.data)
      .in("question_id", clearedOptionalIds);
    if (error) {
      redirectWithError(testPath(token, sessionId.data, sectionIndex), "Не удалось обновить ответы.");
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

export async function completeEmptySessionAction(formData: FormData) {
  const token = getToken(formData);
  const sessionId = z.string().uuid().safeParse(formString(formData, "sessionId"));

  if (!token || !sessionId.success) {
    redirect("/");
  }

  await requireOwnedSession(formData, token, sessionId.data);

  const data = await getAssessmentQuestionPageData(token, sessionId.data);
  if (!data || data.questions.length !== 0 || data.session.status !== "in_progress") {
    redirectWithError(startPath(token), "Тест недоступен.");
  }

  await finishSessionAndContinue(token, data.assessment, sessionId.data);
}
