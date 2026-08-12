import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RemediationFlowQuestion = {
  id: string;
  questionType: string;
  remediationQuestionId: string | null;
};

export type SubmittedRemediationAnswer = {
  questionId: string;
  selectedOptionId: string | null;
};

export type RemediationDecision = {
  isCorrect: boolean | null;
  parentQuestionId: string;
  targetQuestionId: string;
};

type StoredQuestion = {
  answer_options?: Array<{ id: string; is_correct: boolean | null }> | null;
  id: string;
};

export async function evaluateRemediationBranches(
  admin: AdminClient,
  questions: RemediationFlowQuestion[],
  answers: SubmittedRemediationAnswer[],
): Promise<RemediationDecision[]> {
  const parents = questions.filter(
    (question) =>
      question.questionType === "single_choice" && question.remediationQuestionId,
  );
  if (parents.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from("questions")
    .select("id, answer_options(id, is_correct)")
    .in("id", parents.map((question) => question.id));
  if (error) {
    throw new Error("Unable to load remediation answer keys.");
  }

  const storedById = new Map(
    ((data ?? []) as unknown as StoredQuestion[]).map((question) => [question.id, question]),
  );
  const answerByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.selectedOptionId]),
  );

  return parents.map((parent) => {
    const selectedOptionId = answerByQuestion.get(parent.id) ?? null;
    const selectedOption = (storedById.get(parent.id)?.answer_options ?? []).find(
      (option) => option.id === selectedOptionId,
    );

    return {
      isCorrect:
        selectedOption?.is_correct === true
          ? true
          : selectedOption?.is_correct === false
            ? false
            : null,
      parentQuestionId: parent.id,
      targetQuestionId: parent.remediationQuestionId!,
    };
  });
}
