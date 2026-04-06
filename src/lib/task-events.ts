import type { TaskWithMetaRow } from "@/lib/tasks";

export type TaskStreamEventType =
  | "task_created"
  | "task_updated"
  | "task_status_changed"
  | "task_transferred"
  | "task_comment_added";

export type TaskStreamEvent = {
  type: TaskStreamEventType;
  groupId: number;
  taskId: number;
  assigneeId: number | null;
  actorId: number | null;
  occurredAt: string;
  task?: TaskWithMetaRow | null;
};

type TaskEventListener = (event: TaskStreamEvent) => void;

type TaskEventHub = {
  listeners: Set<TaskEventListener>;
};

declare global {
  // eslint-disable-next-line no-var
  var __reportStudioTaskEventHub: TaskEventHub | undefined;
}

function getTaskEventHub(): TaskEventHub {
  if (!globalThis.__reportStudioTaskEventHub) {
    globalThis.__reportStudioTaskEventHub = {
      listeners: new Set<TaskEventListener>(),
    };
  }

  return globalThis.__reportStudioTaskEventHub;
}

export function subscribeTaskEvents(listener: TaskEventListener) {
  const hub = getTaskEventHub();
  hub.listeners.add(listener);

  return () => {
    hub.listeners.delete(listener);
  };
}

export function publishTaskEvent(
  event: Omit<TaskStreamEvent, "occurredAt"> & { occurredAt?: string }
) {
  const hub = getTaskEventHub();
  const payload: TaskStreamEvent = {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  };

  hub.listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error("Task stream listener failed:", error);
    }
  });
}
