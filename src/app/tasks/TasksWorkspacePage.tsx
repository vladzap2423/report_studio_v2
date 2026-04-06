
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppSelect from "@/app/components/AppSelect";
import { useAppToast, useToastSync } from "@/app/components/AppToastProvider";

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

type TaskQueueSignal = {
  groupId: number;
  latestActivityAt: string | null;
  queueCount: number;
};

type TaskStreamEvent = {
  type:
    | "task_created"
    | "task_updated"
    | "task_status_changed"
    | "task_transferred"
    | "task_comment_added";
  groupId: number;
  taskId: number;
  assigneeId: number | null;
  actorId: number | null;
  occurredAt: string;
  task?: TaskItem | null;
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

function getQueueSeenStorageKey(userId: number, groupId: number) {
  return `tasks.queueSeen:${userId}:${groupId}`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskBucketFromStatus(status: TaskStatus): TaskBucket {
  if (status === "done" || status === "canceled") return "done";
  if (status === "in_progress" || status === "blocked" || status === "review") {
    return "in_progress";
  }
  return "queue";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPriorityRank(priority: TaskPriority) {
  switch (priority) {
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function sortTaskItems(items: TaskItem[]) {
  return [...items].sort((a, b) => {
    const priorityDiff = getPriorityRank(a.priority) - getPriorityRank(b.priority);
    if (priorityDiff !== 0) return priorityDiff;

    const dueA = a.due_at ? toTimestamp(a.due_at) : Number.MAX_SAFE_INTEGER;
    const dueB = b.due_at ? toTimestamp(b.due_at) : Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) return dueA - dueB;

    return toTimestamp(b.updated_at) - toTimestamp(a.updated_at);
  });
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function TasksWorkspacePage() {
  const router = useRouter();
  const { showInfo } = useAppToast();

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
  const [savingPriorityId, setSavingPriorityId] = useState<number | null>(null);
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
  const activeGroupIdRef = useRef<number | null>(null);
  const commentsTaskIdRef = useRef<number | null>(null);
  const commentsRefreshTimerRef = useRef<number | null>(null);
  const queueSignalRefreshTimerRef = useRef<number | null>(null);
  const pendingQueueSignalGroupIdsRef = useRef<Set<number>>(new Set());

  useToastSync({
    error,
    clearError: () => setError(""),
    message,
    clearMessage: () => setMessage(""),
  });

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    commentsTaskIdRef.current = commentsTask?.id ?? null;
  }, [commentsTask]);

  useEffect(() => {
    return () => {
      if (commentsRefreshTimerRef.current !== null) {
        window.clearTimeout(commentsRefreshTimerRef.current);
      }
      if (queueSignalRefreshTimerRef.current !== null) {
        window.clearTimeout(queueSignalRefreshTimerRef.current);
      }
    };
  }, []);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) || null,
    [activeGroupId, groups]
  );

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) || null,
    [members, selectedMemberId]
  );

  const currentMember = useMemo(
    () => (me ? members.find((member) => member.id === me.id) || null : null),
    [me, members]
  );

  const otherMembers = useMemo(
    () => members.filter((member) => member.id !== me?.id),
    [me, members]
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

  const [seenQueueAtByGroup, setSeenQueueAtByGroup] = useState<Record<number, number>>({});
  const [queueActivityByGroup, setQueueActivityByGroup] = useState<Record<number, number>>({});

  const bucketCounts = useMemo(() => {
    const counts: Record<TaskBucket, number> = {
      in_progress: 0,
      done: 0,
      queue: 0,
    };

    tasksForSelectedMember.forEach((task) => {
      counts[taskBucketFromStatus(task.status)] += 1;
    });

    return counts;
  }, [tasksForSelectedMember]);

  const myQueueTasks = useMemo(() => {
    if (!me) return [];
    return tasks.filter(
      (task) => task.assignee_id === me.id && taskBucketFromStatus(task.status) === "queue"
    );
  }, [me, tasks]);

  const latestMyQueueActivityAt = useMemo(
    () =>
      myQueueTasks.reduce(
        (max, task) => Math.max(max, toTimestamp(task.updated_at) || toTimestamp(task.created_at)),
        0
      ),
    [myQueueTasks]
  );

  const currentGroupLastSeenQueueAt = activeGroupId ? seenQueueAtByGroup[activeGroupId] ?? 0 : 0;

  const hasUnreadQueueSignal =
    (activeGroupId ? queueActivityByGroup[activeGroupId] ?? latestMyQueueActivityAt : 0) >
    currentGroupLastSeenQueueAt;

  const upsertTaskInState = useCallback((nextTask: TaskItem) => {
    setTasks((prev) => {
      const existingIndex = prev.findIndex((task) => task.id === nextTask.id);
      const mergedTask =
        existingIndex >= 0
          ? {
              ...prev[existingIndex],
              ...nextTask,
              comments_count:
                nextTask.comments_count ?? prev[existingIndex].comments_count ?? 0,
            }
          : {
              ...nextTask,
              comments_count: nextTask.comments_count ?? 0,
            };

      const next =
        existingIndex >= 0
          ? prev.map((task, index) => (index === existingIndex ? mergedTask : task))
          : [...prev, mergedTask];

      return sortTaskItems(next);
    });
    setCommentsTask((prev) =>
      prev?.id === nextTask.id
        ? {
            ...prev,
            ...nextTask,
            comments_count: nextTask.comments_count ?? prev.comments_count ?? 0,
          }
        : prev
    );
  }, []);

  const loadMembers = useCallback(async (groupId: number, options?: { silent?: boolean }) => {
    try {
      const result = await apiJson<{ members: TaskMember[] }>(
        `/api/task-groups/members?groupId=${groupId}`
      );
      setMembers(result.members);
    } catch (err: any) {
      if (!options?.silent) {
        setMembers([]);
        setError(err?.message || "Не удалось загрузить участников группы");
      } else {
        console.error("Failed to refresh task group members:", err);
      }
    }
  }, []);

  const loadTasks = useCallback(async (groupId: number, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoadingTasks(true);
    }

    try {
      const result = await apiJson<{ tasks: TaskItem[] }>(`/api/tasks?groupId=${groupId}`);
      setTasks(
        sortTaskItems(result.tasks.map((task) => ({ ...task, comments_count: task.comments_count ?? 0 })))
      );
    } catch (err: any) {
      if (!options?.silent) {
        setTasks([]);
        setError(err?.message || "Не удалось загрузить задачи");
      } else {
        console.error("Failed to refresh tasks:", err);
      }
    } finally {
      if (!options?.silent) {
        setLoadingTasks(false);
      }
    }
  }, []);

  const loadCommentsForTask = useCallback(
    async (taskId: number, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoadingComments(true);
      }

      try {
        const result = await apiJson<{ comments: TaskComment[] }>(
          `/api/tasks/comments?taskId=${taskId}`
        );
        setComments(result.comments);
      } catch (err: any) {
        if (!options?.silent) {
          setError(err?.message || "Не удалось загрузить комментарии");
        } else {
          console.error(`Failed to refresh comments for task ${taskId}:`, err);
        }
      } finally {
        if (!options?.silent) {
          setLoadingComments(false);
        }
      }
    },
    []
  );

  const loadQueueSignalsForGroups = useCallback(
    async (groupIds: number[]) => {
      const uniqueGroupIds = Array.from(
        new Set(groupIds.filter((groupId) => Number.isFinite(groupId) && groupId > 0))
      );
      if (uniqueGroupIds.length === 0) return;

      try {
        const result = await apiJson<{ signals: TaskQueueSignal[] }>(
          `/api/tasks/signals?groupIds=${uniqueGroupIds.join(",")}`
        );

        const latestByGroup = new Map<number, number>();
        result.signals.forEach((signal) => {
          latestByGroup.set(signal.groupId, toTimestamp(signal.latestActivityAt));
        });

        setQueueActivityByGroup((prev) => {
          const next = { ...prev };
          uniqueGroupIds.forEach((groupId) => {
            next[groupId] = latestByGroup.get(groupId) ?? 0;
          });
          return next;
        });
      } catch (error) {
        console.error("Failed to refresh queue signals:", error);
      }
    },
    []
  );

  const scheduleQueueSignalsRefresh = useCallback(
    (groupIds: number[]) => {
      const uniqueGroupIds = Array.from(
        new Set(groupIds.filter((groupId) => Number.isFinite(groupId) && groupId > 0))
      );
      if (uniqueGroupIds.length === 0) return;

      uniqueGroupIds.forEach((groupId) => {
        pendingQueueSignalGroupIdsRef.current.add(groupId);
      });

      if (queueSignalRefreshTimerRef.current !== null) return;

      queueSignalRefreshTimerRef.current = window.setTimeout(() => {
        const nextGroupIds = Array.from(pendingQueueSignalGroupIdsRef.current);
        pendingQueueSignalGroupIdsRef.current.clear();
        queueSignalRefreshTimerRef.current = null;
        void loadQueueSignalsForGroups(nextGroupIds);
      }, 150);
    },
    [loadQueueSignalsForGroups]
  );

  const scheduleCommentsRefresh = useCallback(
    (taskId: number) => {
      if (!taskId || commentsTaskIdRef.current !== taskId) return;
      if (commentsRefreshTimerRef.current !== null) return;

      commentsRefreshTimerRef.current = window.setTimeout(() => {
        commentsRefreshTimerRef.current = null;
        if (commentsTaskIdRef.current !== taskId) return;
        void loadCommentsForTask(taskId, { silent: true });
      }, 150);
    },
    [loadCommentsForTask]
  );

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

    void Promise.all([
      loadMembers(activeGroupId),
      loadTasks(activeGroupId),
      loadQueueSignalsForGroups(groups.map((group) => group.id)),
    ]);
  }, [activeGroupId, groups, loadMembers, loadQueueSignalsForGroups, loadTasks]);

  useEffect(() => {
    if (!me) {
      setSeenQueueAtByGroup({});
      return;
    }

    const next: Record<number, number> = {};
    groups.forEach((group) => {
      const stored = Number(localStorage.getItem(getQueueSeenStorageKey(me.id, group.id)));
      next[group.id] = Number.isFinite(stored) ? stored : 0;
    });
    setSeenQueueAtByGroup(next);
  }, [groups, me]);

  useEffect(() => {
    if (!activeGroupId) return;
    setQueueActivityByGroup((prev) => ({ ...prev, [activeGroupId]: latestMyQueueActivityAt }));
  }, [activeGroupId, latestMyQueueActivityAt]);

  useEffect(() => {
    if (!activeGroupId) return;

    const refreshCurrentView = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      await Promise.all([
        loadTasks(activeGroupId, { silent: true }),
        loadQueueSignalsForGroups(groups.map((group) => group.id)),
      ]);
    };

    const handleBecomeActive = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshCurrentView();
    };

    document.addEventListener("visibilitychange", handleBecomeActive);
    window.addEventListener("focus", handleBecomeActive);

    return () => {
      document.removeEventListener("visibilitychange", handleBecomeActive);
      window.removeEventListener("focus", handleBecomeActive);
    };
  }, [activeGroupId, groups, loadQueueSignalsForGroups, loadTasks]);

  useEffect(() => {
    if (!me || groups.length === 0) return;

    const groupIds = groups.map((group) => group.id);
    const eventSource = new EventSource(`/api/tasks/stream?groupIds=${groupIds.join(",")}`);

    const handleReady = () => {
      scheduleQueueSignalsRefresh(groupIds);
    };

    const handleTaskEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as TaskStreamEvent;
        if (!payload?.groupId || !payload?.taskId) return;

        const isIncomingForMe =
          Boolean(me?.id) && payload.assigneeId === me?.id && payload.actorId !== me?.id;

        scheduleQueueSignalsRefresh([payload.groupId]);

        if (payload.groupId === activeGroupIdRef.current && payload.task) {
          upsertTaskInState(payload.task);
        } else if (payload.groupId === activeGroupIdRef.current) {
          void loadTasks(payload.groupId, { silent: true });
        }

        if (payload.type === "task_transferred" && isIncomingForMe) {
          showInfo(
            payload.task?.title
              ? `Вам передали задачу: ${payload.task.title}`
              : "Вам передали новую задачу"
          );
        }

        if (payload.type === "task_comment_added") {
          if (isIncomingForMe && commentsTaskIdRef.current !== payload.taskId) {
            showInfo(
              payload.task?.title
                ? `Новый комментарий к задаче: ${payload.task.title}`
                : "К вашей задаче добавлен новый комментарий"
            );
          }
          scheduleCommentsRefresh(payload.taskId);
        }
      } catch (error) {
        console.error("Failed to handle task stream event:", error);
      }
    };

    eventSource.addEventListener("ready", handleReady as EventListener);
    eventSource.addEventListener("task", handleTaskEvent as EventListener);

    return () => {
      eventSource.removeEventListener("ready", handleReady as EventListener);
      eventSource.removeEventListener("task", handleTaskEvent as EventListener);
      eventSource.close();
    };
  }, [
    groups,
    loadTasks,
    me,
    scheduleCommentsRefresh,
    scheduleQueueSignalsRefresh,
    showInfo,
    upsertTaskInState,
  ]);

  useEffect(() => {
    if (!me || !activeGroupId) return;
    if (activeBucket !== "queue" || selectedMemberId !== me.id) return;

    const seenAt = queueActivityByGroup[activeGroupId] ?? latestMyQueueActivityAt;
    if (seenAt <= (seenQueueAtByGroup[activeGroupId] ?? 0)) return;

    setSeenQueueAtByGroup((prev) => ({ ...prev, [activeGroupId]: seenAt }));
    localStorage.setItem(getQueueSeenStorageKey(me.id, activeGroupId), String(seenAt));
  }, [
    activeGroupId,
    activeBucket,
    latestMyQueueActivityAt,
    me,
    queueActivityByGroup,
    seenQueueAtByGroup,
    selectedMemberId,
  ]);

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
      const result = await apiJson<{ task: TaskItem }>("/api/tasks", {
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
      upsertTaskInState(result.task);
      scheduleQueueSignalsRefresh([activeGroupId]);
      setMessage("Задача создана и добавлена во вкладку «В очереди»");
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
      upsertTaskInState(result.task);
      scheduleQueueSignalsRefresh([result.task.group_id]);
      setMessage("Статус задачи обновлен");
    } catch (err: any) {
      setError(err?.message || "Не удалось изменить статус задачи");
    } finally {
      setSavingStatusId(null);
    }
  };

  const updatePriority = async (task: TaskItem, nextPriority: TaskPriority) => {
    if (task.priority === nextPriority) return;

    setSavingPriorityId(task.id);
    setError("");
    setMessage("");
    try {
      const result = await apiJson<{ task: TaskItem }>("/api/tasks", {
        method: "PUT",
        body: JSON.stringify({ id: task.id, priority: nextPriority }),
      });
      upsertTaskInState(result.task);
      setMessage("Приоритет задачи обновлен");
    } catch (err: any) {
      setError(err?.message || "Не удалось изменить приоритет задачи");
    } finally {
      setSavingPriorityId(null);
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
      upsertTaskInState(result.task);
      scheduleQueueSignalsRefresh([result.task.group_id]);
      setTransferTask(null);
      setMessage("Задача передана и возвращена в очередь");
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
    setError("");
    await loadCommentsForTask(task.id);
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
      const result = await apiJson<{ comment: TaskComment; task: TaskItem | null }>(
        "/api/tasks/comments",
        {
          method: "POST",
          body: JSON.stringify({ taskId: commentsTask.id, body: commentDraft.trim() }),
        }
      );
      setComments((prev) => [...prev, result.comment]);
      setCommentDraft("");
      if (result.task) {
        upsertTaskInState(result.task);
        scheduleQueueSignalsRefresh([result.task.group_id]);
      }
      setMessage("Комментарий добавлен");
    } catch (err: any) {
      setError(err?.message || "Не удалось добавить комментарий");
    } finally {
      setSendingComment(false);
    }
  };

  const renderMemberButton = (member: TaskMember, options?: { pinned?: boolean }) => {
    const isSelected = selectedMemberId === member.id;
    const isMe = me?.id === member.id;
    const pinned = options?.pinned === true;

    return (
      <button
        key={member.id}
        type="button"
        onClick={() => setSelectedMemberId(member.id)}
        className={cls(
          "w-full rounded-xl border px-3 py-2 text-left transition",
          pinned && !isSelected && "bg-white",
          isSelected
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{member.name}</span>
          {isMe && (
            <span
              className={cls(
                "rounded-full px-2 py-0.5 text-[10px]",
                isSelected ? "bg-white/15 text-white" : "bg-slate-200 text-slate-600"
              )}
            >
              Вы
            </span>
          )}
        </div>
        <div
          className={cls(
            "mt-0.5 text-xs",
            isSelected ? "text-white/75" : "text-slate-500"
          )}
        >
          @{member.username}
        </div>
      </button>
    );
  };

  return (
    <div className="h-full w-full py-3">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-3">
        {loadingBootstrap ? (
          <div className="flex flex-1 items-center justify-center rounded-[28px] border border-slate-200/80 bg-white/70 text-sm text-slate-500 backdrop-blur-sm">
            Загрузка...
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[28px] border border-slate-200/80 bg-white/70 p-6 backdrop-blur-sm">
            <div className="max-w-xl text-center">
              <h2 className="text-lg font-semibold text-slate-800">Нет доступных групп задач</h2>
              <p className="mt-2 text-sm text-slate-600">
                Добавьте пользователя в task-группу через раздел администрирования.
              </p>
            </div>
          </div>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-slate-200/80 bg-white/70 p-3 backdrop-blur-sm">
            <div className="flex justify-center">
              <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                {groups.map((group) => {
                  const hasUnreadGroupSignal =
                    (queueActivityByGroup[group.id] ?? 0) > (seenQueueAtByGroup[group.id] ?? 0) &&
                    activeGroupId !== group.id;

                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setActiveGroupId(group.id)}
                      className={cls(
                        "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs transition",
                        activeGroupId === group.id
                          ? "bg-slate-900 text-white"
                          : hasUnreadGroupSignal
                            ? "animate-pulse bg-emerald-50 text-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                      )}
                    >
                      <span>{group.name}</span>
                      {hasUnreadGroupSignal && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 min-h-0 flex-1 rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_1px_minmax(280px,1fr)]">
                <div className="flex min-h-0 flex-col p-5">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div />
                    <div className="justify-self-center">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                        {(["in_progress", "done", "queue"] as TaskBucket[]).map((bucket) => {
                          const hasUnreadIndicator =
                            bucket === "queue" && hasUnreadQueueSignal && activeBucket !== "queue";

                          return (
                            <button
                              key={bucket}
                              type="button"
                              onClick={() => setActiveBucket(bucket)}
                              className={cls(
                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition",
                                activeBucket === bucket
                                  ? "bg-slate-900 text-white"
                                  : hasUnreadIndicator
                                    ? "animate-pulse bg-emerald-50 text-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]"
                                    : "bg-white text-slate-700 hover:bg-slate-100"
                              )}
                            >
                              <span>{BUCKET_LABELS[bucket]}</span>
                              {hasUnreadIndicator && (
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                </span>
                              )}
                              <span
                                className={cls(
                                  "min-w-5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                                  activeBucket === bucket
                                    ? "bg-white/14 text-white"
                                    : hasUnreadIndicator
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-slate-100 text-slate-500"
                                )}
                              >
                                {bucketCounts[bucket]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        disabled={!activeGroupId || !me}
                        className="flex h-8 w-8 items-center justify-center rounded-2xl border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        title="Создать задачу"
                        aria-label="Создать задачу"
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>

                  {!canManageSelectedTasks && selectedMember && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      Вы просматриваете задачи пользователя {selectedMember.name}. Можно только читать и комментировать.
                    </div>
                  )}

                  <div className="mt-4 min-h-0 flex-1 overflow-auto pr-1">
                    {loadingTasks ? (
                      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                        Загрузка задач...
                      </div>
                    ) : !selectedMemberId ? (
                      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                        Выберите пользователя справа
                      </div>
                    ) : visibleTasks.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
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
                          const canReturnToRework = task.status === "done";
 
                          return (
                            <article
                              key={task.id}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-slate-900">
                                    {task.title}
                                  </div>
                                </div>

                                {canManageSelectedTasks ? (
                                  <AppSelect
                                    value={task.priority}
                                    onChange={(event) =>
                                      void updatePriority(task, event.target.value as TaskPriority)
                                    }
                                    disabled={savingPriorityId === task.id}
                                    aria-label="Изменить приоритет задачи"
                                    wrapperClassName={cls(
                                      "w-[108px] rounded-full border transition",
                                      PRIORITY_CLASSES[task.priority]
                                    )}
                                    selectClassName="h-7 pl-3 pr-7 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                                    iconClassName="text-current"
                                  >
                                    <option value="high">Высокий</option>
                                    <option value="medium">Средний</option>
                                    <option value="low">Низкий</option>
                                  </AppSelect>
                                ) : (
                                  <span
                                    className={cls(
                                      "inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                      PRIORITY_CLASSES[task.priority]
                                    )}
                                  >
                                    {PRIORITY_LABELS[task.priority]}
                                  </span>
                                )}

                                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                  <button
                                    type="button"
                                    onClick={() => void openCommentsModal(task)}
                                    className={cls(
                                      "rounded-lg border px-2.5 py-1 text-xs transition",
                                      commentsCount > 0
                                        ? "border-indigo-200 bg-indigo-50 font-medium text-indigo-700 hover:bg-indigo-100"
                                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                                    )}
                                  >
                                    {commentsCount > 0 ? `Комментарии (${commentsCount})` : "Комментарии"}
                                  </button>

                                  {canManageSelectedTasks && activeBucket !== "done" && (
                                    <button
                                      type="button"
                                      onClick={() => openTransferModal(task)}
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                                    >
                                      Передать
                                    </button>
                                  )}

                                  {canManageSelectedTasks && activeBucket === "queue" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        canStartTask ? void updateStatus(task, "in_progress") : undefined
                                      }
                                      disabled={!canStartTask || savingStatusId === task.id}
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {savingStatusId === task.id ? "..." : "В работу"}
                                    </button>
                                  )}

                                  {canManageSelectedTasks && activeBucket === "in_progress" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        canFinishTask ? void updateStatus(task, "done") : undefined
                                      }
                                      disabled={!canFinishTask || savingStatusId === task.id}
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {savingStatusId === task.id ? "..." : "Завершить"}
                                    </button>
                                  )}

                                  {canManageSelectedTasks && activeBucket === "done" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        canReturnToRework
                                          ? void updateStatus(task, "in_progress")
                                          : undefined
                                      }
                                      disabled={!canReturnToRework || savingStatusId === task.id}
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {savingStatusId === task.id ? "..." : "Вернуть в доработку"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="hidden bg-slate-200 lg:block" />

                <aside className="min-h-0 border-t border-slate-200 p-4 lg:border-t-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {activeGroup?.name ? `Пользователи • ${activeGroup.name}` : "Пользователи"}
                  </div>

                  <div className="mt-3 h-full overflow-auto pr-1">
                    {members.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                        В выбранной группе нет участников
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {currentMember && (
                          <div className="space-y-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Вы
                            </div>
                            {renderMemberButton(currentMember, { pinned: true })}
                          </div>
                        )}

                        {otherMembers.length > 0 && (
                          <div className="space-y-2">
                            {currentMember && (
                              <div className="border-t border-dashed border-slate-200 pt-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  Остальные
                                </div>
                              </div>
                            )}
                            {otherMembers.map((member) => renderMemberButton(member))}
                          </div>
                        )}
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
            className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-900">Создание задачи</h3>
            <p className="mt-1 text-xs text-slate-500">
              Новая задача будет добавлена во вкладку «В очереди».
            </p>

            <div className="mt-4 space-y-3">
              <input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="Название задачи"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              />
              <AppSelect
                value={createPriority}
                onChange={(event) => setCreatePriority(event.target.value as TaskPriority)}
                wrapperClassName="w-full rounded-2xl border border-slate-200 bg-white text-slate-700 ring-slate-300 transition focus-within:ring-2"
                selectClassName="px-3 py-2 pr-9 text-sm text-slate-700"
              >
                <option value="high">Высокий приоритет</option>
                <option value="medium">Средний приоритет</option>
                <option value="low">Низкий приоритет</option>
              </AppSelect>
            </div>

            <div className="mt-5 flex justify-end gap-2">
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
          <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">Передача задачи</h3>
            <p className="mt-1 text-xs text-slate-500">{transferTask.title}</p>

            <div className="mt-4 space-y-3">
              <AppSelect
                value={transferAssigneeId || ""}
                onChange={(event) => setTransferAssigneeId(Number(event.target.value) || null)}
                disabled={transferOptions.length === 0}
                wrapperClassName="w-full rounded-2xl border border-slate-200 bg-white text-slate-700 ring-slate-300 transition focus-within:ring-2"
                selectClassName="px-3 py-2 pr-9 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {transferOptions.length === 0 && <option value="">Некому передавать</option>}
                {transferOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.username})
                  </option>
                ))}
              </AppSelect>
              <input
                value={transferComment}
                onChange={(event) => setTransferComment(event.target.value)}
                placeholder="Комментарий к передаче"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
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

      {commentsTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="flex w-full max-w-2xl flex-col rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Комментарии</h3>
                <p className="mt-1 text-xs text-slate-500">{commentsTask.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setCommentsTask(null)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 max-h-[340px] min-h-[220px] space-y-3 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {loadingComments ? (
                <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                  Загрузка комментариев...
                </div>
              ) : comments.length === 0 ? (
                <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-slate-500">
                  Комментариев пока нет
                </div>
              ) : (
                comments.map((comment) => (
                  <article key={comment.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-900">{comment.author_name}</div>
                      <div className="text-xs text-slate-400">{formatDateTime(comment.created_at)}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">@{comment.author_username}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
                  </article>
                ))
              )}
            </div>

            <div className="mt-4">
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Напишите комментарий"
                rows={4}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-slate-300 transition focus:ring-2"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCommentsTask(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void addComment()}
                disabled={sendingComment || !commentDraft.trim()}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {sendingComment ? "Сохранение..." : "Добавить комментарий"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
