// Aceleriq OS — Escritor dos rituais da Central
//
// Antes, cada ritual saía de um molde com três frases alternativas sorteadas:
// mudava a palavra, nunca o raciocínio. O cliente lia "consistência: publicar
// no ritmo planejado" tivesse acontecido o que tivesse.
//
// Aqui a IA escreve a partir dos FATOS daquele cliente naquela semana e do
// tipo de ritual pedido. O molde continua existindo no painel como reserva:
// se a IA não responder, o cliente recebe o texto de sempre, nunca um erro.
//
// Memória e continuidade (25/09/2026): com `client_id`, o servidor lê com o
// JWT de quem pediu (RLS) as últimas semanas de rituais enviados e gerados,
// o que mudou desde o último, as pendências, os números, o cérebro do
// cliente e a fase do método Acelera. Depois de escrever, confere a repetição
// contra os anteriores (n-gramas; o Jev só como aviso). Nada de laço de
// correção: o texto volta como saiu, com o aviso.
//
// Estado real, promessas e modelo (frente CE, 28/09/2026):
// - o ESTADO REAL do cliente é lido aqui (orgânico e pago separados, com
//   período, metas de seguidores, o que o agente de tráfego fez), e vai ao
//   escritor ANTES dos fatos do painel. Os fatos do navegador chegavam com
//   o dossiê inteiro na frente e eram cortados em 12 mil caracteres: a semana
//   ficava de fora e a mensagem se repetia;
// - campanha da Mesa é classificada (orgânica, paga, mista) pela regra e pelo
//   Jev quando a regra não sabe; promessa da última mensagem é conferida
//   contra o painel (regra e Jev apontando a evidência);
// - promessa da semana passada sem prova vira tarefa urgente e aviso para a
//   equipe (reforco.ts); para o cliente, "em andamento";
// - GPT-6 Luna com raciocínio máximo pelo motor das mesas, com seletor na
//   Central; resposta com fôlego (a plataforma derruba em 150 s sem resposta).
//
// Ação "memorizar" ({ action: "memorizar", report_id }): depois do envio, o
// combinado no ritual entra no cérebro do cliente (agente_memoria, área
// geral, vale 21 dias) para a próxima semana retomar.
//
// Segurança: só equipe autenticada; leitura e escrita com o JWT dela. O
// cliente de serviço só chama avisar_equipe_do_cliente (backend) e o motor.

import { corsHeaders as corsDoSupabase } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { recortarDossie } from "../_shared/dossie-recortado.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { escolhaDoModelo } from "../_shared/modelo-da-central.ts";
import { estadoRealComoTexto, evidenciasDoEstado, lerEstadoReal } from "../_shared/estado-real-do-cliente.ts";
import { julgarDaCentral, promessasComoTexto, rotuloDoCanal } from "./modulos/julgamentos-da-central.ts";
import { conferirRepeticao, escreverRitual, MOMENTO, RITUAL_BRIEF } from "./escritor.ts";
import { lerContextoDoRitual } from "./contexto.ts";
import { extrairMemoriaDoRitual } from "./memoria.ts";
import { chaveDaPromessa, reforcarPromessas } from "./reforco.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";
// O navegador guarda a resposta do preflight (OPTIONS) em vez de perguntar de novo a cada chamada.
const corsHeaders = { ...corsDoSupabase, "Access-Control-Max-Age": "7200" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Sessão expirada." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: "Sessão expirada." }, 401);
    const { data: isStaff } = await admin.rpc("is_staff", { _user_id: userData.user.id });
    if (!isStaff) return jsonResponse({ error: "Somente equipe." }, 403);

    // O banco com o JWT de quem pediu: a RLS decide o que ele vê e grava.
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json().catch(() => ({}));

    if (body?.action === "memorizar") {
      const reportId = String(body?.report_id || "");
      if (!UUID.test(reportId)) return jsonResponse({ error: "report_id inválido." }, 400);
      const { data: rep } = await db.from("reports").select("id, client_id, status, summary, next_steps, created_at, metrics").eq("id", reportId).maybeSingle();
      if (!rep || rep.status !== "published") return jsonResponse({ ok: false, motivo: "ritual não enviado" });
      const mem = extrairMemoriaDoRitual(String(rep.summary || ""), String(rep.next_steps || ""));
      if (!mem.promessas.length) return jsonResponse({ ok: true, gravado: false, motivo: "sem combinado no texto" });
      const quando = new Date(String((rep.metrics as Record<string, unknown> | null)?.sent_at || rep.created_at))
        .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
      const g = await gravarNoCerebro(db, {
        client_id: String(rep.client_id),
        area: "geral",
        categoria: "aprendizado",
        texto: `Combinado com o cliente no ritual de ${quando}: ${mem.promessas.slice(0, 3).join(" | ")}`.slice(0, 590),
        motivo: "Retomar na próxima mensagem dizendo o que andou.",
        evidencia: `reports:${reportId}`,
        fonte: "central_ritual",
        criado_por: userData.user.id,
        referencia_id: reportId,
        valido_dias: 21,
      });
      return jsonResponse({ ok: g.gravada, situacao: g.situacao, memoria: mem, erro: g.erro });
    }

    const ritual = MOMENTO[String(body?.moment || "")] || String(body?.ritual || "");
    // AB2: os fatos terminam com o dossiê; grande demais, fica o começo curto e o fim (o mais recente).
    const facts = recortarDossie(String(body?.facts || ""), 12000);
    const clientName = String(body?.client_name || "Cliente").slice(0, 120);
    // Primeiro nome da pessoa de contato: a mensagem fala com gente, nao com CNPJ.
    const contactName = String(body?.contact_name || "").trim().split(/\s+/)[0]?.slice(0, 40) || "";
    if (!RITUAL_BRIEF[ritual] || !facts) {
      return jsonResponse({ error: "Ritual ou fatos ausentes." }, 400);
    }
    // Aprimorar: o painel manda o texto atual e a IA melhora e complementa,
    // em vez de escrever outro do zero e perder o que a pessoa ja ajustou.
    const atual = body?.improve && typeof body.improve === "object" ? body.improve as { summary?: unknown; next_steps?: unknown } : null;
    const textoAtual = atual ? String(atual.summary || "").slice(0, 8000).trim() : "";
    const passoAtual = atual ? String(atual.next_steps || "").slice(0, 1000).trim() : "";

    const clientId = typeof body?.client_id === "string" && UUID.test(body.client_id) ? body.client_id : "";
    const reportId = typeof body?.report_id === "string" && UUID.test(body.report_id) ? body.report_id : null;
    if (clientId) {
      const { data: pode } = await db.rpc("can_access_client", { _client_id: clientId });
      if (pode !== true) return jsonResponse({ error: "Sem acesso a este cliente." }, 403);
    }
    const escolha = escolhaDoModelo(body?.modelo, body?.raciocinio);
    const reforcar = body?.reforcar !== false;
    const usuarioId = userData.user.id;

    // Daqui para a frente é trabalho longo (raciocínio máximo): resposta com fôlego.
    return respostaComFolego(async () => {
      try {
        // Memória, estado real e julgamentos montados no servidor. Falha aqui nunca derruba o ritual.
        const agora = new Date();
        const contexto = clientId
          ? await lerContextoDoRitual(db, clientId, { ritual, excluirReportId: reportId, agora }).catch((e) => {
            console.warn(`[ritual] contexto falhou: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          })
          : null;
        const estado = clientId
          ? await lerEstadoReal(db, clientId, { agora, desde: contexto?.desde ?? null }).catch((e) => {
            console.warn(`[ritual] estado real falhou: ${e instanceof Error ? e.message : String(e)}`);
            return null;
          })
          : null;

        // Promessas da última mensagem ENVIADA (não do rascunho que está sendo aprimorado).
        const ultimoEnviado = contexto?.anteriores.find((r) => r.situacao === "enviado") ?? null;
        const memUltimo = ultimoEnviado ? (ultimoEnviado.memoria ?? extrairMemoriaDoRitual(ultimoEnviado.texto, ultimoEnviado.proximo_passo)) : null;
        const promessas = (memUltimo?.promessas ?? []).slice(0, 6).map((texto) => ({
          id: chaveDaPromessa(ultimoEnviado?.id, texto),
          texto,
          feitaEm: new Date(ultimoEnviado!.quando).toISOString(),
        }));
        const confirmadas = new Set((estado?.operacao.tarefasDaCentral ?? []).filter((t) => t.status === "done").map((t) => t.source));
        const evidencias = [
          ...(contexto?.movimentos ?? []).map((m) => ({ quando: new Date(m.quando).toISOString(), texto: m.titulo + (m.detalhe ? ` (${m.detalhe})` : "") })),
          ...(estado ? evidenciasDoEstado(estado) : []).map((x) => ({ quando: new Date(x.quando).toISOString(), texto: x.texto })),
        ];
        const julgados = estado
          ? await julgarDaCentral({
            cliente: clientName,
            campanhas: estado.campanhasDaMesa,
            anunciosNoAr: estado.pago.campanhasNoAr.map((c) => c.nome),
            promessas,
            evidencias,
            confirmadasPeloDono: confirmadas,
          }, jevPerguntar).catch((e) => (registrarFalha("ritual-writer: julgarDaCentral falhou", e), null))
          : null;

        // Reforço interno: promessa da semana passada em andamento vira tarefa urgente e aviso.
        let reforco: Awaited<ReturnType<typeof reforcarPromessas>> | null = null;
        if (reforcar && estado && julgados) {
          const emAndamento = julgados.promessas.filter((p) => p.situacao === "em_andamento");
          if (emAndamento.length) {
            reforco = await reforcarPromessas(db, admin, {
              clientId, clienteNome: clientName, projetoId: estado.operacao.projetoAtivo, usuarioId,
              promessas: emAndamento.map((p) => ({ id: p.id, texto: p.texto, feitaEm: p.feitaEm })),
              existentes: estado.operacao.tarefasDaCentral, agora,
            }).catch((e) => ({ criadas: [], reforcadas: [], avisados: 0, erros: [e instanceof Error ? e.message : "falha"] }));
          }
        }

        const estadoTexto = estado
          ? estadoRealComoTexto(estado, {
            ritual,
            canais: (julgados?.campanhas ?? []).map((c) => ({ id: c.id, rotulo: rotuloDoCanal(c.canal) })),
          })
          : "";

        const escrito = await escreverRitual({
          ritual, clientName, contactName, facts,
          continuidade: contexto?.texto,
          estado: estadoTexto,
          promessas: julgados ? promessasComoTexto(julgados.promessas) : "",
          textoAtual, passoAtual,
          clientId: clientId || undefined,
          criadoPor: usuarioId,
          escolha,
        });
        if (!escrito) return jsonResponse({ title: null, body: null, source: "fallback" });
        const nextSteps = escrito.next_steps;

        // Conferência de repetição contra o que já foi dito (aviso, nunca correção).
        const repeticao = contexto
          ? await conferirRepeticao(escrito.body, contexto.anteriores.map((a) => ({ quando: a.quando, titulo: a.titulo, texto: a.texto })))
          : null;

        const alertas = [
          ...(escrito.reserva ? [escrito.reserva] : []),
          ...(escrito.robo.length ? [`Expressões de molde no texto: ${escrito.robo.join(", ")}. Vale trocar antes de enviar.`] : []),
          ...(reforco && (reforco.criadas.length || reforco.reforcadas.length)
            ? [`${reforco.criadas.length + reforco.reforcadas.length} combinado(s) da semana passada sem prova no painel viraram tarefa urgente${reforco.avisados ? " e a equipe foi avisada" : ""}.`]
            : []),
          ...escrito.alertas,
        ].slice(0, 6);

        return jsonResponse({
          title: escrito.title,
          body: escrito.body,
          next_steps: nextSteps,
          alertas,
          tarefas_sugeridas: escrito.tarefas_sugeridas,
          repeticao,
          memoria: extrairMemoriaDoRitual(escrito.body, nextSteps),
          contexto: contexto
            ? { fase: contexto.fase, motivo_da_fase: contexto.motivoDaFase, desde: contexto.desde, contagem: contexto.contagem, avisos: [...contexto.avisos, ...(estado?.avisos ?? [])].slice(0, 16) }
            : null,
          promessas: julgados?.promessas.map((p) => ({ texto: p.texto, situacao: p.situacao, prova: p.prova?.texto ?? null, fonte: p.fonte })) ?? [],
          campanhas: julgados?.campanhas ?? [],
          // Metas que ESTA mensagem comemora: gravadas no rascunho; depois do envio, não se comemora de novo.
          metas_reconhecidas: estado ? estado.metas.paraComemorar.map((m) => m.id) : [],
          reforco,
          jev: julgados?.jev ?? null,
          source: "ai",
          model: escrito.model,
          modelo_rotulo: escrito.modelo_rotulo,
          raciocinio: escrito.raciocinio,
          custo_usd: escrito.custo_usd,
          usage: escrito.usage,
          improved: !!textoAtual,
        });
      } catch (error) {
        // Falha aqui nunca pode travar o ritual: o painel usa o texto de reserva.
        console.warn(`[ritual] falha: ${error instanceof Error ? error.message : String(error)}`);
        return jsonResponse({ title: null, body: null, source: "fallback" });
      }
    }, corsHeaders);
  } catch (error) {
    console.warn(`[ritual] falha: ${error instanceof Error ? error.message : String(error)}`);
    return jsonResponse({ title: null, body: null, source: "fallback" });
  }
});
