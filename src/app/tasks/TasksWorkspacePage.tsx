
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppSelect from "@/app/components/AppSelect";
import { useAppToast, useToastSync } from "@/app/components/AppToastProvider";
import DocumentDropField from "@/app/components/DocumentDropField";
import TaskDocumentViewerModal from "@/app/tasks/TaskDocumentViewerModal";
import TaskSigningModal from "@/app/tasks/TaskSigningModal";
import SigningStampPlacementModal, {
  type SigningStampTemplateValue,
} from "@/app/tasks/SigningStampPlacementModal";

type UserRole = "user" | "admin" | "god";
type TaskStatus = "new" | "in_progress" | "blocked" | "review" | "done" | "canceled";
type TaskPriority = "low" | "medium" | "high";
type TaskKind = "task" | "signing";
type TaskBucket = "in_progress" | "done" | "queue";
type SigningPlacementMode = "last_page" | "all_pages";

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
  kind: TaskKind;
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
  document_name?: string | null;
  document_size?: number | null;
  document_mime_type?: string | null;
  signer_count?: number;
  signed_count?: number;
  signing_placement_mode?: SigningPlacementMode | null;
  signing_current_signer_id?: number | null;
  signing_current_signer_name?: string | null;
  signing_current_step_order?: number | null;
};

type TaskComment = {
  id: number;
  task_id: number;
  author_id: number;
  kind: "comment" | "transfer";
  body: string;
  created_at: string;
  author_name: string;
  author_username: string;
};

type TaskQueueSignal = {
  groupId: number;
  unreadCount: number;
};

function normalizeId(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCurrentUser(user: CurrentUser | null) {
  return user ? { ...user, id: normalizeId(user.id) } : null;
}

function normalizeTaskGroup(group: TaskGroup): TaskGroup {
  return {
    ...group,
    id: normalizeId(group.id),
    created_by: group.created_by == null ? null : normalizeId(group.created_by),
  };
}

function normalizeTaskMember(member: TaskMember): TaskMember {
  return {
    ...member,
    id: normalizeId(member.id),
  };
}

function normalizeTaskItem(task: TaskItem): TaskItem {
  return {
    ...task,
    id: normalizeId(task.id),
    group_id: normalizeId(task.group_id),
    kind: task.kind === "signing" ? "signing" : "task",
    creator_id: normalizeId(task.creator_id),
    assignee_id: task.assignee_id == null ? null : normalizeId(task.assignee_id),
    comments_count: task.comments_count ?? 0,
    document_name: task.document_name ?? null,
    document_size: task.document_size == null ? null : Number(task.document_size),
    document_mime_type: task.document_mime_type ?? null,
    signer_count: task.signer_count == null ? 0 : Number(task.signer_count),
    signed_count: task.signed_count == null ? 0 : Number(task.signed_count),
    signing_placement_mode:
      task.signing_placement_mode === "all_pages" ? "all_pages" : task.signing_placement_mode === "last_page" ? "last_page" : null,
    signing_current_signer_id:
      task.signing_current_signer_id == null ? null : normalizeId(task.signing_current_signer_id),
    signing_current_signer_name: task.signing_current_signer_name ?? null,
    signing_current_step_order:
      task.signing_current_step_order == null ? null : Number(task.signing_current_step_order),
  };
}

function normalizeTaskComment(comment: TaskComment): TaskComment {
  return {
    ...comment,
    id: normalizeId(comment.id),
    task_id: normalizeId(comment.task_id),
    author_id: normalizeId(comment.author_id),
    kind: comment.kind === "transfer" ? "transfer" : "comment",
  };
}

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

const TASK_KIND_LABELS: Record<TaskKind, string> = {
  task: "Задача",
  signing: "Подписание",
};
const TASKS_POLL_INTERVAL_MS = 5000;
const GROUP_SIGNALS_POLL_INTERVAL_MS = 2000;
const COMMENTS_POLL_INTERVAL_MS = 4000;
const COMMENT_TOAST_SUPPRESSION_MS = 12000;

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
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

function sortVisibleTaskItems(items: TaskItem[], bucket: TaskBucket) {
  if (bucket !== "done") {
    return sortTaskItems(items);
  }

  return [...items].sort((a, b) => {
    const aCompleted = a.status === "done";
    const bCompleted = b.status === "done";
    if (aCompleted !== bCompleted) return aCompleted ? -1 : 1;

    const completedDiff = toTimestamp(b.completed_at) - toTimestamp(a.completed_at);
    if (completedDiff !== 0) return completedDiff;

    return toTimestamp(b.updated_at) - toTimestamp(a.updated_at);
  });
}

async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
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
  const { showInfo, showSuccess } = useAppToast();

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
  const [createKind, setCreateKind] = useState<TaskKind>("task");
  const [createDocument, setCreateDocument] = useState<File | null>(null);
  const [createSignerIds, setCreateSignerIds] = useState<number[]>([]);
  const [createStampTemplate, setCreateStampTemplate] = useState<SigningStampTemplateValue | null>(
    null
  );
  const [stampPlacementOpen, setStampPlacementOpen] = useState(false);

  const [transferTask, setTransferTask] = useState<TaskItem | null>(null);
  const [transferAssigneeId, setTransferAssigneeId] = useState<number | null>(null);
  const [transferComment, setTransferComment] = useState("");

  const [commentsTask, setCommentsTask] = useState<TaskItem | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [documentViewerTask, setDocumentViewerTask] = useState<TaskItem | null>(null);
  const [signingTask, setSigningTask] = useState<TaskItem | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const meRef = useRef<CurrentUser | null>(null);
  const tasksRef = useRef<TaskItem[]>([]);
  const tasksGroupIdRef = useRef<number | null>(null);
  const queueSignalRefreshTimerRef = useRef<number | null>(null);
  const pendingQueueSignalGroupIdsRef = useRef<Set<number>>(new Set());
  const markingQueueSignalsSeenRef = useRef<Set<number>>(new Set());
  const ownCommentToastSuppressionRef = useRef<Map<number, number>>(new Map());
  const commentsViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingCommentsScrollRef = useRef(false);
  const placementAutoOpenKeyRef = useRef("");

  useToastSync({
    error,
    clearError: () => setError(""),
    message,
    clearMessage: () => setMessage(""),
  });

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    tasksRef.current = tasks;
    tasksGroupIdRef.current = activeGroupId;
  }, [activeGroupId, tasks]);

  useEffect(() => {
    return () => {
      if (queueSignalRefreshTimerRef.current !== null) {
        window.clearTimeout(queueSignalRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!commentsTask || !pendingCommentsScrollRef.current || loadingComments) return;

    const scrollToBottom = () => {
      const viewport = commentsViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      pendingCommentsScrollRef.current = false;
    };

    const frameId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frameId);
  }, [comments, commentsTask, loadingComments]);

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

  const createSigningMembers = useMemo(
    () =>
      createSignerIds
        .map((signerId) => members.find((member) => member.id === signerId) || null)
        .filter((member): member is TaskMember => member !== null),
    [createSignerIds, members]
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
    return tasks.filter((task) => {
      if (task.kind === "signing") {
        return true;
      }
      return task.assignee_id === selectedMemberId;
    });
  }, [selectedMemberId, tasks]);

  const visibleTasks = useMemo(() => {
    const bucketTasks = tasksForSelectedMember.filter(
      (task) => taskBucketFromStatus(task.status) === activeBucket
    );
    return sortVisibleTaskItems(bucketTasks, activeBucket);
  }, [activeBucket, tasksForSelectedMember]);

  const [queueUnreadCountByGroup, setQueueUnreadCountByGroup] = useState<Record<number, number>>({});

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

  const hasUnreadQueueSignal = activeGroupId
    ? (queueUnreadCountByGroup[activeGroupId] ?? 0) > 0
    : false;

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

  const pruneCommentToastSuppression = useCallback(() => {
    const now = Date.now();
    ownCommentToastSuppressionRef.current.forEach((until, taskId) => {
      if (until <= now) {
        ownCommentToastSuppressionRef.current.delete(taskId);
      }
    });
  }, []);

  const loadMembers = useCallback(async (groupId: number, options?: { silent?: boolean }) => {
    try {
      const result = await apiJson<{ members: TaskMember[] }>(
        `/api/task-groups/members?groupId=${groupId}`
      );
      setMembers(result.members.map(normalizeTaskMember));
    } catch (err: any) {
      if (!options?.silent) {
        setMembers([]);
        setError(err?.message || "Не удалось загрузить участников группы");
      } else {
        console.error("Failed to refresh task group members:", err);
      }
    }
  }, []);

  const loadTasks = useCallback(
    async (groupId: number, options?: { silent?: boolean; detectIncoming?: boolean }) => {
      if (!options?.silent) {
        setLoadingTasks(true);
      }

      try {
        const result = await apiJson<{ tasks: TaskItem[] }>(`/api/tasks?groupId=${groupId}`);
        const nextTasks = sortTaskItems(result.tasks.map(normalizeTaskItem));

        if (options?.detectIncoming && tasksGroupIdRef.current === groupId) {
          const currentUserId = meRef.current?.id ?? null;
          if (currentUserId) {
            pruneCommentToastSuppression();

            const previousById = new Map(tasksRef.current.map((task) => [task.id, task]));
            nextTasks.forEach((task) => {
              const previousTask = previousById.get(task.id);
              if (!previousTask) return;

              if (previousTask.assignee_id !== currentUserId && task.assignee_id === currentUserId) {
                showInfo(`Вам передали задачу: ${task.title}`);
              }

              if (
                previousTask.assignee_id === currentUserId &&
                task.assignee_id === currentUserId &&
                (task.comments_count ?? 0) > (previousTask.comments_count ?? 0) &&
                commentsTask?.id !== task.id &&
                (ownCommentToastSuppressionRef.current.get(task.id) ?? 0) < Date.now()
              ) {
                showInfo(`Новый комментарий к задаче: ${task.title}`);
              }
            });
          }
        }

        setTasks(nextTasks);
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
    },
    [commentsTask, pruneCommentToastSuppression, showInfo]
  );
  const loadCommentsForTask = useCallback(
    async (taskId: number, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoadingComments(true);
      }

      try {
        const result = await apiJson<{ comments: TaskComment[] }>(
          `/api/tasks/comments?taskId=${taskId}`
        );
        setComments(result.comments.map(normalizeTaskComment));
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

        const unreadByGroup = new Map<number, number>();
        result.signals.forEach((signal) => {
          unreadByGroup.set(signal.groupId, signal.unreadCount ?? 0);
        });

        setQueueUnreadCountByGroup((prev) => {
          const next = { ...prev };
          uniqueGroupIds.forEach((groupId) => {
            next[groupId] = unreadByGroup.get(groupId) ?? 0;
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

  const markQueueSignalsSeen = useCallback(
    async (groupId: number) => {
      if (!Number.isFinite(groupId) || groupId <= 0) return;
      if (markingQueueSignalsSeenRef.current.has(groupId)) return;

      markingQueueSignalsSeenRef.current.add(groupId);
      setQueueUnreadCountByGroup((prev) =>
        (prev[groupId] ?? 0) > 0 ? { ...prev, [groupId]: 0 } : prev
      );

      try {
        await apiJson<{ success: boolean }>("/api/tasks/signals/seen", {
          method: "POST",
          body: JSON.stringify({ groupId }),
        });
      } catch (error) {
        console.error(`Failed to mark queue signals as seen for group ${groupId}:`, error);
        scheduleQueueSignalsRefresh([groupId]);
      } finally {
        markingQueueSignalsSeenRef.current.delete(groupId);
      }
    },
    [scheduleQueueSignalsRefresh]
  );

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    setError("");
    try {
      const [meRes, groupsRes] = await Promise.all([
        apiJson<{ user: CurrentUser | null }>("/api/auth/me"),
        apiJson<{ groups: TaskGroup[] }>("/api/task-groups"),
      ]);

      const nextUser = normalizeCurrentUser(meRes.user);
      const nextGroups = groupsRes.groups.map(normalizeTaskGroup);

      setMe(nextUser);
      setGroups(nextGroups);

      if (nextGroups.length === 0) {
        setActiveGroupId(null);
        return;
      }

      const validIds = new Set(
        nextGroups
          .map((group) => Number(group.id))
          .filter((groupId) => Number.isFinite(groupId) && groupId > 0)
      );
      const urlGroupId = Number(new URL(window.location.href).searchParams.get("groupId"));
      const localStored = Number(localStorage.getItem("tasks.activeGroupId"));

      const nextGroupId =
        Number.isFinite(urlGroupId) && validIds.has(urlGroupId)
          ? urlGroupId
          : Number.isFinite(localStored) && validIds.has(localStored)
            ? localStored
            : nextGroups[0].id;

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
    if (!activeGroupId) return;

    const refreshCurrentView = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      await Promise.all([
        loadTasks(activeGroupId, { silent: true, detectIncoming: true }),
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
    if (!activeGroupId || groups.length === 0) return;

    const groupIds = groups.map((group) => group.id);
    const pollCurrentView = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadTasks(activeGroupId, { silent: true, detectIncoming: true });
    };

    const intervalId = window.setInterval(pollCurrentView, TASKS_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [activeGroupId, groups, loadTasks]);

  useEffect(() => {
    if (groups.length === 0) return;

    const groupIds = groups.map((group) => group.id);
    const pollGroupSignals = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadQueueSignalsForGroups(groupIds);
    };

    const intervalId = window.setInterval(pollGroupSignals, GROUP_SIGNALS_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [groups, loadQueueSignalsForGroups]);

  useEffect(() => {
    if (!commentsTask) return;

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadCommentsForTask(commentsTask.id, { silent: true });
    }, COMMENTS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [commentsTask, loadCommentsForTask]);

  useEffect(() => {
    if (!me || !activeGroupId) return;
    if (activeBucket !== "queue" || selectedMemberId !== me.id) return;
    if ((queueUnreadCountByGroup[activeGroupId] ?? 0) <= 0) return;

    void markQueueSignalsSeen(activeGroupId);
  }, [activeGroupId, activeBucket, markQueueSignalsSeen, me, queueUnreadCountByGroup, selectedMemberId]);

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

  useEffect(() => {
    if (!createOpen || createKind !== "signing") return;
    if (!createDocument || createSignerIds.length === 0) return;
    if (createStampTemplate || stampPlacementOpen) return;

    const key = `${createDocument.name}:${createDocument.size}:${createSignerIds.join(",")}`;
    if (placementAutoOpenKeyRef.current === key) return;
    placementAutoOpenKeyRef.current = key;
    setStampPlacementOpen(true);
  }, [createDocument, createKind, createOpen, createSignerIds, createStampTemplate, stampPlacementOpen]);

  const toggleCreateSigner = useCallback((memberId: number) => {
    setCreateSignerIds((prev) => {
      const next = prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId];
      return next;
    });
    setCreateStampTemplate(null);
  }, []);

  const moveCreateSigner = useCallback((memberId: number, direction: -1 | 1) => {
    setCreateSignerIds((prev) => {
      const index = prev.indexOf(memberId);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
    setCreateStampTemplate(null);
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    setCreateTitle("");
    setCreatePriority("medium");
    setCreateKind("task");
    setCreateDocument(null);
    setCreateSignerIds([]);
    setCreateStampTemplate(null);
    setStampPlacementOpen(false);
    placementAutoOpenKeyRef.current = "";
  }, []);

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeGroupId || !me) return;
    if (!createTitle.trim()) {
      setError("Введите название задачи");
      return;
    }
    if (createKind === "signing" && !createDocument) {
      setError("Выберите документ для подписания");
      return;
    }
    if (createKind === "signing" && createSignerIds.length === 0) {
      setError("Выберите хотя бы одного подписанта");
      return;
    }
    if (createKind === "signing" && !createStampTemplate) {
      setError("Сначала разместите блок штампов на PDF");
      return;
    }

    setCreatingTask(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("groupId", String(activeGroupId));
      formData.set("title", createTitle.trim());
      formData.set("priority", createPriority);
      formData.set("assigneeId", String(me.id));
      formData.set("description", "");
      formData.set("kind", createKind);
      if (createDocument) {
        formData.set("document", createDocument);
      }
      if (createKind === "signing") {
        formData.set("signerIds", JSON.stringify(createSignerIds));
        formData.set("stampTemplate", JSON.stringify(createStampTemplate));
      }

      const response = await fetch("/api/tasks", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        task?: TaskItem;
      };

      if (!response.ok || !payload.task) {
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      closeCreateModal();
      setActiveBucket(createKind === "signing" ? "in_progress" : "queue");
      setSelectedMemberId(me.id);
      upsertTaskInState(normalizeTaskItem(payload.task));
      scheduleQueueSignalsRefresh([activeGroupId]);
      setMessage(
        createKind === "signing"
          ? "Задача на подписание создана и добавлена во вкладку «В работе»"
          : "Задача создана и добавлена во вкладку «В очереди»"
      );
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
      upsertTaskInState(normalizeTaskItem(result.task));
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
      upsertTaskInState(normalizeTaskItem(result.task));
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
      upsertTaskInState(normalizeTaskItem(result.task));
      scheduleQueueSignalsRefresh([result.task.group_id]);
      setTransferTask(null);
      setMessage("Задача передана и возвращена в очередь");
    } catch (err: any) {
      setError(err?.message || "Не удалось передать задачу");
    } finally {
      setSendingTransfer(false);
    }
  };

  const handleSigningSaved = useCallback(
    (payload: {
      task: unknown;
      completed: boolean;
      nextSignerName: string | null;
      signedStepOrder: number | null;
    }) => {
      if (payload.task) {
        upsertTaskInState(normalizeTaskItem(payload.task as TaskItem));
      } else if (activeGroupId) {
        void loadTasks(activeGroupId, { silent: true, detectIncoming: true });
      }

      setSigningTask(null);

      if (payload.completed) {
        setActiveBucket("done");
        showSuccess("Подпись встроена в PDF. Маршрут подписания завершён.");
        return;
      }

      if (payload.nextSignerName) {
        showSuccess(
          `Подпись встроена в PDF. Следующий подписант: ${payload.nextSignerName}.`
        );
        return;
      }

      showSuccess("Подпись встроена в PDF.");
    },
    [activeGroupId, loadTasks, showSuccess, upsertTaskInState]
  );

  const openCommentsModal = async (task: TaskItem) => {
    setLoadingComments(true);
    pendingCommentsScrollRef.current = true;
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
      pendingCommentsScrollRef.current = true;
      setComments((prev) => [...prev, normalizeTaskComment(result.comment)]);
      setCommentDraft("");
      ownCommentToastSuppressionRef.current.set(
        commentsTask.id,
        Date.now() + COMMENT_TOAST_SUPPRESSION_MS
      );
      if (result.task) {
        upsertTaskInState(normalizeTaskItem(result.task));
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
                    (queueUnreadCountByGroup[group.id] ?? 0) > 0 && activeGroupId !== group.id;

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
                          const canSignNow =
                            task.kind === "signing" &&
                            canManageSelectedTasks &&
                            !!me &&
                            task.signing_current_signer_id === me.id &&
                            task.status !== "done";

                          return (
                            <article
                              key={task.id}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-3"
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-sm font-medium text-slate-900">
                                      {task.title}
                                    </div>
                                    {task.kind === "signing" && (
                                      <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                        {TASK_KIND_LABELS[task.kind]}
                                      </span>
                                    )}
                                  </div>
                                  {task.kind === "signing" && task.document_name && (
                                    <div className="mt-1 truncate text-xs text-slate-500">
                                      Документ: {task.document_name}
                                    </div>
                                  )}
                                  {task.kind === "signing" && (
                                    <div className="mt-1 text-xs text-slate-400">
                                      {`Маршрут: ${task.signed_count || 0} из ${task.signer_count || 0} подписант(ов) • ${
                                        task.signing_current_signer_name
                                          ? `сейчас подписывает ${task.signing_current_signer_name} • `
                                          : ""
                                      }штампы ${
                                        task.signing_placement_mode === "all_pages"
                                          ? "на всех листах"
                                          : "на последнем листе"
                                      }`}
                                    </div>
                                  )}
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
                                  {task.kind === "signing" && task.document_name && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDocumentViewerTask(task)
                                      }
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                                    >
                                      Документ
                                    </button>
                                  )}
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

                                  {task.kind === "signing" && canSignNow && (
                                    <button
                                      type="button"
                                      onClick={() => setSigningTask(task)}
                                      className="rounded-lg border border-emerald-300/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(209,250,229,0.94))] px-2.5 py-1 text-xs font-semibold text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(5,46,22,0.08)] transition hover:border-emerald-400 hover:bg-[linear-gradient(180deg,rgba(220,252,231,1),rgba(187,247,208,0.95))]"
                                    >
                                      Подписать
                                    </button>
                                  )}

                                  {task.kind !== "signing" && canManageSelectedTasks && activeBucket !== "done" && (
                                    <button
                                      type="button"
                                      onClick={() => openTransferModal(task)}
                                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                                    >
                                      Передать
                                    </button>
                                  )}

                                  {task.kind !== "signing" && canManageSelectedTasks && activeBucket === "queue" && (
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

                                  {task.kind !== "signing" && canManageSelectedTasks && activeBucket === "in_progress" && (
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

                                  {task.kind !== "signing" && canManageSelectedTasks && activeBucket === "done" && (
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/35 p-4">
          <form
            onSubmit={(event) => void createTask(event)}
            className="my-auto flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h3 className="text-base font-semibold text-slate-900">Создание задачи</h3>
            <p className="mt-1 text-xs text-slate-500">
              Новая задача будет добавлена во вкладку «В очереди».
            </p>

            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <AppSelect
                value={createKind}
                onChange={(event) => {
                  const nextKind = event.target.value as TaskKind;
                  setCreateKind(nextKind);
                  if (nextKind !== "signing") {
                    setCreateDocument(null);
                    setCreateSignerIds([]);
                    setCreateStampTemplate(null);
                    setStampPlacementOpen(false);
                  }
                }}
                wrapperClassName="w-full rounded-2xl border border-slate-200 bg-white text-slate-700 ring-slate-300 transition focus-within:ring-2"
                selectClassName="px-3 py-2 pr-9 text-sm text-slate-700"
              >
                <option value="task">Задача</option>
                <option value="signing">Подписание</option>
              </AppSelect>
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

              {createKind === "signing" && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {"Подписанты"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {"Порядок подписи задаётся порядком выбранных пользователей."}
                        </div>
                      </div>
                      <div className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {createSignerIds.length}
                      </div>
                    </div>

                    {createSigningMembers.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {createSigningMembers.map((member, index) => (
                          <div
                            key={member.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-900">{member.name}</div>
                              <div className="text-xs text-slate-500">@{member.username}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
                                {index + 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => moveCreateSigner(member.id, -1)}
                                disabled={index === 0}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveCreateSigner(member.id, 1)}
                                disabled={index === createSigningMembers.length - 1}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleCreateSigner(member.id)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
                              >
                                {"Убрать"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {members.map((member) => {
                        const isSelected = createSignerIds.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => toggleCreateSigner(member.id)}
                            className={cls(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                              isSelected
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                            )}
                          >
                            {member.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-xs font-medium text-slate-600">
                      {"Документ для подписания"}
                    </div>
                    <DocumentDropField
                      file={createDocument}
                      onFileChange={(file) => {
                        setCreateDocument(file);
                        setCreateStampTemplate(null);
                        setStampPlacementOpen(false);
                      }}
                      disabled={creatingTask}
                      accept=".pdf,application/pdf"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {"Штампы"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {"После выбора PDF и подписантов откроется превью последнего листа для размещения общего блока штампов."}
                        </div>
                      </div>
                      {createStampTemplate && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                          {"Готово"}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                      <div>
                        {createStampTemplate ? (
                          <>
                            {"Блок штампов размещён: "}
                            {createStampTemplate.placementMode === "all_pages"
                              ? "на всех листах"
                              : "на последнем листе"}
                          </>
                        ) : (
                          "Шаблон ещё не настроен"
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setStampPlacementOpen(true)}
                        disabled={!createDocument || createSignerIds.length === 0}
                        className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        {createStampTemplate ? "Изменить" : "Разместить"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex shrink-0 justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={
                  creatingTask ||
                  !createTitle.trim() ||
                  (createKind === "signing" &&
                    (!createDocument || createSignerIds.length === 0 || !createStampTemplate))
                }
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {creatingTask ? "Сохранение..." : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {stampPlacementOpen && createDocument && createSigningMembers.length > 0 && (
        <SigningStampPlacementModal
          file={createDocument}
          signers={createSigningMembers}
          initialValue={createStampTemplate}
          onClose={() => setStampPlacementOpen(false)}
          onConfirm={(value) => {
            setCreateStampTemplate(value);
            setStampPlacementOpen(false);
          }}
        />
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

      {documentViewerTask && documentViewerTask.document_name && (
        <TaskDocumentViewerModal
          taskId={documentViewerTask.id}
          taskTitle={documentViewerTask.title}
          documentName={documentViewerTask.document_name}
          documentMimeType={documentViewerTask.document_mime_type}
          onClose={() => setDocumentViewerTask(null)}
        />
      )}

      {signingTask && (
        <TaskSigningModal
          open={!!signingTask}
          task={signingTask}
          onClose={() => setSigningTask(null)}
          onSigned={handleSigningSaved}
        />
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
                aria-label="Закрыть комментарии"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <CloseIcon />
              </button>
            </div>

            <div
              ref={commentsViewportRef}
              className="mt-4 max-h-[340px] min-h-[220px] space-y-3 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
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
                    <div className="mt-2">
                      <span
                        className={cls(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                          comment.kind === "transfer"
                            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {comment.kind === "transfer" ? "Передача" : "Комментарий"}
                      </span>
                    </div>
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
