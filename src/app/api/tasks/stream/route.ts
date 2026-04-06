import { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/require-api-role";
import { getAccessibleTaskGroups } from "@/lib/tasks";
import { subscribeTaskEvents } from "@/lib/task-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseGroupIds(value: string | null) {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
}

function toSseMessage(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  const accessibleGroups = await getAccessibleTaskGroups(auth.user);
  const accessibleGroupIds = accessibleGroups.map((group) => group.id);
  const requestedGroupIds = parseGroupIds(new URL(request.url).searchParams.get("groupIds"));

  const allowedGroupIds =
    requestedGroupIds.length > 0
      ? requestedGroupIds.filter((groupId) => accessibleGroupIds.includes(groupId))
      : accessibleGroupIds;

  const allowedGroupIdsSet = new Set(allowedGroupIds);
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(toSseMessage(event, payload)));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // ignore already closed controller
        }
      };

      const unsubscribe = subscribeTaskEvents((payload) => {
        if (!allowedGroupIdsSet.has(payload.groupId)) return;

        if (
          (payload.type === "task_transferred" || payload.type === "task_comment_added") &&
          payload.assigneeId !== auth.user.id &&
          payload.actorId !== auth.user.id
        ) {
          return;
        }

        send("task", payload);
      });

      const heartbeatId = setInterval(() => {
        send("ping", { at: new Date().toISOString() });
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeatId);
        unsubscribe();
        request.signal.removeEventListener("abort", close);
      };

      request.signal.addEventListener("abort", close);

      send("ready", {
        connectedAt: new Date().toISOString(),
        groupIds: allowedGroupIds,
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
