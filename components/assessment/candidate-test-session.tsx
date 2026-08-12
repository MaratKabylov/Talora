"use client";

import { ClipboardX, Cloud, CloudOff, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
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
import type { FlowQuestion, FlowSection } from "@/lib/assessment/data";

type SavedAnswer = {
  answerJson: Record<string, unknown>;
  answerText: string | null;
  isCorrect: boolean | null;
  selectedOptionId: string | null;
};

type ControlResponse =
  | { deadlineAt: string | null; savedAt?: string; status: "active" }
  | { retryAfterSeconds: number; status: "blocked" }
  | { redirectTo: string; status: "redirect" };

type LockState = "checking" | "active" | "blocked" | "error" | "expiring";
type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

type CandidateTestSessionProps = {
  answers: Record<string, SavedAnswer>;
  initialDeadlineAt: string | null;
  section: FlowSection | null;
  sectionCount: number;
  sectionIndex: number;
  sessionId: string;
  token: string;
};

const DEVICE_STORAGE_KEY = "talvia_assessment_device_id";

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
  const response = await fetch("/api/assessment/session-control", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    keepalive,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Assessment control request failed.");
  }

  return (await response.json()) as ControlResponse;
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

function draftForQuestion(form: HTMLFormElement, question: FlowQuestion) {
  const formData = new FormData(form);
  const prefix = `q_${question.id}_`;

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

  const value = formData.get(`${prefix}answerText`);
  return { answerText: typeof value === "string" ? value : null };
}

export function CandidateTestSession({
  answers,
  initialDeadlineAt,
  section,
  sectionCount,
  sectionIndex,
  sessionId,
  token,
}: CandidateTestSessionProps) {
  const [clientId, setClientId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deadlineAt, setDeadlineAt] = useState(initialDeadlineAt);
  const [integrityNotice, setIntegrityNotice] = useState<string | null>(null);
  const [lockState, setLockState] = useState<LockState>("checking");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() =>
    initialDeadlineAt
      ? Math.max(0, Math.ceil((new Date(initialDeadlineAt).getTime() - Date.now()) / 1000))
      : null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
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
  const queueAutosaveRef = useRef<(questionId: string) => void>(() => undefined);
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
          answers[question.remediationParentId]?.isCorrect === false,
      ),
    [answers, section],
  );

  const applyControlResponse = useCallback((response: ControlResponse) => {
    if (response.status === "redirect") {
      navigatingRef.current = true;
      window.location.assign(response.redirectTo);
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
  }, []);

  const identity = useCallback(
    () => ({
      clientId: clientIdRef.current,
      deviceId: deviceIdRef.current,
      sessionId,
      token,
    }),
    [sessionId, token],
  );

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
  }, [applyControlResponse, sessionId, token]);

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

      if (seconds === 0 && !expiryRequestedRef.current) {
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
      if (lockState !== "active") {
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
        applyControlResponse(response);
      } catch {
        // A failed telemetry write must not discard the candidate's answers.
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
  }, [lockState, recordEvent]);

  const queueAutosave = useCallback(
    (questionId: string) => {
      const form = formRef.current;
      const question = questionsById.get(questionId);
      if (!form || !question || lockState !== "active") {
        return;
      }

      const answer = draftForQuestion(form, question);
      const previous = saveChainsRef.current.get(questionId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          pendingSavesRef.current += 1;
          setSaveState("saving");
          let lastError: unknown = null;

          for (const retryDelay of [0, 1_000, 3_000]) {
            if (retryDelay) {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
            try {
              const response = await postControl({
                ...identity(),
                answer,
                operation: "autosave",
                questionId,
              });
              applyControlResponse(response);
              if (response.status === "active") {
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
          if (lastError) {
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
    [applyControlResponse, identity, lockState, questionsById],
  );

  useEffect(() => {
    queueAutosaveRef.current = queueAutosave;
  }, [queueAutosave]);

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
      try {
        const response = await postControl({ ...identity(), operation: "heartbeat" });
        applyControlResponse(response);
      } catch {
        setSaveState(navigator.onLine ? "error" : "offline");
      }
    }

    const interval = window.setInterval(() => void heartbeat(), 30_000);
    const handleOffline = () => setSaveState("offline");
    const handleOnline = () => {
      void heartbeat();
      for (const question of section?.questions ?? []) {
        const timer = saveTimersRef.current.get(question.id);
        if (timer) {
          clearTimeout(timer);
        }
        saveTimersRef.current.set(question.id, setTimeout(() => queueAutosave(question.id), 0));
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [applyControlResponse, identity, lockState, queueAutosave, section]);

  useEffect(
    () => () => {
      for (const timer of saveTimersRef.current.values()) {
        clearTimeout(timer);
      }
    },
    [],
  );

  function handleInput(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    const delay =
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && ["text", "search"].includes(target.type))
        ? 800
        : 0;
    scheduleAutosave(questionIdFromTarget(target), delay);
  }

  function handleChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && ["text", "search"].includes(target.type))
    ) {
      return;
    }
    scheduleAutosave(questionIdFromTarget(target), 0);
  }

  function handleBlur(event: SyntheticEvent<HTMLFormElement>) {
    const questionId = questionIdFromTarget(event.target);
    if (questionId) {
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

  const saveLabel =
    saveState === "saving"
      ? "Сохраняем ответы..."
      : saveState === "saved"
        ? `Сохранено${savedAt ? ` в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(savedAt))}` : ""}`
        : saveState === "offline"
          ? "Нет соединения — повторим автоматически"
          : saveState === "error"
            ? "Не удалось сохранить — продолжаем попытки"
            : "Автосохранение включено";

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
          {timerWarning === "one" ? "Осталась 1 минута." : "Осталось 5 минут."} Ответы сохраняются автоматически.
        </p>
      ) : null}

      {integrityNotice ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm" role="alert">
          <ClipboardX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{integrityNotice}</span>
        </p>
      ) : null}

      <div
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
              <form action={completeEmptySessionAction} onSubmit={() => { navigatingRef.current = true; }}>
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
              <form
                action={saveCandidateSectionAction}
                className="space-y-8"
                onBlurCapture={handleBlur}
                onChangeCapture={handleChange}
                onInputCapture={handleInput}
                onSubmit={() => { navigatingRef.current = true; }}
                ref={formRef}
              >
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="sectionIndex" type="hidden" value={sectionIndex} />
                <input name="clientId" type="hidden" value={clientId} />
                <input name="deviceId" type="hidden" value={deviceId} />
                {visibleQuestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">В этой секции нет вопросов.</p>
                ) : (
                  visibleQuestions.map((question, index) => (
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
                        answer={answers[question.id] ?? null}
                        inputPrefix={`q_${question.id}`}
                        question={
                          question.remediationParentId
                            ? { ...question, isRequired: true }
                            : question
                        }
                      />
                      {answers[question.id]?.isCorrect === false && question.incorrectFeedback ? (
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
                  ))
                )}
                <div className="-mx-6 -mb-6 flex flex-col-reverse gap-3 border-t bg-background/95 px-6 py-4 sm:mx-0 sm:mb-0 sm:flex-row sm:justify-between sm:border-0 sm:p-0">
                  {sectionIndex > 0 ? (
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
                    name="direction"
                    pendingText="Сохраняем ответы..."
                    type="submit"
                    value="next"
                  >
                    {sectionIndex === sectionCount - 1 ? "Завершить тест" : "Сохранить и далее"}
                  </PendingSubmitButton>
                </div>
              </form>
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
              Переход в другую вкладку или приложение зафиксирован и будет показан работодателю в отчете. Таймер продолжал идти.
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
