export interface NotificationRow {
  user_id: string;
  message: string;
  notification_type: string;
  link: string | null;
}

/** Failed recipient/dedup reads are not an empty result authorizing a write. */
export function notificationReadRows<T>(result: { data: T[] | null; error: unknown }): T[] {
  if (result.error || !Array.isArray(result.data)) {
    throw new Error("Notification lookup unavailable");
  }
  return result.data;
}

/** Final response boundary, after the handler's auth, rate limit and dedup.
 * Success means the DB accepted the write, not delivery to a user's device. */
export async function notificationWriteResponse(
  rows: NotificationRow[],
  insert: (rows: NotificationRow[]) => PromiseLike<{ error: unknown }>,
  headers: Record<string, string>,
): Promise<Response> {
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  try {
    if (rows.length > 0) {
      const { error } = await insert(rows);
      if (error) throw new Error("Notification insert failed");
    }
    return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
      headers: jsonHeaders,
    });
  } catch {
    // No database messages, user IDs or request contents in error responses.
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: jsonHeaders,
    });
  }
}
