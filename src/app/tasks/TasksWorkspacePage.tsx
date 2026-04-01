
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type UserRole = "user" | "admin" | "god";
type TaskStatus = "new" | "in_progress" | "blocked" | "review" | "done" | "canceled";
type TaskPriority = "low" | "medium" | "high";
type TaskBucket = "in_progress" | "done" | "queue";

type CurrentUser = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
};

type TaskGroup = {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

type TaskMember = {
  id: number;
  name: string;
  username: string;
  role: UserRole;
};

type TaskItem = {
  id: number;
  group_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creator_id: number;
  assignee_id: number | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  creator_name: string;
  assignee_name: string | null;
  comments_count?: number;
};

type TaskComment = {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
  created_at: string;
  author_name: string;
  author_username: string;
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-indigo-200 bg-indigo-50 text-indigo-700",
  low: "border-slate-200 bg-slate-100 text-slate-600",
};

const BUCKET_LABELS: Record<TaskBucket, string> = {
  in_progress: "В работе",
  done: "Завершенные",
  queue: "В очереди",
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function taskBucketFromStatus(status: TaskStatus): TaskBucket {
  if (status === "done" || status === "canceled") return "done";
  if (status === "in_progress" || status === "blocked" || status === "review") {
    return "in_progress";
  }
  return "queue";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU");
}

async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload as T;
}

export default function TasksWorkspacePage() {
  const router = useRouter();

  const [me, setMe] = useState<CurrentUser | null>(null);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [activeBucket, setActiveBucket] = useState<TaskBucket>("in_progress");
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [sendingTransfer, setSendingTransfer] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createPriority, setCreatePriority] = useState<TaskPriority>("medium");

  const [transferTask, setTransferTask] = useState<TaskItem | null>(null);
  const [transferAssigneeId, setTransferAssigneeId] = useState<number | null>(null);
  const [transferComment, setTransferComment] = useState("");

  const [commentsTask, setCommentsTask] = useState<TaskItem | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) || null,
    [activeGroupId, groups]
  );

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) || null,
    [members, selectedMemberId]
  );

  const canManageSelectedTasks = useMemo(() => {
    if (!me || !selectedMemberId) return false;
    return selectedMemberId === me.id;
  }, [me, selectedMemberId]);

  const transferOptions = useMemo(() => {
    if (!transferTask) return members;
    return members.filter((member) => member.id !== transferTask.assignee_id);
  }, [members, transferTask]);

  const tasksForSelectedMember = useMemo(() => {
    if (!selectedMemberId) return [];
    return tasks.filter((task) => task.assignee_id === selectedMemberId);
  }, [selectedMemberId, tasks]);

  const visibleTasks = useMemo(
    () => tasksForSelectedMember.filter((task) => taskBucketFromStatus(task.status) === activeBucket),
    [activeBucket, tasksForSelectedMember]
  );

  const patchTaskInState = useCallback((nextTask: TaskItem) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === nextTask.id
          ? {
              ...task,
              ...nextTask,
              comments_count: nextTask.comments_count ?? task.comments_count ?? 0,
            }
          : task
      )
    );
  }, []);

  const loadMembers = useCallback(async (groupId: number) => {
    const result = await apiJson<{ members: TaskMember[] }>(
      `/api/task-groups/members?groupId=${groupId}`
    );
    setMembers(result.members);
  }, []);

  const loadTasks = useCallback(async (groupId: number) => {
    setLoadingTasks(true);
    try {
      const params = new URLSearchParams();
      params.set("groupId", String(groupId));
      const result = await apiJson<{ tasks: TaskItem[] }>(`/api/tasks?${params.toString()}`);
      setTasks(result.tasks.map((task) => ({ ...task, comments_count: task.comments_count ?? 0 })));
    } catch (err: any) {
      setTasks([]);
      setError(err?.message || "Не удалось загрузить задачи");
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    setError("");
    try {
      const [meRes, groupsRes] = await Promise.all([
        apiJson<{ user: CurrentUser | null }>("/api/auth/me"),
        apiJson<{ groups: TaskGroup[] }>("/api/task-groups"),
      ]);

      setMe(meRes.user);
      setGroups(groupsRes.groups);

      if (groupsRes.groups.length === 0) {
        setActiveGroupId(null);
        return;
      }

      const validIds = new Set(groupsRes.groups.map((group) => group.id));
      const urlGroupId = Number(new URL(window.location.href).searchParams.get("groupId"));
      const localStored = Number(localStorage.getItem("tasks.activeGroupId"));

      const nextGroupId =
        Number.isFinite(urlGroupId) && validIds.has(urlGroupId)
          ? urlGroupId
          : Number.isFinite(localStored) && validIds.has(localStored)
            ? localStored
            : groupsRes.groups[0].id;

      setActiveGroupId(nextGroupId);
    } catch (err: any) {
      setError(err?.message || "Не удалось загрузить страницу задач");
    } finally {
      setLoadingBootstrap(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!activeGroupId) return;
    localStorage.setItem("tasks.activeGroupId", String(activeGroupId));
    router.replace(`/tasks?groupId=${activeGroupId}`, { scroll: false });
  }, [activeGroupId, router]);

  useEffect(() => {
    if (!activeGroupId) {
      setMembers([]);
      setTasks([]);
      setSelectedMemberId(null);
      return;
    }

    void Promise.all([loadMembers(activeGroupId), loadTasks(activeGroupId)]);
  }, [activeGroupId, loadMembers, loadTasks]);

  useEffect(() => {
    if (members.length === 0) {
      setSelectedMemberId(null);
      return;
    }

    setSelectedMemberId((prev) => {
      if (prev && members.some((member) => member.id === prev)) return prev;
      if (me && members.some((member) => member.id === me.id)) return me.id;
      return members[0].id;
    });
  }, [me, members]);

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeGroupId || !me) return;
    if (!createTitle.trim()) {
      setError("Введите название задачи");
      return;
    }

    setCreatingTask(true);
    setError("");
    setMessage("");
    try {
      await apiJson<{ task: TaskItem }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          groupId: activeGroupId,
          title: createTitle.trim(),
          priority: createPriority,
          assigneeId: me.id,
          description: "",
        }),
      });

      setCreateOpen(false);
      setCreateTitle("");
      setCreatePriority("medium");
      setActiveBucket("queue");
      setSelectedMemberId(me.id);
      setMessage("Задача создана и добавлена во вкладку «В очереди»");
      await loadTasks(activeGroupId);
    } catch (err: any) {
      setError(err?.message || "Не удалось создать задачу");
    } finally {
      setCreatingTask(false);
    }
  };

  const updateStatus = async (task: TaskItem, nextStatus: TaskStatus) => {
    if (task.status === nextStatus) return;

    setSavingStatusId(task.id);
    setError("");
    setMessage("");
    try {
      const result = await apiJson<{ task: TaskItem }>("/api/tasks/status", {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, status: nextStatus }),
      });
      patchTaskInState(result.task);
      setMessage("Статус задачи обновлён");
    } catch (err: any) {
      setError(err?.message || "Не удалось изменить статус задачи");
    } finally {
      setSavingStatusId(null);
    }
  };

  const openTransferModal = (task: TaskItem) => {
    setTransferTask(task);
    const fallback =
      members.find((member) => member.id !== task.assignee_id)?.id || members[0]?.id || null;
    setTransferAssigneeId(fallback);
    setTransferComment("");
  };

  const submitTransfer = async () => {
    if (!transferTask) return;
    if (!transferAssigneeId) {
      setError("Выберите пользователя");
      return;
    }
    if (!transferComment.trim()) {
      setError("Добавьте комментарий к передаче");
      return;
    }

    setSendingTransfer(true);
    setError("");
    setMessage("");
    try {
      const result = await apiJson<{ task: TaskItem }>("/api/tasks/transfer", {
        method: "POST",
        body: JSON.stringify({
          taskId: transferTask.id,
          assigneeId: transferAssigneeId,
          comment: transferComment.trim(),
        }),
      });
      patchTaskInState(result.task);
      setTransferTask(null);
      setMessage("Задача передана");
    } catch (err: any) {
      setError(err?.message || "Не удалось передать задачу");
    } finally {
      setSendingTransfer(false);
    }
  };

  const openCommentsModal = async (task: TaskItem) => {
    setCommentsTask(task);
    setComments([]);
    setCommentDraft("");
    setLoadingComments(true);
    setError("");
    try {
      const result = await apiJson<{ comments: TaskComment[] }>(
        `/api/tasks/comments?taskId=${task.id}`
      );
      setComments(result.comments);
    } catch (err: any) {
      setError(err?.message || "Не удалось загрузить комментарии");
    } finally {
      setLoadingComments(false);
    }
  };

  const addComment = async () => {
    if (!commentsTask) return;
    if (!commentDraft.trim()) {
      setError("Введите комментарий");
      return;
    }

    setSendingComment(true);
    setError("");
    setMessage("");
    try {
      const result = await apiJson<{ comment: TaskComment }>("/api/tasks/comments", {
        method: "POST",
        body: JSON.stringify({ taskId: commentsTask.id, body: commentDraft.trim() }),
      });
      setComments((prev) => [...prev, result.comment]);
      setCommentDraft("");
      setTasks((prev) =>
        prev.map((task) =>
          task.id === commentsTask.id
            ? { ...task, comments_count: (task.comments_count ?? 0) + 1 }
            : task
        )
      );
      setMessage("Комментарий добавлен");
    } catch (err: any) {
      setError(err?.message || "Не удалось добавить комментарий");
    } finally {
      setSendingComment(false);
    }
  };

  return (
    <div className="h-full w-full py-3">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-3 rounded-3xl border border-slate-200/80 bg-white/70 p-3 backdrop-blur-sm">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {loadingBootstrap ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/60 text-sm text-slate-500">
            Загрузка...
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/60 p-6">
            <div className="max-w-xl text-center">
              <h2 className="text-lg font-semibold text-slate-800">Нет доступных групп задач</h2>
              <p className="mt-2 text-sm text-slate-600">
                Добавьте пользователя в task-группу через раздел администрирования.
              </p>
            </div>
          </div>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-3">
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroupId(group.id)}
                    className={cls(
                      "rounded-full px-4 py-1.5 text-xs transition",
                      activeGroupId === group.id
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-700 hover:bg-slate-100"
                    )}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 min-h-0 flex-1 rounded-2xl border border-slate-200 bg-white">
              <div className="grid h-full grid-cols-[minmax(0,2fr)_1px_minmax(0,1fr)]">
                <div className="flex min-h-0 flex-col p-4">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div />
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                      {(["in_progress", "done", "queue"] as TaskBucket[]).map((bucket) => (
                        <button
                          key={bucket}
                          type="button"
                          onClick={() => setActiveBucket(bucket)}
                          className={cls(
                            "rounded-full px-3 py-1 text-xs transition",
                            activeBucket === bucket
                              ? "bg-slate-900 text-white"
                              : "bg-white text-slate-700 hover:bg-slate-100"
                          )}
                        >
                          {BUCKET_LABELS[bucket]}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        disabled={!activeGroupId || !me}
                        className="flex h-8 w-8 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        title="Создать задачу"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {!canManageSelectedTasks && selectedMember && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      Вы просматриваете задачи пользователя {selectedMember.name}. Изменение статуса
                      недоступно.
                    </div>
                  )}

                  <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
                    {loadingTasks ? (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                        Загрузка задач...
                      </div>
                    ) : !selectedMemberId ? (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                        Выберите пользователя справа
                      </div>
                    ) : visibleTasks.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">
                        В выбранной вкладке пока нет задач
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visibleTasks.map((task) => {
                          const commentsCount = task.comments_count ?? 0;
                          const canStartTask = task.status === "new";
                          const canFinishTask =
                            task.status === "in_progress" ||
                            task.status === "blocked" ||
                            task.status === "review";

                          return (
                            <article
                              key={task.id}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="min-w-[220px] flex-1 text-sm text-slate-900">
                                  {task.title}
                                </div>

                                <span
                                  className={cls(
                                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                    PRIORITY_CLASSES[task.priority]
                                  )}
                                >
                                  {PRIORITY_LABELS[task.priority]}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => void openCommentsModal(task)}
                                  className={cls(
                                    "rounded-lg border px-2 py-1 text-xs transition",
                                    commentsCount > 0
                                      ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                                  )}
                                >
                                  {commentsCount > 0 ? `Комментарии (${commentsCount})` : "Комментарии"}
                                </button>

                                {canManageSelectedTasks && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openTransferModal(task)}
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                                    >
                                      Передать
                                    </button>

                                    {activeBucket === "queue" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          canStartTask
                                            ? void updateStatus(task, "in_progress")
                                            : undefined
                                        }
                                        disabled={!canStartTask || savingStatusId === task.id}
                                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                      >
                                        В работу
                                      </button>
                                    )}

                                    {activeBucket === "in_progress" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          canFinishTask ? void updateStatus(task, "done") : undefined
                                        }
                                        disabled={!canFinishTask || savingStatusId === task.id}
                                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                      >
                                        Завершить
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-200/90" />

                <aside className="min-h-0 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {activeGroup?.name ? `Пользователи: ${activeGroup.name}` : "Пользователи"}
                  </div>
                  <div className="mt-2 h-full overflow-auto pr-1">
                    {members.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                        В выбранной группе нет участников
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {members.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => setSelectedMemberId(member.id)}
                            className={cls(
                              "w-full rounded-xl border px-3 py-2 text-left transition",
                              selectedMemberId === member.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                            )}
                          >
                            <div className="text-sm font-medium">{member.name}</div>
                            <div
                              className={cls(
                                "text-xs",
                                selectedMemberId === member.id ? "text-white/80" : "text-slate-500"
                              )}
                            >
                              @{member.username}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </div>
          </section>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <form
            onSubmit={(event) => void createTask(event)}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-900">Создание задачи</h3>

            <div className="mt-3 space-y-2">
              <input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="Название задачи"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              />
              <select
                value={createPriority}
                onChange={(event) => setCreatePriority(event.target.value as TaskPriority)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              >
                <option value="high">Высокий приоритет</option>
                <option value="medium">Средний приоритет</option>
                <option value="low">Низкий приоритет</option>
              </select>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={creatingTask || !createTitle.trim()}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {creatingTask ? "Сохранение..." : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {transferTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Передача задачи</h3>
            <p className="mt-1 text-xs text-slate-500">{transferTask.title}</p>

            <div className="mt-3 space-y-2">
              <select
                value={transferAssigneeId || ""}
                onChange={(event) => setTransferAssigneeId(Number(event.target.value) || null)}
                disabled={transferOptions.length === 0}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              >
                {transferOptions.length === 0 && <option value="">Некому передавать</option>}
                {transferOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.username})
                  </option>
                ))}
              </select>
              <input
                value={transferComment}
                onChange={(event) => setTransferComment(event.target.value)}
                placeholder="Комментарий к передаче"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferTask(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void submitTransfer()}
                disabled={
                  sendingTransfer ||
                  !transferAssigneeId ||
                  !transferComment.trim() ||
                  transferOptions.length === 0
                }
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {sendingTransfer ? "Передача..." : "Передать"}
              </button>
            </div>
          </div>
        </div>
      )}
