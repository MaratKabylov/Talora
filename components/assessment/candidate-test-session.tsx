"use client";

import { ClipboardX, Cloud, CloudOff, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type SyntheticEvent,
} from "react";

import { QuestionResponseFields } from "@/components/assessment/question-response-fields";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-content";
import {
  completeEmptySessionAction,
  saveCandidateSectionAction,
} from "@/lib/assessment/actions";
import {
  completeEmptyEmployeeAssessmentSessionAction,
  saveEmployeeAssessmentSectionAction,
} from "@/lib/employee-assessments/public-actions";
import { requestedSectionIndex, type AssessmentSectionSnapshot, type PublicFlowQuestion as FlowQuestion, type PublicFlowSection as FlowSection, type SectionSavedAnswer as SavedAnswer } from "@/lib/assessment/section-contract";
import { fetchAssessmentSection, firstQuestionIndex, saveAssessmentSection, sectionUrl } from "@/lib/assessment/section-navigation";
import { SectionPrefetchCache } from "@/lib/assessment/section-prefetch";
import { requestAssessmentCompletionUntilSettled, safeAssessmentDestination } from "@/lib/assessment/completion-contract";
import { reportClientOperation } from "@/lib/observability/client-performance";
import type { ClientPerformanceOperation } from "@/lib/observability/performance-core";
import type { TestPresentationSettings } from "@/lib/tests/presentation-settings";

type ControlResponse =
  | {
      answerIsCorrect?: boolean | null;
      deadlineAt: string | null;
      incorrectFeedback?: string | null;
      savedAt?: string;
      status: "active";
    }
  | { retryAfterSeconds: number; status: "blocked" }
  | { redirectTo: string; status: "redirect" };

type LockState = "checking" | "active" | "blocked" | "error" | "expiring";
type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

type AssessmentTestSessionProps = {
  assessmentType?: "candidate" | "employee";
  answers: Record<string, SavedAnswer>;
  initialDeadlineAt: string | null;
  otherVisibleQuestionCount: number;
  presentationSettings: TestPresentationSettings;
  questionOffset: number;
  reviewMode: boolean;
  section: FlowSection | null;
  sectionCount: number;
  sectionIndex: number;
  sessionId: string;
  testInstructions: string | null;
  token: string;
  onSectionChange?: (snapshot: AssessmentSectionSnapshot) => void;
  sectionPrefetchEnabled?: boolean;
  completionEnabled?: boolean;
};

const DEVICE_STORAGE_KEY = "talvia_assessment_device_id";
const CONTROL_PERFORMANCE_OPERATIONS: Partial<Record<string, ClientPerformanceOperation>> = {
  autosave: "assessment.autosave",
  claim: "assessment.claim",
  complete: "assessment.complete",
  event: "assessment.event",
  expire: "assessment.expire",
  heartbeat: "assessment.heartbeat",
};

function createId() {
  return crypto.randomUUID();
}

function storedId(storage: Storage, key: string) {
  try {
    const current = storage.getItem(key);
    if (current) {
      return current;
    }
    const created = createId();
    storage.setItem(key, created);
    return created;
  } catch {
    return createId();
  }
}

async function postControl(
  body: Record<string, unknown>,
  keepalive = false,
): Promise<ControlResponse> {
  const metricOperation =
    typeof body.operation === "string"
      ? CONTROL_PERFORMANCE_OPERATIONS[body.operation]
      : undefined;
  const startedAt = performance.now();

  try {
    const response = await fetch("/api/assessment/session-control", {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      keepalive,
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(
        typeof payload?.error === "string" ? payload.error : "Не удалось обновить состояние теста.",
      );
    }

    const result = (await response.json()) as ControlResponse;
    if (metricOperation) {
      reportClientOperation(metricOperation, performance.now() - startedAt, "success");
    }
    return result;
  } catch (error) {
    if (metricOperation) {
      reportClientOperation(metricOperation, performance.now() - startedAt, "failure");
    }
    throw error;
  }
}

function remainingLabel(seconds: number | null) {
  if (seconds === null) {
    return "Без ограничения";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function questionIdFromTarget(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-question-id]")?.dataset.questionId ?? null
    : null;
}

type AnswerDraft = {
  answerText?: string | null;
  leastOptionId?: string | null;
  mostOptionId?: string | null;
  matches?: Array<{ optionId: string; targetId: string }>;
  orderedOptionIds?: string[];
  scaleValue?: number | null;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
};

function draftForQuestion(form: HTMLFormElement, question: FlowQuestion): AnswerDraft {
  const formData = new FormData(form);
  const prefix = `q_${question.id}_`;

  if (question.questionType === "forced_choice") {
    const mostOptionId = formData.get(`${prefix}mostOptionId`);
    const leastOptionId = formData.get(`${prefix}leastOptionId`);
    return {
      leastOptionId: typeof leastOptionId === "string" && leastOptionId ? leastOptionId : null,
      mostOptionId: typeof mostOptionId === "string" && mostOptionId ? mostOptionId : null,
    };
  }

  if (question.questionType === "single_choice") {
    const value = formData.get(`${prefix}optionId`);
    return { selectedOptionId: typeof value === "string" && value ? value : null };
  }

  if (question.questionType === "multiple_choice") {
    return {
      selectedOptionIds: formData
        .getAll(`${prefix}optionIds`)
        .filter((value): value is string => typeof value === "string"),
    };
  }

  if (question.questionType === "scale") {
    const value = formData.get(`${prefix}scaleValue`);
    const parsed = typeof value === "string" && value ? Number(value) : null;
    return { scaleValue: parsed !== null && Number.isInteger(parsed) ? parsed : null };
  }

  if (question.questionType === "ordering" && question.isStructured) {
    return {
      orderedOptionIds: formData
        .getAll(`${prefix}orderedOptionIds`)
        .filter((value): value is string => typeof value === "string" && Boolean(value)),
    };
  }

  if (question.questionType === "matching" && question.isStructured) {
    return {
      matches: question.options.flatMap((option) => {
        const targetId = formData.get(`${prefix}match_${option.id}`);
        return typeof targetId === "string" && targetId
          ? [{ optionId: option.id, targetId }]
          : [];
      }),
    };
  }

  const value = formData.get(`${prefix}answerText`);
  return { answerText: typeof value === "string" ? value : null };
}

function hasDraftAnswer(question: FlowQuestion, answer: AnswerDraft) {
  if (question.questionType === "forced_choice") {
    return Boolean(
      answer.mostOptionId &&
        answer.leastOptionId &&
        answer.mostOptionId !== answer.leastOptionId,
    );
  }
  if (question.questionType === "single_choice") {
    return Boolean(answer.selectedOptionId);
  }
  if (question.questionType === "multiple_choice") {
    const count = new Set(answer.selectedOptionIds ?? []).size;
    return count >= question.minSelections && count <= question.maxSelections;
  }
  if (question.questionType === "scale") {
    return answer.scaleValue !== null && answer.scaleValue !== undefined;
  }
  if (question.questionType === "ordering" && question.isStructured) {
    return answer.orderedOptionIds?.length === question.options.length;
  }
  if (question.questionType === "matching" && question.isStructured) {
    return answer.matches?.length === question.options.length;
  }
  return Boolean(answer.answerText?.trim());
}

function savedAnswerFromDraft(
  question: FlowQuestion,
  answer: AnswerDraft,
  isCorrect: boolean | null,
  timeSpentSeconds: number | null,
): SavedAnswer {
  const remediationRequired = Boolean(question.remediationQuestionId && isCorrect === false);
  if (question.questionType === "forced_choice") {
    const hasAnswer = Boolean(
      answer.mostOptionId &&
        answer.leastOptionId &&
        answer.mostOptionId !== answer.leastOptionId,
    );
    return {
      answerJson: hasAnswer
        ? { leastOptionId: answer.leastOptionId, mostOptionId: answer.mostOptionId }
        : { skipped: true },
      answerText: null,
      remediationRequired: false,
      selectedOptionId: null,
      timeSpentSeconds,
    };
  }
  if (question.questionType === "single_choice") {
    return {
      answerJson: answer.selectedOptionId ? {} : { skipped: true },
      answerText: null,
      remediationRequired,
      selectedOptionId: answer.selectedOptionId ?? null,
      timeSpentSeconds,
    };
  }
  if (question.questionType === "multiple_choice") {
    return {
      answerJson: answer.selectedOptionIds?.length
        ? { selectedOptionIds: answer.selectedOptionIds }
        : { skipped: true },
      answerText: null,
      remediationRequired,
      selectedOptionId: null,
      timeSpentSeconds,
    };
  }
  if (question.questionType === "scale") {
    return {
      answerJson:
        answer.scaleValue === null || answer.scaleValue === undefined
          ? { skipped: true }
          : { value: answer.scaleValue },
      answerText:
        answer.scaleValue === null || answer.scaleValue === undefined
          ? null
          : String(answer.scaleValue),
      remediationRequired,
      selectedOptionId: null,
      timeSpentSeconds,
    };
  }
  if (question.questionType === "ordering" && question.isStructured) {
    return {
      answerJson: answer.orderedOptionIds?.length
        ? { orderedOptionIds: answer.orderedOptionIds }
        : { skipped: true },
      answerText: null,
      remediationRequired,
      selectedOptionId: null,
      timeSpentSeconds,
    };
  }
  if (question.questionType === "matching" && question.isStructured) {
    return {
      answerJson: answer.matches?.length ? { matches: answer.matches } : { skipped: true },
      answerText: null,
      remediationRequired,
      selectedOptionId: null,
      timeSpentSeconds,
    };
  }
  return {
    answerJson: answer.answerText?.trim() ? {} : { skipped: true },
    answerText: answer.answerText?.trim() || null,
    remediationRequired,
    selectedOptionId: null,
    timeSpentSeconds,
  };
}

export function AssessmentTestSession({
  assessmentType = "candidate",
  answers,
  initialDeadlineAt,
  otherVisibleQuestionCount: initialOtherVisibleQuestionCount,
  presentationSettings,
  questionOffset: initialQuestionOffset,
  reviewMode: initialReviewMode,
  section: initialSection,
  sectionCount: initialSectionCount,
  sectionIndex: initialSectionIndex,
  sessionId,
  testInstructions,
  token,
  onSectionChange,
  sectionPrefetchEnabled = false,
  completionEnabled = false,
}: AssessmentTestSessionProps) {
  const router = useRouter();
  const completionPendingRef = useRef(false);
  const completionSubmittingRef = useRef(false);
  const [completionPending, setCompletionPending] = useState(false);
  const [completionSubmitting, setCompletionSubmitting] = useState(false);
  const [terminalNavigating, setTerminalNavigating] = useState(false);
  const [navigatedSection, setNavigatedSection] = useState<AssessmentSectionSnapshot | null>(null);
  const section = navigatedSection ? navigatedSection.section : initialSection;
  const sectionIndex = navigatedSection?.sectionIndex ?? initialSectionIndex;
  const sectionCount = navigatedSection?.sections.length ?? initialSectionCount;
  const questionOffset = navigatedSection?.questionOffset ?? initialQuestionOffset;
  const otherVisibleQuestionCount = navigatedSection?.otherVisibleQuestionCount ?? initialOtherVisibleQuestionCount;
  const reviewMode = navigatedSection?.reviewMode ?? initialReviewMode;
  const [sectionLoading, setSectionLoading] = useState(false);
  const sectionRequestRef = useRef<AbortController | null>(null);
  const [sectionPrefetch] = useState(() => new SectionPrefetchCache());
  const questionDirtyRef = useRef(false);
  const questionSubmittingRef = useRef(false);
  const sectionSubmittingRef = useRef(false);
  const legacySubmissionReadyRef = useRef(false);
  const mountedRef = useRef(true);
  const [sectionSaving, setSectionSaving] = useState(false);
  const [clientId, setClientId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deadlineAt, setDeadlineAt] = useState(initialDeadlineAt);
  const [integrityNotice, setIntegrityNotice] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>("checking");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [sessionAnswers, setSessionAnswers] = useState(answers);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [remediationFeedback, setRemediationFeedback] = useState(
    new Map<string, string>(),
  );
  const [tabWarning, setTabWarning] = useState(false);
  const [timerWarning, setTimerWarning] = useState<"five" | "one" | null>(null);
  const clientIdRef = useRef("");
  const deviceIdRef = useRef("");
  const expiryRequestedRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const hiddenAtRef = useRef<number | null>(null);
  const lastQuestionIdRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const pendingSavesRef = useRef(0);
  const activeTimedQuestionIdRef = useRef<string | null>(null);
  const activeTimerStartedAtRef = useRef<number | null>(null);
  const elapsedQuestionTimeRef = useRef(new Map<string, number>());
  const savedQuestionTimeRef = useRef(
    new Map(
      Object.entries(answers).map(([questionId, answer]) => [
        questionId,
        answer.timeSpentSeconds ?? 0,
      ]),
    ),
  );
  const queueAutosaveRef = useRef<(questionId: string) => void>(() => undefined);
  const sectionQuestionIdsRef = useRef((section?.questions ?? []).map(question => question.id));
  const saveChainsRef = useRef(new Map<string, Promise<void>>());
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const questionsById = useMemo(
    () => new Map((section?.questions ?? []).map((question) => [question.id, question])),
    [section],
  );
  const visibleQuestions = useMemo(
    () =>
      (section?.questions ?? []).filter(
        (question) =>
          !question.remediationParentId ||
          sessionAnswers[question.remediationParentId]?.remediationRequired === true,
      ),
    [section, sessionAnswers],
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => {
    const firstIncomplete = visibleQuestions.findIndex((question) => !answers[question.id]);
    if (firstIncomplete >= 0) {
      return firstIncomplete;
    }
    return reviewMode && visibleQuestions.length > 0 ? visibleQuestions.length - 1 : -1;
  });
  const isOneQuestion = presentationSettings.presentationMode === "one_question";
  const assessmentPath =
    assessmentType === "employee" ? `/employee-assessment/${token}` : `/assessment/${token}`;
  const testPath = `${assessmentPath}/test/${sessionId}`;
  const softNavigation = Boolean(onSectionChange);
  const currentSectionUrlRef = useRef(sectionUrl(testPath, sectionIndex, reviewMode));
  const activeQuestion =
    isOneQuestion && currentQuestionIndex >= 0
      ? visibleQuestions[currentQuestionIndex] ?? null
      : null;
  const [forcedChoiceCompletion, setForcedChoiceCompletion] = useState<Record<string, boolean>>(
    {},
  );
  const forcedChoiceIsComplete = useCallback(
    (question: FlowQuestion) => {
      const localCompletion = forcedChoiceCompletion[question.id];
      if (localCompletion !== undefined) return localCompletion;
      const stored = sessionAnswers[question.id]?.answerJson;
      return (
        typeof stored?.mostOptionId === "string" &&
        typeof stored?.leastOptionId === "string" &&
        stored.mostOptionId !== stored.leastOptionId
      );
    },
    [forcedChoiceCompletion, sessionAnswers],
  );
  const isActiveAnswerComplete = activeQuestion
    ? activeQuestion.questionType !== "forced_choice" || forcedChoiceIsComplete(activeQuestion)
    : false;
  const areSectionForcedChoicesComplete = visibleQuestions
    .filter((question) => question.isRequired && question.questionType === "forced_choice")
    .every(forcedChoiceIsComplete);
  const totalVisibleQuestionCount = otherVisibleQuestionCount + visibleQuestions.length;
  const sectionContent = useMemo(
    () =>
      [
        ...(section?.contentBlocks ?? []).map((block) => ({
          block,
          kind: "content-block" as const,
          orderIndex: block.orderIndex,
          sortIndex: block.positionIndex * 2,
        })),
        ...visibleQuestions.map((question) => ({
          kind: "question" as const,
          orderIndex: question.orderIndex,
          question,
          sortIndex: question.orderIndex * 2 - 1,
        })),
      ].sort(
        (left, right) =>
          left.sortIndex - right.sortIndex || left.orderIndex - right.orderIndex,
      ),
    [section, visibleQuestions],
  );

  const applyControlResponse = useCallback((response: ControlResponse) => {
    if (response.status === "redirect") {
      sectionRequestRef.current?.abort();
      sectionPrefetch.clear();
      navigatingRef.current = true;
      if (completionEnabled && safeAssessmentDestination(response.redirectTo, { assessmentType, token })) {
        setTerminalNavigating(true);
        try { router.replace(response.redirectTo); }
        catch (error) { navigatingRef.current = false; setTerminalNavigating(false); throw error; }
      } else window.location.assign(response.redirectTo);
      return;
    }

    if (response.status === "blocked") {
      setLockState("blocked");
      return;
    }

    setDeadlineAt(response.deadlineAt);
    setRemainingSeconds(
      response.deadlineAt
        ? Math.max(0, Math.ceil((new Date(response.deadlineAt).getTime() - Date.now()) / 1000))
        : null,
    );
    setLockState("active");
  }, [sectionPrefetch, completionEnabled, assessmentType, token, router]);

  const identity = useCallback(
    () => ({
      assessmentType,
      clientId: clientIdRef.current,
      deviceId: deviceIdRef.current,
      sessionId,
      token,
    }),
    [assessmentType, sessionId, token],
  );

  const pauseQuestionTimer = useCallback(() => {
    const questionId = activeTimedQuestionIdRef.current;
    const startedAt = activeTimerStartedAtRef.current;
    if (!questionId || startedAt === null) {
      return;
    }

    elapsedQuestionTimeRef.current.set(
      questionId,
      (elapsedQuestionTimeRef.current.get(questionId) ?? 0) + (performance.now() - startedAt),
    );
    activeTimerStartedAtRef.current = null;
  }, []);

  const startQuestionTimer = useCallback(
    (questionId: string) => {
      if (
        !presentationSettings.captureQuestionTime ||
        lockState !== "active" ||
        tabWarning ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      if (activeTimedQuestionIdRef.current !== questionId) {
        pauseQuestionTimer();
        activeTimedQuestionIdRef.current = questionId;
      }
      if (activeTimerStartedAtRef.current === null) {
        activeTimerStartedAtRef.current = performance.now();
      }
    },
    [lockState, pauseQuestionTimer, presentationSettings.captureQuestionTime, tabWarning],
  );

  const questionTimeSeconds = useCallback(
    (questionId: string) => {
      if (!presentationSettings.captureQuestionTime) {
        return undefined;
      }
      if (activeTimedQuestionIdRef.current === questionId) {
        pauseQuestionTimer();
      }
      const persistedSeconds = savedQuestionTimeRef.current.get(questionId) ?? 0;
      const activeMilliseconds = elapsedQuestionTimeRef.current.get(questionId) ?? 0;
      return Math.max(0, persistedSeconds + Math.round(activeMilliseconds / 1000));
    },
    [pauseQuestionTimer, presentationSettings.captureQuestionTime],
  );

  const markQuestionTimeSaved = useCallback((questionId: string, seconds?: number) => {
    if (seconds === undefined) {
      return;
    }
    savedQuestionTimeRef.current.set(questionId, seconds);
    elapsedQuestionTimeRef.current.set(questionId, 0);
  }, []);

  useEffect(() => {
    if (!isOneQuestion || !activeQuestion) {
      pauseQuestionTimer();
      return;
    }

    lastQuestionIdRef.current = activeQuestion.id;
    startQuestionTimer(activeQuestion.id);
    return pauseQuestionTimer;
  }, [activeQuestion, isOneQuestion, pauseQuestionTimer, startQuestionTimer]);

  const claimSession = useCallback(async () => {
    if (!clientIdRef.current || !deviceIdRef.current) {
      return;
    }

    setLockState("checking");
    try {
      const response = await postControl({
        ...identity(),
        clientEventId: createId(),
        operation: "claim",
      });
      applyControlResponse(response);
    } catch {
      setLockState("error");
    }
  }, [applyControlResponse, identity]);

  useEffect(() => {
    let cancelled = false;
    const instanceId = createId();
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`talvia-assessment-${sessionId}`);

    async function initialize() {
      const nextDeviceId = storedId(window.localStorage, DEVICE_STORAGE_KEY);
      const clientStorageKey = `talvia_assessment_client_${sessionId}`;
      let nextClientId = storedId(window.sessionStorage, clientStorageKey);
      let duplicated = false;

      if (channel) {
        channel.onmessage = (event) => {
          const message = event.data as {
            clientId?: string;
            instanceId?: string;
            type?: string;
          };
          if (
            message.type === "probe" &&
            message.clientId === nextClientId &&
            message.instanceId !== instanceId
          ) {
            channel.postMessage({ clientId: nextClientId, instanceId, type: "active" });
          }
          if (
            message.type === "active" &&
            message.clientId === nextClientId &&
            message.instanceId !== instanceId
          ) {
            duplicated = true;
          }
        };
        channel.postMessage({ clientId: nextClientId, instanceId, type: "probe" });
        await new Promise((resolve) => setTimeout(resolve, 180));
      }

      if (duplicated) {
        nextClientId = createId();
        try {
          window.sessionStorage.setItem(clientStorageKey, nextClientId);
        } catch {
          // The in-memory identifier still keeps this tab distinct.
        }
      }

      if (cancelled) {
        return;
      }

      clientIdRef.current = nextClientId;
      deviceIdRef.current = nextDeviceId;
      setClientId(nextClientId);
      setDeviceId(nextDeviceId);

      try {
        const response = await postControl({
          assessmentType,
          clientEventId: createId(),
          clientId: nextClientId,
          deviceId: nextDeviceId,
          operation: "claim",
          sessionId,
          token,
        });
        if (!cancelled) {
          applyControlResponse(response);
        }
      } catch {
        if (!cancelled) {
          setLockState("error");
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [applyControlResponse, assessmentType, sessionId, token]);

  useEffect(() => {
    if (!deadlineAt) {
      return;
    }

    function updateTimer() {
      const seconds = Math.max(0, Math.ceil((new Date(deadlineAt!).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds <= 60 && seconds > 0) {
        setTimerWarning("one");
      } else if (seconds <= 300 && seconds > 60) {
        setTimerWarning((current) => current ?? "five");
      }

      if (seconds === 0 && !expiryRequestedRef.current && !completionPendingRef.current && !navigatingRef.current) {
        expiryRequestedRef.current = true;
        setLockState("expiring");
        void postControl({
          ...identity(),
          clientEventId: createId(),
          operation: "expire",
        })
          .then(applyControlResponse)
          .catch(() => {
            expiryRequestedRef.current = false;
            setLockState("error");
          });
      }
    }

    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [applyControlResponse, deadlineAt, identity, lockState]);

  const recordEvent = useCallback(
    async (
      eventType: "focus_lost" | "focus_returned" | "clipboard_copy" | "clipboard_cut" | "clipboard_paste",
      questionId?: string | null,
      metadata?: Record<string, unknown>,
      keepalive = false,
    ) => {
      if (lockState !== "active" || completionPendingRef.current || navigatingRef.current) {
        return;
      }

      try {
        const response = await postControl(
          {
            ...identity(),
            clientEventId: createId(),
            clientOccurredAt: new Date().toISOString(),
            eventType,
            metadata,
            operation: "event",
            questionId: questionId ?? null,
          },
          keepalive,
        );
        if (!completionPendingRef.current && !navigatingRef.current) applyControlResponse(response);
      } catch {
        // A failed telemetry write must not discard the participant's answers.
      }
    },
    [applyControlResponse, identity, lockState],
  );

  useEffect(() => {
    if (lockState !== "active") {
      return;
    }

    const handleVisibility = () => {
      if (navigatingRef.current) {
        return;
      }

      if (document.visibilityState === "hidden" && hiddenAtRef.current === null) {
        pauseQuestionTimer();
        hiddenAtRef.current = Date.now();
        void recordEvent("focus_lost", lastQuestionIdRef.current, undefined, true);
        return;
      }

      if (document.visibilityState === "visible" && hiddenAtRef.current !== null) {
        const durationMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        setTabWarning(true);
        void recordEvent("focus_returned", lastQuestionIdRef.current, { durationMs });
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [lockState, pauseQuestionTimer, recordEvent]);

  const queueAutosave = useCallback(
    (questionId: string) => {
      const form = formRef.current;
      const question = questionsById.get(questionId);
      if (!mountedRef.current || !form || !question || lockState !== "active" || (softNavigation && isOneQuestion) || sectionSubmittingRef.current || completionPendingRef.current) {
        return;
      }

      const answer = draftForQuestion(form, question);
      const timeSpentSeconds = questionTimeSeconds(questionId);
      const previous = saveChainsRef.current.get(questionId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          if (!mountedRef.current || navigatingRef.current) return;
          pendingSavesRef.current += 1;
          setSaveState("saving");
          let lastError: unknown = null;

          for (const retryDelay of [0, 1_000, 3_000]) {
            if (retryDelay) {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
            if (!mountedRef.current || navigatingRef.current) break;
            try {
              const response = await postControl({
                ...identity(),
                answer,
                operation: "autosave",
                questionId,
                ...(timeSpentSeconds === undefined ? {} : { timeSpentSeconds }),
              });
              applyControlResponse(response);
              if (response.status === "active") {
                markQuestionTimeSaved(questionId, timeSpentSeconds);
                setSavedAt(response.savedAt ?? new Date().toISOString());
              }
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              if (!navigator.onLine) {
                setSaveState("offline");
              }
            }
          }

          pendingSavesRef.current -= 1;
          if (lastError && mountedRef.current && !navigatingRef.current) {
            setSaveState(navigator.onLine ? "error" : "offline");
            const retryTimer = setTimeout(() => {
              saveTimersRef.current.delete(questionId);
              queueAutosaveRef.current(questionId);
            }, 10_000);
            saveTimersRef.current.set(questionId, retryTimer);
          } else if (pendingSavesRef.current === 0) {
            setSaveState("saved");
          }
        })
        .finally(() => {
          if (saveChainsRef.current.get(questionId) === next) {
            saveChainsRef.current.delete(questionId);
          }
        });
      saveChainsRef.current.set(questionId, next);
    },
    [
      applyControlResponse,
      identity,
      lockState,
      markQuestionTimeSaved,
      questionTimeSeconds,
      questionsById,
      softNavigation,
      isOneQuestion,
    ],
  );

  useEffect(() => {
    queueAutosaveRef.current = queueAutosave;
    sectionQuestionIdsRef.current = (section?.questions ?? []).map(question => question.id);
  }, [queueAutosave, section]);

  const scheduleAutosave = useCallback(
    (questionId: string | null, delay: number) => {
      if (!questionId) {
        return;
      }
      lastQuestionIdRef.current = questionId;
      const current = saveTimersRef.current.get(questionId);
      if (current) {
        clearTimeout(current);
      }
      saveTimersRef.current.set(
        questionId,
        setTimeout(() => {
          saveTimersRef.current.delete(questionId);
          queueAutosave(questionId);
        }, delay),
      );
    },
    [queueAutosave],
  );

  useEffect(() => {
    if (lockState !== "active") {
      return;
    }

    async function heartbeat() {
      if (completionPendingRef.current || navigatingRef.current) return;
      try {
        const response = await postControl({ ...identity(), operation: "heartbeat" });
        if (!completionPendingRef.current && !navigatingRef.current) applyControlResponse(response);
      } catch {
        if (!completionPendingRef.current && !navigatingRef.current) setSaveState(navigator.onLine ? "error" : "offline");
      }
    }

    const interval = window.setInterval(() => void heartbeat(), 30_000);
    const handleOffline = () => setSaveState("offline");
    const handleOnline = () => {
      void heartbeat();
      for (const questionId of sectionQuestionIdsRef.current) {
        const timer = saveTimersRef.current.get(questionId);
        if (timer) {
          clearTimeout(timer);
        }
        saveTimersRef.current.set(questionId, setTimeout(() => queueAutosaveRef.current(questionId), 0));
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [applyControlResponse, identity, lockState]);

  useEffect(
    () => {
      mountedRef.current = true;
      const timers = saveTimersRef.current;
      return () => {
        mountedRef.current = false;
        for (const timer of timers.values()) clearTimeout(timer);
      };
    },
    [],
  );

  function handleInput(event: FormEvent<HTMLFormElement>) {
    if (softNavigation) questionDirtyRef.current = true;
    const target = event.target;
    const questionId = questionIdFromTarget(target);
    if (questionId) {
      startQuestionTimer(questionId);
    }
    const delay =
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && ["text", "search"].includes(target.type))
        ? 800
        : 0;
    scheduleAutosave(questionId, delay);
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    if (softNavigation) questionDirtyRef.current = true;
    const target = event.target;
    const questionId = questionIdFromTarget(target);
    if (questionId) {
      startQuestionTimer(questionId);
    }
    if (activeQuestion?.id === questionId && activeQuestion.questionType === "forced_choice") {
      setForcedChoiceCompletion((current) => ({
        ...current,
        [activeQuestion.id]: hasDraftAnswer(
          activeQuestion,
          draftForQuestion(event.currentTarget, activeQuestion),
        ),
      }));
    }
    if (!isOneQuestion) {
      const changedQuestion = questionId ? questionsById.get(questionId) : null;
      if (changedQuestion?.questionType === "forced_choice") {
        setForcedChoiceCompletion((current) => ({
          ...current,
          [changedQuestion.id]: hasDraftAnswer(
            changedQuestion,
            draftForQuestion(event.currentTarget, changedQuestion),
          ),
        }));
      }
    }
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && ["text", "search"].includes(target.type))
    ) {
      return;
    }
    scheduleAutosave(questionId, 0);
  }

  function handleOneQuestionChange(event: FormEvent<HTMLFormElement>) {
    if (softNavigation) questionDirtyRef.current = true;
    const questionId = questionIdFromTarget(event.target);
    if (questionId) {
      startQuestionTimer(questionId);
    }
    if (
      activeQuestion?.id !== questionId ||
      activeQuestion.questionType !== "forced_choice"
    ) {
      return;
    }
    const isComplete = hasDraftAnswer(
      activeQuestion,
      draftForQuestion(event.currentTarget, activeQuestion),
    );
    setForcedChoiceCompletion((current) => ({
      ...current,
      [activeQuestion.id]: isComplete,
    }));
  }

  function handleBlur(event: SyntheticEvent<HTMLFormElement>) {
    const questionId = questionIdFromTarget(event.target);
    if (questionId) {
      pauseQuestionTimer();
      scheduleAutosave(questionId, 0);
    }
  }

  function handleClipboard(
    event: ReactClipboardEvent<HTMLDivElement>,
    eventType: "clipboard_copy" | "clipboard_cut" | "clipboard_paste",
  ) {
    event.preventDefault();
    const questionId = questionIdFromTarget(event.target);
    lastQuestionIdRef.current = questionId;
    setIntegrityNotice("Буфер обмена отключен во время прохождения теста. Попытка зафиксирована.");
    void recordEvent(eventType, questionId);
  }

  async function completeSavedSession(retryScoring = false) {
    if (completionSubmittingRef.current || navigatingRef.current || !mountedRef.current || lockState !== "active") return;
    completionSubmittingRef.current = true;
    completionPendingRef.current = true;
    setCompletionPending(true);
    setCompletionSubmitting(true);
    setQuestionError(null);
    const completionStartedAt = performance.now();
    let completionOutcome: "success" | "failure" = "failure";
    sectionPrefetch.clear();
    pauseQuestionTimer();
    for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
    saveTimersRef.current.clear();
    try {
      await Promise.all([...saveChainsRef.current.values()]);
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
      if (!mountedRef.current || navigatingRef.current) return;
      const response = await requestAssessmentCompletionUntilSettled({ assessmentType, token, sessionId,
        clientId: clientIdRef.current, deviceId: deviceIdRef.current, retryScoring });
      completionOutcome = "success";
      if (!mountedRef.current || navigatingRef.current) return;
      if (response.status === "incomplete") {
        completionPendingRef.current = false;
        setCompletionPending(false);
        setQuestionError(`Не все ответы подтверждены. Проверьте секцию ${response.sectionIndex + 1} и повторите завершение.`);
        if (activeQuestion) startQuestionTimer(activeQuestion.id);
      } else if (response.status === "processing") {
        setQuestionError("Результаты ещё обрабатываются. Можно повторить проверку через несколько секунд.");
      } else if (response.status === "scoring_failed") {
        setQuestionError("Расчёт результатов временно не выполнен. Ответы сохранены — повторите обработку.");
      } else if (response.status === "expired") {
        // Keep the existing time-expired scoring/event path, not a new scoring implementation.
        const expired = await postControl({ ...identity(), operation: "expire", clientEventId: createId() });
        if (mountedRef.current && !navigatingRef.current) applyControlResponse(expired);
      } else applyControlResponse(response);
    } catch {
      if (mountedRef.current) setQuestionError("Не удалось завершить тест. Ответы уже сохранены — повторите завершение.");
    } finally {
      completionSubmittingRef.current = false;
      reportClientOperation("assessment.complete", performance.now() - completionStartedAt, completionOutcome);
      if (mountedRef.current) setCompletionSubmitting(false);
    }
  }

  async function completeOneQuestionSession() {
    if (completionEnabled) { await completeSavedSession(); return; }
    setQuestionError(null);
    setSaveState("saving");
    try {
      const response = await postControl({ ...identity(), operation: "complete" });
      applyControlResponse(response);
      if (response.status === "active") {
        setSaveState("saved");
      }
    } catch {
      setSaveState(navigator.onLine ? "error" : "offline");
      setQuestionError(
        navigator.onLine
          ? "Не удалось завершить тест. Повторите попытку."
          : "Нет соединения. Ответы сохранены; завершите тест после восстановления сети.",
      );
    }
  }

  async function handleOneQuestionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = activeQuestion;
    if (!question || lockState !== "active" || saveState === "saving" || sectionRequestRef.current || questionSubmittingRef.current) {
      return;
    }

    const form = event.currentTarget;
    const answer = draftForQuestion(form, question);
    if ((question.isRequired || question.remediationParentId) && !hasDraftAnswer(question, answer)) {
      setQuestionError("Выберите или укажите ответ.");
      form.reportValidity();
      return;
    }

    const timeSpentSeconds = questionTimeSeconds(question.id);
    setQuestionError(null);
    setSaveState("saving");
    questionSubmittingRef.current = true;

    try {
      const response = await postControl({
        ...identity(),
        answer,
        finalize: true,
        operation: "autosave",
        questionId: question.id,
        ...(timeSpentSeconds === undefined ? {} : { timeSpentSeconds }),
      });
      applyControlResponse(response);
      if (response.status !== "active") {
        return;
      }

      const nextSavedAnswer = savedAnswerFromDraft(
        question,
        answer,
        response.answerIsCorrect ?? null,
        timeSpentSeconds ?? null,
      );
      const nextAnswers = { ...sessionAnswers, [question.id]: nextSavedAnswer };
      const nextVisibleQuestions = (section?.questions ?? []).filter(
        (entry) =>
          !entry.remediationParentId ||
          nextAnswers[entry.remediationParentId]?.remediationRequired === true,
      );
      const savedQuestionIndex = nextVisibleQuestions.findIndex(
        (entry) => entry.id === question.id,
      );
      const nextQuestionIndex = savedQuestionIndex + 1;

      markQuestionTimeSaved(question.id, timeSpentSeconds);
      questionDirtyRef.current = false;
      setSessionAnswers(nextAnswers);
      setRemediationFeedback((current) => {
        const next = new Map(current);
        if (response.incorrectFeedback) {
          next.set(question.id, response.incorrectFeedback);
        } else {
          next.delete(question.id);
        }
        return next;
      });
      setSavedAt(response.savedAt ?? new Date().toISOString());
      setSaveState("saved");

      if (nextQuestionIndex < nextVisibleQuestions.length) {
        setCurrentQuestionIndex(nextQuestionIndex);
        return;
      }

      if (sectionIndex < sectionCount - 1) {
        if (softNavigation) {
          await navigateToSection(sectionIndex + 1, presentationSettings.allowBack && reviewMode);
          return;
        }
        navigatingRef.current = true;
        window.location.assign(
          `${assessmentPath}/test/${sessionId}?section=${sectionIndex + 1}${
            presentationSettings.allowBack && reviewMode ? "&review=1" : ""
          }`,
        );
        return;
      }

      await completeOneQuestionSession();
    } catch (error) {
      setSaveState(navigator.onLine ? "error" : "offline");
      setQuestionError(
        navigator.onLine
          ? error instanceof Error
            ? error.message
            : "Не удалось сохранить ответ. Он остался на экране — повторите попытку."
          : "Нет соединения. Ответ остался на экране — повторите после восстановления сети.",
      );
      startQuestionTimer(question.id);
    } finally {
      questionSubmittingRef.current = false;
    }
  }

  useEffect(() => {
    const clear = () => sectionPrefetch.clear();
    if (!sectionPrefetchEnabled || !softNavigation || lockState !== "active" || reviewMode
      || !section || sectionIndex + 1 >= sectionCount) { clear(); return; }
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!navigator.onLine || connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) { clear(); return; }
    const timer = setTimeout(() => {
      if (!sectionRequestRef.current && !navigatingRef.current && !completionPendingRef.current && navigator.onLine) {
        void sectionPrefetch.start({ assessmentType, token, sessionId, sectionIndex });
      }
    }, 500);
    window.addEventListener("offline", clear);
    return () => { clearTimeout(timer); window.removeEventListener("offline", clear); clear(); };
  }, [sectionPrefetch, sectionPrefetchEnabled, softNavigation, lockState, reviewMode, section, sectionIndex, sectionCount, assessmentType, token, sessionId]);

  async function navigateToSection(index: number, review: boolean, historyMode: "push" | "replace" = "push") {
    const restoreUrl = () => {
      if (historyMode === "replace") window.history.replaceState(null, "", currentSectionUrlRef.current);
    };
    if (!softNavigation || !mountedRef.current || sectionRequestRef.current || navigatingRef.current || completionPendingRef.current || lockState !== "active") {
      restoreUrl(); return;
    }
    if (questionDirtyRef.current || (historyMode === "replace"
      && (questionSubmittingRef.current || saveChainsRef.current.size > 0))) {
      setQuestionError("Подтвердите текущий ответ перед переходом. Введенные данные остались на экране.");
      restoreUrl(); return;
    }
    if (!presentationSettings.allowBack && (index < sectionIndex || review)) {
      setQuestionError("Возврат к предыдущим вопросам отключен для этого теста.");
      restoreUrl(); return;
    }
    // A browser Back entry was originally created in resume mode. Re-enter it as
    // review when allowed, otherwise SQL correctly sends us to the unfinished section.
    if (isOneQuestion && historyMode === "replace" && presentationSettings.allowBack && index < sectionIndex) review = true;
    const controller = new AbortController();
    sectionRequestRef.current = controller;
    setSectionLoading(true);
    setQuestionError(null);
    pauseQuestionTimer();
    const startedAt = performance.now();
    try {
      const cached = sectionPrefetchEnabled && !review
        ? sectionPrefetch.ready({ assessmentType, token, sessionId, sectionIndex }, index) : undefined;
      // Never wait for speculative work on the critical path.
      sectionPrefetch.abortPending();
      const next = await fetchAssessmentSection({ assessmentType, token, sessionId, sectionIndex: index, review }, controller.signal, cached);
      if (controller.signal.aborted || navigatingRef.current) return;
      // Replace section-local form state only after a fresh, authorized response succeeds.
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
      elapsedQuestionTimeRef.current.clear();
      savedQuestionTimeRef.current = new Map(Object.entries(next.answers).map(([id, answer]) => [id, answer.timeSpentSeconds ?? 0]));
      activeTimedQuestionIdRef.current = null;
      activeTimerStartedAtRef.current = null;
      questionDirtyRef.current = false;
      setSessionAnswers(next.answers);
      setRemediationFeedback(new Map());
      setForcedChoiceCompletion({});
      setCurrentQuestionIndex(firstQuestionIndex(next));
      setNavigatedSection(next);
      setSaveState("idle");
      onSectionChange?.(next);
      const url = sectionUrl(testPath, next.sectionIndex, next.reviewMode);
      if (historyMode === "push" && url !== currentSectionUrlRef.current) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
      currentSectionUrlRef.current = url;
      window.scrollTo({ top: 0, behavior: "auto" });
      reportClientOperation("assessment.section_navigation", performance.now() - startedAt, "success");
    } catch (error) {
      if (controller.signal.aborted) return;
      restoreUrl();
      setQuestionError(error instanceof Error ? error.message : "Не удалось загрузить секцию. Повторите переход.");
      if (activeQuestion) startQuestionTimer(activeQuestion.id);
      reportClientOperation("assessment.section_navigation", performance.now() - startedAt, "failure");
    } finally {
      if (sectionRequestRef.current === controller) {
        sectionRequestRef.current = null;
        if (!controller.signal.aborted) setSectionLoading(false);
      }
    }
  }

  const navigateSectionRef = useRef(navigateToSection);
  useEffect(() => { navigateSectionRef.current = navigateToSection; });
  useEffect(() => {
    if (!softNavigation) return;
    window.history.replaceState(null, "", currentSectionUrlRef.current);
    const handlePop = () => {
      const url = new URL(window.location.href);
      if (url.pathname !== testPath) return; // Leaving this test belongs to the Next router.
      void navigateSectionRef.current(requestedSectionIndex(url.searchParams.get("section") ?? undefined), url.searchParams.get("review") === "1", "replace");
    };
    window.addEventListener("popstate", handlePop);
    return () => {
      window.removeEventListener("popstate", handlePop);
      sectionRequestRef.current?.abort();
    };
  }, [softNavigation, testPath]);

  function goToPreviousQuestion() {
    if (!presentationSettings.allowBack || !activeQuestion || sectionRequestRef.current || questionSubmittingRef.current) {
      return;
    }
    if (softNavigation && questionDirtyRef.current) {
      setQuestionError("Подтвердите текущий ответ перед переходом. Введенные данные остались на экране.");
      return;
    }
    pauseQuestionTimer();
    setQuestionError(null);
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      return;
    }
    if (sectionIndex > 0) {
      if (softNavigation) {
        void navigateToSection(sectionIndex - 1, true);
        return;
      }
      navigatingRef.current = true;
      window.location.assign(
        `${assessmentPath}/test/${sessionId}?section=${sectionIndex - 1}&review=1`,
      );
    }
  }

  const activeRemediationParent = activeQuestion?.remediationParentId
    ? questionsById.get(activeQuestion.remediationParentId) ?? null
    : null;
  const activeRemediationFeedback = activeRemediationParent
    ? remediationFeedback.get(activeRemediationParent.id) ??
      activeRemediationParent.incorrectFeedback
    : null;
  const activeQuestionPosition = activeQuestion
    ? (section?.questions.findIndex((question) => question.id === activeQuestion.id) ?? -1)
    : -1;
  const activeContentBlocks =
    activeQuestionPosition >= 0
      ? (section?.contentBlocks ?? []).filter(
          (block) => block.positionIndex === activeQuestionPosition,
        )
      : [];
  const trailingContentBlocks = (section?.contentBlocks ?? []).filter(
    (block) => block.positionIndex === (section?.questions.length ?? 0),
  );

  const saveLabel =
    saveState === "saving"
      ? "Сохраняем ответы..."
      : saveState === "saved"
        ? `Сохранено${savedAt ? ` в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(savedAt))}` : ""}`
        : saveState === "offline"
          ? "Нет соединения — повторим автоматически"
          : saveState === "error"
            ? "Не удалось сохранить — продолжаем попытки"
            : isOneQuestion
              ? "Ответ сохраняется по кнопке «Ответить и далее»"
              : "Автосохранение включено";
  const completeEmptyAction =
    assessmentType === "employee"
      ? completeEmptyEmployeeAssessmentSessionAction
      : completeEmptySessionAction;
  const saveSectionAction =
    assessmentType === "employee"
      ? saveEmployeeAssessmentSectionAction
      : saveCandidateSectionAction;

  async function handleSectionSubmit(event: FormEvent<HTMLFormElement>) {
    if (!softNavigation || legacySubmissionReadyRef.current) {
      navigatingRef.current = true;
      return;
    }
    event.preventDefault();
    if (!section || sectionSubmittingRef.current || sectionRequestRef.current || lockState !== "active") return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const direction = submitter?.value === "previous" ? "previous" : "next";
    if (direction === "previous" && !presentationSettings.allowBack) return;
    const drafts = visibleQuestions.map(question => ({ questionId: question.id,
      answer: draftForQuestion(form, question), timeSpentSeconds: questionTimeSeconds(question.id) }));
    if (visibleQuestions.some(question => (question.isRequired || question.remediationParentId)
      && !hasDraftAnswer(question, drafts.find(draft => draft.questionId === question.id)!.answer))) {
      setQuestionError("Ответьте на обязательные вопросы текущей секции.");
      form.reportValidity();
      return;
    }
    sectionSubmittingRef.current = true;
    questionSubmittingRef.current = true;
    setSectionSaving(true);
    setQuestionError(null);
    pauseQuestionTimer();
    try {
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
      // Let writes already sent finish before the authoritative batch. Retries can
      // schedule another timer, so clear timers again after draining all chains.
      await Promise.all([...saveChainsRef.current.values()]);
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
      if (!mountedRef.current || navigatingRef.current) return;
      const response = await saveAssessmentSection({ ...identity(), sectionId: section.id, direction, answers: drafts });
      if (!mountedRef.current || navigatingRef.current) return;
      if (response.status !== "active") {
        applyControlResponse(response.status === "blocked" ? response : await postControl({ ...identity(), operation: "heartbeat" }));
        return;
      }
      applyControlResponse(response);
      for (const draft of drafts) markQuestionTimeSaved(draft.questionId, draft.timeSpentSeconds);
      setSavedAt(response.savedAt);
      setSaveState("saved");
      questionDirtyRef.current = false;
      if (direction === "next" && sectionIndex === sectionCount - 1 && !response.needsRemediation) {
        if (completionEnabled) { await completeSavedSession(); return; }
        // The last batch is confirmed, including remediation. Keep completion/scoring
        // on the native Server Action path; its repeated save is idempotent.
        legacySubmissionReadyRef.current = true;
        try { form.requestSubmit(submitter); } finally { legacySubmissionReadyRef.current = false; }
        return;
      }
      await navigateToSection(response.nextSectionIndex, false);
    } catch {
      if (!mountedRef.current) return;
      setSaveState(navigator.onLine ? "error" : "offline");
      setQuestionError("Не удалось сохранить секцию. Проверьте ответы и повторите попытку — введенные данные остались на экране.");
    } finally {
      sectionSubmittingRef.current = false;
      questionSubmittingRef.current = false;
      if (mountedRef.current && !navigatingRef.current) setSectionSaving(false);
    }
  }

  const controlPanel = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
        <Timer className="size-5 text-primary" aria-hidden="true" />
        <div>
          <p className="text-xs text-muted-foreground">Осталось времени</p>
          <p className="font-mono text-lg font-semibold" aria-live="polite">
            {remainingLabel(remainingSeconds)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
        {saveState === "offline" || saveState === "error" ? (
          <CloudOff className="size-5 text-destructive" aria-hidden="true" />
        ) : saveState === "saving" ? (
          <Cloud className="size-5 text-primary" aria-hidden="true" />
        ) : (
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        )}
        <div>
          <p className="text-xs text-muted-foreground">Состояние ответов</p>
          <p className="text-sm font-medium" aria-live="polite">{saveLabel}</p>
        </div>
      </div>
    </div>
  );

  if (terminalNavigating) return <p role="status" className="rounded-lg border p-6">Переходим к следующему этапу...</p>;

  if (lockState !== "active") {
    const blocked = lockState === "blocked";
    return (
      <div className="space-y-4">
        {controlPanel}
        <Card>
          <CardHeader>
            <CardTitle>
              {blocked
                ? "Тест уже открыт в другой вкладке или на другом устройстве"
                : lockState === "expiring"
                  ? "Время завершилось"
                  : lockState === "error"
                    ? "Не удалось проверить сессию"
                    : "Проверяем активную сессию"}
            </CardTitle>
            <CardDescription>
              {blocked
                ? "Закройте предыдущую вкладку. Через 90 секунд без активности тест можно будет продолжить здесь; таймер не останавливается."
                : lockState === "expiring"
                  ? "Сохраняем ответы и завершаем текущий тест."
                  : lockState === "error"
                    ? "Проверьте соединение и повторите попытку. Таймер продолжает идти."
                    : "Это займет несколько секунд."}
            </CardDescription>
          </CardHeader>
          {(blocked || lockState === "error") ? (
            <CardContent className="pt-6">
              <Button onClick={() => void claimSession()} type="button">Повторить проверку</Button>
            </CardContent>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {controlPanel}

      {timerWarning ? (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm" role="status">
          {timerWarning === "one" ? "Осталась 1 минута." : "Осталось 5 минут."}{" "}
          {isOneQuestion ? "Не забудьте подтвердить текущий ответ." : "Ответы сохраняются автоматически."}
        </p>
      ) : null}

      {integrityNotice ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <ClipboardX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{integrityNotice}</span>
        </p>
      ) : null}

      {sectionLoading ? <p role="status" className="text-sm text-muted-foreground">Загружаем секцию...</p> : null}
      {sectionSaving ? <p role="status" className="text-sm text-muted-foreground">Сохраняем секцию...</p> : null}
      {completionPending ? <div className="space-y-3 rounded-lg border p-4" aria-busy={completionSubmitting}>
        <p role="status">{completionSubmitting ? "Завершаем тест..." : "Ответы сохранены. Подтвердите завершение теста."}</p>
        {questionError ? <p role="alert" className="text-sm text-destructive">{questionError}</p> : null}
        <Button type="button" disabled={completionSubmitting} onClick={() => void completeSavedSession(true)}>Повторить завершение</Button>
      </div> : null}

      <div
        aria-busy={sectionLoading || sectionSaving}
        inert={completionPending || sectionLoading || sectionSaving || (softNavigation && isOneQuestion && saveState === "saving") || undefined}
        onCopyCapture={(event) => handleClipboard(event, "clipboard_copy")}
        onCutCapture={(event) => handleClipboard(event, "clipboard_cut")}
        onPasteCapture={(event) => handleClipboard(event, "clipboard_paste")}
      >
        {!section ? (
          <Card>
            <CardHeader>
              <CardTitle>В тесте нет вопросов</CardTitle>
              <CardDescription>Перейдите к следующему тесту в пакете оценки.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={completeEmptyAction} onSubmit={event => {
                if (completionEnabled) { event.preventDefault(); void completeSavedSession(); }
                else navigatingRef.current = true;
              }}>
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="clientId" type="hidden" value={clientId} />
                <input name="deviceId" type="hidden" value={deviceId} />
                <PendingSubmitButton className="w-full sm:w-auto" pendingText="Переходим..." type="submit">
                  Продолжить
                </PendingSubmitButton>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription>Секция {sectionIndex + 1}</CardDescription>
              <CardTitle className="text-lg leading-snug">{section.title}</CardTitle>
              {section.description ? (
                <RichTextContent className="text-sm text-muted-foreground" value={section.description} />
              ) : null}
            </CardHeader>
            <CardContent className="pt-6">
              {isOneQuestion ? (
                activeQuestion ? (
                  <form
                    className="space-y-6"
                    key={activeQuestion.id}
                    onChangeCapture={handleOneQuestionChange}
                    onSubmit={handleOneQuestionSubmit}
                    ref={formRef}
                  >
                    <p className="text-sm font-medium text-muted-foreground">
                      Вопрос {questionOffset + currentQuestionIndex + 1} из{" "}
                      {totalVisibleQuestionCount}
                    </p>

                    {sectionIndex === 0 && currentQuestionIndex === 0 && testInstructions ? (
                      <RichTextContent
                        className="rounded-lg border bg-muted/40 p-4 text-sm"
                        value={testInstructions}
                      />
                    ) : null}

                    {activeContentBlocks.length > 0 ? (
                      <div className="space-y-4">
                        {activeContentBlocks.map((block) => (
                          <div
                            className="border-l-4 border-l-primary bg-muted/30 px-4 py-3"
                            key={block.id}
                          >
                            <h3 className="font-semibold">{block.title}</h3>
                            {block.description ? (
                              <RichTextContent
                                className="mt-1 text-sm text-muted-foreground"
                                value={block.description}
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {activeRemediationFeedback ? (
                      <div
                        className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
                        role="status"
                      >
                        <p className="text-sm font-semibold">Разбор ответа</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm">
                          {activeRemediationFeedback}
                        </p>
                      </div>
                    ) : null}

                    <div className="space-y-4" data-question-id={activeQuestion.id}>
                      <div>
                        {activeQuestion.remediationParentId ? (
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                            Повторный вопрос
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap text-lg font-medium">
                          {activeQuestion.text}
                          {activeQuestion.isRequired ? (
                            <span className="ml-1 text-destructive">*</span>
                          ) : null}
                        </p>
                        {activeQuestion.description ? (
                          <RichTextContent
                            className="mt-2 text-sm text-muted-foreground"
                            value={activeQuestion.description}
                          />
                        ) : null}
                      </div>
                      <QuestionResponseFields
                        answer={sessionAnswers[activeQuestion.id] ?? null}
                        inputPrefix={`q_${activeQuestion.id}`}
                        key={activeQuestion.id}
                        onAnswerChange={() => {
                          if (softNavigation) questionDirtyRef.current = true;
                          else scheduleAutosave(activeQuestion.id, 0);
                        }}
                        question={
                          activeQuestion.remediationParentId
                            ? { ...activeQuestion, isRequired: true }
                            : activeQuestion
                        }
                      />
                    </div>

                    {questionError ? (
                      <p
                        className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                        role="alert"
                      >
                        {questionError}
                      </p>
                    ) : null}

                    <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-between">
                      {presentationSettings.allowBack &&
                      (currentQuestionIndex > 0 || sectionIndex > 0) ? (
                        <Button
                          className="w-full sm:w-auto"
                          disabled={saveState === "saving"}
                          onClick={goToPreviousQuestion}
                          type="button"
                          variant="outline"
                        >
                          Назад
                        </Button>
                      ) : (
                        <span className="hidden sm:block" />
                      )}
                      <Button
                        className="w-full sm:w-auto"
                        disabled={
                          saveState === "saving" ||
                          (activeQuestion.questionType === "forced_choice" &&
                            activeQuestion.isRequired &&
                            !isActiveAnswerComplete)
                        }
                        type="submit"
                      >
                        {saveState === "saving" ? "Сохраняем ответ..." : "Ответить и далее"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    {trailingContentBlocks.map((block) => (
                      <div
                        className="border-l-4 border-l-primary bg-muted/30 px-4 py-3"
                        key={block.id}
                      >
                        <h3 className="font-semibold">{block.title}</h3>
                        {block.description ? (
                          <RichTextContent
                            className="mt-1 text-sm text-muted-foreground"
                            value={block.description}
                          />
                        ) : null}
                      </div>
                    ))}
                    <p className="text-sm text-muted-foreground">
                      Все доступные вопросы секции сохранены. Продолжите прохождение.
                    </p>
                    {questionError ? (
                      <p className="text-sm text-destructive" role="alert">{questionError}</p>
                    ) : null}
                    <Button
                      disabled={saveState === "saving"}
                      onClick={() => {
                        if (softNavigation && sectionIndex < sectionCount - 1) void navigateToSection(sectionIndex + 1, presentationSettings.allowBack && reviewMode);
                        else void completeOneQuestionSession();
                      }}
                      type="button"
                    >
                      {saveState === "saving" ? "Завершаем..." : softNavigation && sectionIndex < sectionCount - 1 ? "Следующая секция" : "Завершить тест"}
                    </Button>
                  </div>
                )
              ) : (
              <form
                action={saveSectionAction}
                className="space-y-8"
                onBlurCapture={handleBlur}
                onChangeCapture={handleChange}
                onInputCapture={handleInput}
                onSubmit={handleSectionSubmit}
                ref={formRef}
              >
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="sectionIndex" type="hidden" value={sectionIndex} />
                <input name="clientId" type="hidden" value={clientId} />
                <input name="deviceId" type="hidden" value={deviceId} />
                {sectionContent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">В этой секции нет вопросов.</p>
                ) : (
                  sectionContent.map((item) => {
                    if (item.kind === "content-block") {
                      return (
                        <div
                          className="border-l-4 border-l-primary bg-muted/30 px-4 py-3"
                          key={item.block.id}
                        >
                          <h3 className="font-semibold">{item.block.title}</h3>
                          {item.block.description ? (
                            <RichTextContent
                              className="mt-1 text-sm text-muted-foreground"
                              value={item.block.description}
                            />
                          ) : null}
                        </div>
                      );
                    }

                    const question = item.question;
                    const index = visibleQuestions.findIndex((entry) => entry.id === question.id);
                    return (
                    <div
                      className="space-y-4 border-b pb-8 last:border-0 last:pb-0"
                      data-question-id={question.id}
                      key={question.id}
                    >
                      <div>
                        {question.remediationParentId ? (
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                            Повторный вопрос
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap font-medium">
                          {index + 1}. {question.text}
                          {question.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
                        </p>
                        {question.description ? (
                          <RichTextContent
                            className="mt-1 text-sm text-muted-foreground"
                            value={question.description}
                          />
                        ) : null}
                      </div>
                      <QuestionResponseFields
                        answer={sessionAnswers[question.id] ?? null}
                        inputPrefix={`q_${question.id}`}
                        onAnswerChange={() => {
                          if (softNavigation) questionDirtyRef.current = true;
                          scheduleAutosave(question.id, 0);
                        }}
                        question={
                          question.remediationParentId
                            ? { ...question, isRequired: true }
                            : question
                        }
                      />
                      {sessionAnswers[question.id]?.remediationRequired && question.incorrectFeedback ? (
                        <div
                          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
                          role="status"
                        >
                          <p className="text-sm font-semibold">Разбор ответа</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm">
                            {question.incorrectFeedback}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    );
                  })
                )}
                {questionError ? <p className="text-sm text-destructive" role="alert">{questionError}</p> : null}
                <div className="-mx-6 -mb-6 flex flex-col-reverse gap-3 border-t bg-background/95 px-6 py-4 sm:mx-0 sm:mb-0 sm:flex-row sm:justify-between sm:border-0 sm:p-0">
                  {sectionIndex > 0 && presentationSettings.allowBack ? (
                    <PendingSubmitButton
                      className="w-full sm:w-auto"
                      name="direction"
                      pendingText="Сохраняем..."
                      type="submit"
                      value="previous"
                    >
                      Назад
                    </PendingSubmitButton>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  <PendingSubmitButton
                    className="w-full sm:w-auto"
                    disabled={!areSectionForcedChoicesComplete}
                    name="direction"
                    pendingText="Сохраняем ответы..."
                    type="submit"
                    value="next"
                  >
                    {sectionIndex === sectionCount - 1 ? "Завершить тест" : "Сохранить и далее"}
                  </PendingSubmitButton>
                </div>
              </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {tabWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <div
            aria-describedby="tab-warning-description"
            aria-labelledby="tab-warning-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl"
            role="alertdialog"
          >
            <ShieldAlert className="size-8 text-destructive" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold" id="tab-warning-title">Не покидайте страницу теста</h2>
            <p className="mt-2 text-sm text-muted-foreground" id="tab-warning-description">
              Переход в другую вкладку или приложение зафиксирован и будет показан работодателю в отчете. Общий таймер теста продолжал идти.
            </p>
            <Button className="mt-5 w-full" onClick={() => setTabWarning(false)} type="button">
              Продолжить тест
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
