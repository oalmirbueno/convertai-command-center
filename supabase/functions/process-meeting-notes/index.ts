import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller) throw new Error("Invalid token");

    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!callerRole) throw new Error("Unauthorized: admin only");

    const { content, fileTexts, clientId, projectType } = await req.json();

    if (!clientId) throw new Error("Missing clientId");

    // Combine all text sources
    const allContent: string[] = [];
    if (content?.trim()) allContent.push(`--- Anotações manuais ---\n${content.trim()}`);
    if (fileTexts && Array.isArray(fileTexts)) {
      fileTexts.forEach((ft: { name: string; text: string }, i: number) => {
        allContent.push(`--- Documento ${i + 1}: ${ft.name} ---\n${ft.text}`);
      });
    }

    if (allContent.length === 0) throw new Error("No content provided");

    const combinedContent = allContent.join("\n\n");

    // Get client info
    const { data: clientProfile } = await adminClient
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", clientId)
      .maybeSingle();

    const clientName = clientProfile?.company_name || clientProfile?.full_name || "Cliente";

    const systemPrompt = `Você é um Diretor de Projetos experiente em agências de marketing digital. 
Sua função é analisar documentos de reunião, atas, briefings e anotações para extrair e organizar um plano de projeto completo.

IMPORTANTE: Responda APENAS usando a tool/function fornecida. Não escreva texto livre.

Contexto:
- Cliente: ${clientName}
- Tipo de projeto: ${projectType}

Analise TODO o conteúdo fornecido (pode incluir múltiplos documentos) e:
1. Identifique o objetivo principal do projeto
2. Extraia escopo detalhado organizando informações de todos os documentos
3. Defina marcos (milestones) realistas com datas relativas
4. Sugira um nome claro e profissional para o projeto
5. Estime um prazo total baseado na complexidade
6. Liste os objetivos-chave do projeto

Seja detalhado no escopo — organize as informações como um diretor de projetos faria, agrupando por tema/área.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: combinedContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_project_plan",
              description: "Create a structured project plan from meeting documents",
              parameters: {
                type: "object",
                properties: {
                  project_name: {
                    type: "string",
                    description: "Professional project name"
                  },
                  description: {
                    type: "string",
                    description: "Brief project description (max 200 chars)"
                  },
                  scope: {
                    type: "string",
                    description: "Detailed project scope organized by topics/areas. Use markdown formatting."
                  },
                  objectives: {
                    type: "string",
                    description: "Key project objectives, one per line"
                  },
                  estimated_days: {
                    type: "number",
                    description: "Estimated total project duration in days"
                  },
                  milestones: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        days_from_start: { type: "number", description: "Days from project start" }
                      },
                      required: ["title", "days_from_start"],
                      additionalProperties: false
                    },
                    description: "Project milestones in chronological order"
                  },
                  initial_tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        priority: { type: "string", enum: ["low", "medium", "high"] }
                      },
                      required: ["title", "priority"],
                      additionalProperties: false
                    },
                    description: "Initial backlog tasks to create"
                  }
                },
                required: ["project_name", "description", "scope", "objectives", "estimated_days", "milestones", "initial_tasks"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "create_project_plan" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return structured data");

    const plan = JSON.parse(toolCall.function.arguments);

    // Create the project
    const startDate = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + (plan.estimated_days || 30));

    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    const { data: project, error: projectError } = await adminClient.from("projects").insert({
      name: plan.project_name,
      description: plan.description,
      scope: plan.scope,
      objectives: plan.objectives,
      project_type: projectType,
      client_id: clientId,
      created_by: caller.id,
      start_date: formatDate(startDate),
      deadline: formatDate(deadline),
      status: "planning",
      progress: 0,
    }).select().single();

    if (projectError) throw projectError;

    // Create milestones
    if (plan.milestones?.length) {
      const milestones = plan.milestones.map((m: any, i: number) => {
        const targetDate = new Date(startDate);
        targetDate.setDate(targetDate.getDate() + (m.days_from_start || (i + 1) * 7));
        return {
          project_id: project.id,
          title: m.title,
          description: m.description || null,
          target_date: formatDate(targetDate),
          status: i === 0 ? "completed" : "pending",
          milestone_order: i,
        };
      });
      await adminClient.from("milestones").insert(milestones);
    }

    // Create initial tasks
    if (plan.initial_tasks?.length) {
      const tasks = plan.initial_tasks.map((t: any, i: number) => ({
        project_id: project.id,
        title: t.title,
        description: t.description || null,
        priority: t.priority || "medium",
        status: "backlog",
        task_order: i,
      }));
      await adminClient.from("tasks").insert(tasks);
    }

    // Create kick-off update
    await adminClient.from("updates").insert({
      project_id: project.id,
      author_id: caller.id,
      message: "Projeto criado via IA a partir de ata de reunião",
      update_type: "milestone",
    });

    // Notify client
    await adminClient.from("notifications").insert({
      user_id: clientId,
      message: `Novo projeto criado: ${plan.project_name}`,
      notification_type: "system",
      link: "/dashboard",
    });

    return new Response(JSON.stringify({
      success: true,
      project_id: project.id,
      plan,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("process-meeting-notes error:", err);
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
