import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { requireApiRole } from "@/lib/require-api-role";
import { appendTaskHistory, getTaskById, userCanAccessTaskGroup } from "@/lib/tasks";

type TaskCommentRow = {
  id: number;
  task_id: number;
  author_id: number;
  body: string;
  created_at: string;
  author_name: string;
  author_username: string;
};

function parseNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const taskId = parseNumber(url.searchParams.get("taskId"));
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const commentsRes = await dbQuery<TaskCommentRow>(
      `
        SELECT
          c.id,
          c.task_id,
          c.author_id,
          c.body,
          c.created_at,
          u.name AS author_name,
          u.username AS author_username
        FROM task_comments c
        INNER JOIN users u ON u.id = c.author_id
        WHERE c.task_id = $1
        ORDER BY c.created_at ASC, c.id ASC
      `,
      [taskId]
    );

    return NextResponse.json({ comments: commentsRes.rows });
  } catch (error) {
    console.error("Failed to load task comments:", error);
    return NextResponse.json({ error: "Failed to load task comments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, "user");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const taskId = parseNumber(body?.taskId);
    const text = String(body?.body || "").trim();

    if (!taskId || !text) {
      return NextResponse.json({ error: "taskId and body are required" }, { status: 400 });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const canAccess = await userCanAccessTaskGroup(auth.user, task.group_id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden for this task" }, { status: 403 });
    }

    const commentRes = await dbQuery<TaskCommentRow>(
      `
        INSERT INTO task_comments(task_id, author_id, body)
        VALUES ($1, $2, $3)
        RETURNING
          id,
          task_id,
          author_id,
          body,
          created_at,
          ''::text AS author_name,
          ''::text AS author_username
      `,
      [taskId, auth.user.id, text]
    );

    const comment = commentRes.rows[0];
    await appendTaskHistory(taskId, auth.user.id, "comment_add", null, { comment_id: comment.id });

    const withAuthorRes = await dbQuery<TaskCommentRow>(
      `
        SELECT
          c.id,
          c.task_id,
          c.author_id,
          c.body,
          c.created_at,
          u.name AS author_name,
          u.username AS author_username
        FROM task_comments c
        INNER JOIN users u ON u.id = c.author_id
        WHERE c.id = $1
      `,
      [comment.id]
    );

    return NextResponse.json({ comment: withAuthorRes.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task comment:", error);
    return NextResponse.json({ error: "Failed to create task comment" }, { status: 500 });
  }
}
