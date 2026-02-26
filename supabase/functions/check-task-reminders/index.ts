import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const today = new Date().toISOString().split("T")[0];

    // Get all tasks with due dates that are not done
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, due_date, assigned_to, project_id, status")
      .neq("status", "done")
      .not("due_date", "is", null)
      .not("assigned_to", "is", null);

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: "No tasks to check" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let notifiedCount = 0;

    for (const task of tasks) {
      const dueDate = task.due_date;
      const isOverdue = dueDate < today;
      const isDueToday = dueDate === today;

      if (isOverdue) {
        // Check if we already notified today for this task
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", task.assigned_to)
          .eq("notification_type", "task")
          .ilike("message", `%${task.title}%atrasada%`)
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("notifications").insert({
            user_id: task.assigned_to,
            message: `⚠️ Tarefa "${task.title}" está atrasada!`,
            notification_type: "task",
            link: "/kanban",
          });
          notifiedCount++;
        }
      } else if (isDueToday) {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", task.assigned_to)
          .eq("notification_type", "task")
          .ilike("message", `%${task.title}%vence hoje%`)
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("notifications").insert({
            user_id: task.assigned_to,
            message: `📅 Tarefa "${task.title}" vence hoje!`,
            notification_type: "task",
            link: "/kanban",
          });
          notifiedCount++;
        }
      }
    }

    // Also notify admin about overdue tasks summary
    const overdueTasks = tasks.filter((t) => t.due_date < today);
    if (overdueTasks.length > 0) {
      const { data: adminRole } = await supabase.rpc("get_admin_user_id");
      if (adminRole) {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", adminRole)
          .eq("notification_type", "task")
          .ilike("message", `%tarefas atrasadas%`)
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("notifications").insert({
            user_id: adminRole,
            message: `🔴 ${overdueTasks.length} tarefa(s) atrasada(s) no sistema`,
            notification_type: "task",
            link: "/kanban",
          });
          notifiedCount++;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, notifiedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
