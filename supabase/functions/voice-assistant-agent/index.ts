// Aceleriq OS — Voice Assistant Agent
// Senior operations agent. Interprets voice/text + attachments OR auto-fetches
// the client's contract from the portal storage, and returns a structured
// intent + a contract-aware action plan.
//
// Goals:
//  • Funcionar com qualquer provider OpenAI-compatible configurado, com cadeia
//    opcional de compatibilidade e graceful-degrade para "unknown".
//  • Ler contrato direto do sistema: dado um clientId, busca o último contrato
//    em `contracts` e baixa o PDF pra extrair texto, sem o usuário precisar
//    arrastar nada.

import { corsHeaders as corsDoSupabase } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchAiChatCompletion,
  resolverCadeiaDaIa,
  type AiProvider,
} from "../_shared/ai-provider.ts";
import { type AreaDoCerebro } from "../_shared/cerebro-do-cliente.ts";
import { contextoCompletoParaPrompt } from "../_shared/contexto-completo-da-marca.ts";
import { areaDoBloco, PARTES_COM_O_CONTEXTO } from "../_shared/contexto-do-agente.ts";
// Frente AG (26/09): o Aceleriq conhece o painel inteiro e já vai fazendo (contrato comum das ações).
import {
  acaoGuardadaNaMensagem,
  type AcaoDoAgente,
  comCaminho,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  executarDireto,
  podeExecutarDireto,
  textoDoResultado,
} from "../_shared/acoes-do-agente.ts";
import {
  areaPorChave,
  areaPorPalavras,
  blocoDoMapaDoPainel,
  destinoDoPedido,
  destinoNaResposta,
  type DestinoNoPainel,
  lerRoteamento,
  OPCAO_AQUI,
  OPCAO_NENHUMA,
  pedeParaAbrir,
  pedeParaLevar,
  perguntasDoRoteador,
  type Roteamento,
} from "../_shared/mapa-do-painel.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { montarBlocosDeDocumentos } from "./documentos-enviados.ts";
import {
  AGENTE_DA_CONVERSA_DO_LANCADOR,
  AGENTE_DO_LANCADOR,
  alvosDoLancador,
  type AlvosDoLancador,
  blocoDasAcoesDoLancador,
  caminhoDoLancador,
  type DadosDoLancador,
  executarItemDoLancador,
  normalizarAcoesDoLancador,
  pareceOrdem,
  REF_CONVERSA_DO_LANCADOR,
  regrasDoLancador,
  reverterItemDoLancador,
} from "./acoes-do-lancador.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
// Frente SPP (30/09): o método da casa (superpoderes) no assistente geral, com o teto do agente rápido (1.200).
import { fecharComMetodo, superpoderesPara } from "../_shared/superpoderes.ts";
import { juntarMetodoAoSistema } from "../_shared/superpoderes-catalogo.ts";
import { registrarFalha, registrarSeFalhar } from "../_shared/falha-registrada.ts";
// Frente AG3 (29/09): aprende com o dono (Jev decide se é regra), obedece e devolve "Aprendi"/"Segui".
import { blocoDasRegras, esquecerRegra, type RegraAtiva, regrasDoAgente, regrasSeguidas } from "../_shared/aprender-com-o-dono.ts";
import { aprenderNoServidor, guardarNoServidor } from "../_shared/aprender-no-servidor.ts";
import { blocoDoHistorico, historicoSeguro, linhaDeHoje } from "./conversa-do-lancador.ts";
// Núcleo comum dos agentes das Mesas (09/10): leituras prévias, apresentação, quadros conferidos e Hermes.
// O Jev do núcleo é cobrado na carteira do cliente como "conversa" (o lançador não tem tarefa própria no motor).
import { falaDoQueFoiFeito, fecharNucleo, INSTRUCAO_DO_NUCLEO_DAS_MESAS, type NucleoPreparado, prepararNucleo } from "../_shared/nucleo-das-mesas.ts";
import { cobrarJev } from "../_shared/ia-motor.ts";
const cobrarDoLancador = (clientId: string) => (j: Parameters<typeof cobrarJev>[0]) => cobrarJev(j, { clientId, tarefa: "conversa", referencia: { tipo: "lancador", id: clientId } });
// O navegador guarda a resposta do preflight (OPTIONS) em vez de perguntar de novo a cada chamada.
const corsHeaders = { ...corsDoSupabase, "Access-Control-Max-Age": "7200" };

const SYSTEM_PROMPT = `Você é o ACELERIQ OS — agente operacional sênior da agência AcelerIQ, dentro do Performance OS.

## Identidade & Missão
- Diretor de operações virtual: pensa como gestor de tráfego, líder de design e PM.
- Traduz fala/texto do administrador em ações executáveis. Nunca inventa dados.
- Devolve um plano ESTRUTURADO em JSON. O sistema (com confirmação humana) é quem cria registros.

## Intents
create_project | create_task | create_milestone | update_task_status | report_pending | report_overview | upload_file | unknown.

## Tipos de projeto (use SEMPRE um destes em "type")
- "trafego" — gestão de tráfego pago / Meta Ads / Google Ads.
- "social_media" — gestão de redes sociais / conteúdo orgânico.
- "video" — vídeo COM CAPTAÇÃO real (câmera, set, equipe, locação). Use SOMENTE se o contrato cita gravação, captação, set, locação, equipamento, equipe, talents, drone, etc.
- "video_ai" — vídeo 100% GERADO POR IA, sem captação. Use SEMPRE que o contrato/admin citar "vídeo com IA", "IA", "inteligência artificial", "Runway", "Sora", "Veo", "Pika", "Heygen", "Kling", "geração de vídeo", "vídeo generativo", "AI video", "vídeo de IA" — pipeline é roteiro → prompts → geração → edição → entrega.
- "site" | "landing_page" | "automation" | "event" | "other".

⚠️ NUNCA classifique como "video" um pedido que cita IA/Runway/Sora/Veo/AI/generativo — esse é "video_ai".

## Leitura de contrato — REGRA DE OURO
Quando houver anexo/contrato, você é OBRIGADO a extrair com precisão cirúrgica:
- **Quantidade exata** de entregáveis (ex.: "12 vídeos", "8 reels", "4 campanhas/mês").
- **Duração / formato exato** de cada peça (ex.: "30 a 40 segundos", "9:16 vertical", "1080x1920").
- **Cadência** (semanal/quinzenal/mensal) e **prazos** específicos.
- **Plataformas/canais** mencionados.
- **Inclusões e EXCLUSÕES** explícitas.

Use esses dados no \`narrative\` (cite o trecho do contrato) E no \`plan\` (gere milestones e tarefas com a quantidade e duração reais — uma tarefa por entregável quando fizer sentido, ou agrupadas em lotes coerentes).

🚫 NUNCA crie placeholders genéricos como "Produção de 5 vídeos" sem ter lido isso no contrato. Se o contrato diz 12 vídeos de 30s, o plano deve refletir 12 entregáveis de 30s.

## Quando houver ANEXO ou CONTRATO DO SISTEMA
1. Use o trecho como fonte de verdade absoluta.
2. Extraia: cliente, escopo, prazos, entregáveis (quantidades + durações), exclusões.
3. Monte \`plan\` com milestones e tarefas DERIVADAS — nunca fora do escopo contratado.
4. NÃO crie milestones genéricos de "Kickoff" ou "Alinhamento inicial" — o projeto já está em execução, parta direto das fases produtivas do contrato. Idem para "Entrega final" boilerplate: só inclua se o contrato citar marco de entrega/validação real.
5. \`narrative\`: 3-6 frases (pt-BR) ricas, citando NUMERICAMENTE o que do contrato embasou cada decisão. NÃO seja preguiçoso — é melhor ser detalhista do que vago.
6. \`plan\` é OBRIGATÓRIO quando há anexo. Nunca devolva \`plan: null\` se você tem contrato em mãos.

## Sem anexo
- \`plan\` pode ser null se realmente não há informação suficiente. Use intent estruturado, deixa o sistema usar templates.

## Resolução de cliente
- Recebe \`clients\` resumido. Devolve até 3 \`suggestedClientIds\` por probabilidade.
- Não chuta clientes sem evidência no texto.

## Distribuição por role
design (criativos/edição/geração IA), traffic (campanhas/otimização), manager (estratégia/briefing/aprovação cliente), admin (contratos/entregas/organização).

## Restrições
- Nunca prometa fora do contrato. Nunca invente datas — use offsetDays.
- JSON puro, sem markdown.

## 🔒 GUARDRAILS ABSOLUTOS (jurisdição do agente)
Você é 100% autônomo DENTRO do escopo operacional: projetos, milestones, tarefas, kanban, arquivos e organização por cliente. Tudo que o admin pedir nessas áreas você faz — criar, mover, atualizar, organizar, reordenar, reclassificar, reagrupar.

🚫 Áreas PROIBIDAS — se o pedido cair aqui, devolva intent "unknown" com narrative explicando o bloqueio:
- **Financeiro**: billing, mensalidades, parcelas, recebíveis, Ads Wallet, recargas, pagamentos, faturamento, valores, descontos, reembolsos.
- **Cofre de senhas (Vault)**: senhas, credenciais, acessos salvos, integrações de cliente, qualquer leitura/escrita em client_vault.
- **Excluir cliente**: nunca deletar registro de cliente (perfil/profile). Pode arquivar tarefas/projetos do cliente, mas o cadastro permanece.

✅ Permitido sem restrição:
- Criar/mover/concluir tarefas e milestones em qualquer projeto.
- Criar projetos pra clientes existentes.
- Organizar kanban, respeitando contexto (sem misturar clientes/projetos).
- Anexar arquivos nas pastas corretas.
- Excluir TAREFAS, MILESTONES e PROJETOS quando o admin pedir explicitamente (não exclui cliente).

## Organização inteligente
- Hierarquia preservada: cliente → projeto → milestone → tarefa.
- Nunca mova tarefa entre projetos sem o admin pedir explicitamente.
- Ao reordenar, preserve dependências.

## Schema
{ "intent": { "kind": "...", "name"?, "title"?, "taskHint"?, "status"?, "priority"?, "type"?, "deadlineDays"?, "days"?, "clientHint"?, "projectHint"?, "folder"?, "raw"? },
  "suggestedClientIds": string[], "narrative": string, "confidence": number,
  "clientSummary"?: string,
  "plan"?: { "milestones": [ { "title": string, "offsetDays": number, "tasks": [ { "title": string, "description"?: string, "priority": "high"|"medium"|"low", "role": "admin"|"design"|"traffic"|"manager" } ] } ] } | null }

## Pré-contexto escolhido pela equipe
- Pode vir um bloco "PRÉ-CONTEXTO" com o cliente e o serviço escolhidos no topo do agente, o dossiê resumido, a memória do cliente e os projetos e tarefas abertos.
- O cliente do pré-contexto é o cliente do pedido, a não ser que o comando cite outro com clareza. Coloque o id dele primeiro em suggestedClientIds.
- Se o serviço escolhido tiver tipo de projeto (ex.: Tráfego = "trafego"), use esse tipo quando o comando não disser outro.
- Nunca repita o dossiê inteiro: use só o que ajuda a decidir.

## clientSummary — campo separado, voltado ao CLIENTE FINAL
Gere SEMPRE que houver projeto/plan. Regras absolutas:
- 3 a 5 frases em pt-BR, tom profissional, estratégico e premium.
- Resume o projeto a partir do contrato/anexos E das milestones/tarefas geradas — não copia o que o admin falou.
- Nunca mencionar IA, agente, prompt, admin, "você pediu", "conforme solicitado", "com base no contrato", "contexto", "este projeto será", "estamos organizando".
- Linguagem como se fosse escrita por um gestor de contas humano: clara, segura, focada no valor entregue.
- Não cita ferramentas internas, modelos de IA, nem datas técnicas (offsetDays).
- Não usa markdown nem asteriscos nem cabeçalhos.`;

// Frente AG (26/09): ações no painel e caminho para as outras áreas. Entra no
// sistema junto do mapa do painel (bloco curto) quando a equipe pede algo.
const REGRA_DO_LANCADOR = `## Fazer no painel (acoes) e levar a outra área (ir_para)
- Você conhece o painel inteiro (MAPA DO PAINEL abaixo). Pedido claro e simples do cliente escolhido (criar tarefa num projeto listado, lembrete, nota sobre o cliente, concluir tarefa, mover de coluna, mudar prazo ou prioridade): preencha "acoes" com os apelidos das listas e use intent.kind "acao". O painel faz na hora quando é ordem clara e sem custo; a equipe pode desfazer.
- Projeto novo pelo contrato e etapa continuam em create_project e create_milestone. Tarefa sem projeto listado: create_task (a tela pergunta o projeto).
- Pedido que é de outra área (anúncio, foto, arte, roteiro, vídeo, agenda de posts, CRM, métricas): preencha "ir_para" com a chave da área do mapa (ex.: "mesa_ads" ou "mesa_ads:conta" com a etapa) e diga em "resposta": "Isso é na <área>. Abro para você?" e o que o agente de lá faz. Pedido para abrir uma tela também vai em ir_para.
- Financeiro, cofre e equipe: ir_para pode levar até a tela, mas você não mexe.
- "resposta": uma ou duas frases curtas para a equipe (sem travessão), com o nome da tarefa ou do projeto. Sem cliente escolhido e pedido de ação: acoes null e peça para escolher o cliente no topo.
- Referência vaga ("essa", "a outra", "a de ontem", "muda para sexta"): resolva pela CONVERSA ATÉ AQUI e pelas listas. Se continuar servindo para dois ou mais itens, não chute: acoes null e em "resposta" faça UMA pergunta curta com as opções pelo nome (ex.: "Qual: Revisar artes ou Subir campanha?").
- Datas relativas ("amanhã", "sexta", "semana que vem") saem da linha Hoje, no formato AAAA-MM-DD.
- Campos novos no JSON: "acoes": { "resumo": string, "itens": [ { "operacao": string, "ref": string, "para": string } ] } | null, "ir_para": string | null, "resposta": string.`;

/** Datas em São Paulo (o prazo "hoje" da equipe). */
function hojeEmSaoPaulo(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Se todos os providers/modelos falharem, devolve unknown sem quebrar a UI.
const PRIMARY_MODEL_CHAIN = ["gpt-4o-mini"];
const LOVABLE_COMPAT_MODEL_CHAIN = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
  "google/gemini-2.5-flash-lite",
];

interface RequestBody {
  text: string;
  attachment?: { fileName: string; text: string } | null;
  attachments?: { fileName: string; text: string }[];
  clientId?: string | null;
  clients?: { id: string; company_name?: string | null; full_name?: string | null; email?: string | null }[];
  // Quando true, NÃO chama LLM — só devolve `documents[]` carregados do sistema
  // pra UI mostrar e poder enviar de volta na próxima chamada.
  fetchOnly?: boolean;
  // Quando true, edge não tenta recarregar contratos do sistema (UI já passou).
  skipSystemContractAutoLoad?: boolean;
  // Pré-contexto escolhido no topo do agente (seletores Cliente e Serviço).
  servico?: string | null;
  tela?: string | null;
  // "conversa": responde uma pergunta (resumo, próximos passos) em texto,
  // sem intent e sem criar nada. Padrão: interpretar o comando.
  modo?: "interpretar" | "conversa";
  pergunta?: string | null;
  // Frente AG: pedido explícito da equipe (botão Analisar). Só com ele o
  // agente propõe e faz ações; a análise automática (silenciosa) nunca faz.
  agir?: boolean;
  // Contrato comum: confirmar, cancelar ou desfazer a proposta guardada.
  acao?: "executar_acao_agente" | "desfazer_acao_agente" | "esquecer_regra" | "guardar_regra";
  mensagem_id?: string;
  acao_id?: string;
  descartar?: boolean;
  /** Frente AG (27/09): encerra a sequência em passos no meio (o que foi feito fica, com o Desfazer). */
  parar?: boolean;
  /** Frente AG3 (29/09): as últimas trocas da conversa (texto), para referências vagas. */
  historico?: unknown;
  /** Frente AG3: "Esquecer" da linha "Aprendi". */
  regra_id?: string;
  /** Frente AG3: "Guardar como regra" do incerto. */
  regra?: { texto?: unknown; categoria?: unknown; escopo?: unknown };
}

// ─── Pré-contexto (cliente + serviço) ──────────────────────────────────
// Os serviços que o agente aceita no pré-contexto: os de services_config
// (SERVICE_LABELS em src/lib/cycleDefs.ts), mais "geral" e "contrato".
// Financeiro fica fora: é jurisdição proibida do agente.
const SERVICOS: Record<string, { rotulo: string; tipo?: string; areas: AreaDoCerebro[] }> = {
  geral: { rotulo: "Geral", areas: ["geral"] },
  social: { rotulo: "Social", tipo: "social_media", areas: ["calendario", "campanha", "copy", "arte"] },
  trafego: { rotulo: "Tráfego", tipo: "trafego", areas: ["ads", "conta", "campanha"] },
  design: { rotulo: "Design", areas: ["arte", "foto"] },
  copywriting: { rotulo: "Copy", areas: ["copy"] },
  edicao_video: { rotulo: "Edição de vídeo", tipo: "video", areas: ["arte", "campanha"] },
  videos_ia: { rotulo: "Vídeo com IA", tipo: "video_ai", areas: ["arte", "campanha"] },
  site: { rotulo: "Site", tipo: "site", areas: ["geral"] },
  seo: { rotulo: "SEO", areas: ["geral"] },
  automacao: { rotulo: "Automação", tipo: "automation", areas: ["geral"] },
  email_marketing: { rotulo: "E-mail", areas: ["copy"] },
  relatorios: { rotulo: "Relatórios", areas: ["ads", "conta"] },
  contrato: { rotulo: "Contrato", areas: ["geral"] },
};

export function servicoValido(chave: unknown): string {
  return typeof chave === "string" && Object.prototype.hasOwnProperty.call(SERVICOS, chave) ? chave : "geral";
}

type PreContexto = { texto: string; clienteNome: string | null; linhasLocais: string[] };

// Lê o que o painel já sabe do cliente, com teto: nome, serviços
// contratados, dossiê e memória (contextoParaAgente, a mesma leitura das
// mesas), projetos e tarefas abertos. Cada parte falha sozinha.
async function lerPreContexto(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string | null,
  servico: string,
  tela: string,
): Promise<PreContexto> {
  const s = SERVICOS[servico];
  const partes: string[] = [];
  const linhasLocais: string[] = [];
  let clienteNome: string | null = null;
  partes.push(`Serviço escolhido: ${s.rotulo}${s.tipo ? ` (tipo de projeto "${s.tipo}")` : ""}`);
  if (tela) partes.push(`Tela aberta: ${tela.slice(0, 120)}`);
  if (!clientId) {
    return { texto: `\n\n## PRÉ-CONTEXTO\n${partes.join("\n")}\nCliente: nenhum escolhido.`, clienteNome, linhasLocais };
  }
  const [perfil, contexto, projetos] = await Promise.all([
    Promise.resolve(
      supabase.from("profiles").select("company_name, full_name, services_config, client_type").eq("id", clientId).maybeSingle(),
    ).catch((e) => (registrarFalha("voice-assistant-agent: leitura do banco falhou", e), ({ data: null }))),
    // Frente SYNC: o contexto completo da marca (principal do cliente): negócio, estratégia aprovada, briefing, dossiê, decisões do conselho e cérebro.
    contextoCompletoParaPrompt(supabase as never, clientId, null, { area: areaDoBloco(s.areas), areasDoCerebro: s.areas, limiteCerebro: 1200, teto: 4000, partes: PARTES_COM_O_CONTEXTO, semTitulo: true })
      .then((c) => ({ texto: c.bloco }))
      .catch((e) => (registrarFalha("voice-assistant-agent: contexto completo falhou", e), ({ texto: "" }))),
    Promise.resolve(
      supabase.from("projects").select("id, name, status, progress, deadline, project_type")
        .eq("client_id", clientId).is("deleted_at", null).not("status", "in", "(done,completed,cancelled)")
        .order("created_at", { ascending: false }).limit(8),
    ).catch((e) => (registrarFalha("voice-assistant-agent: leitura do banco falhou", e), ({ data: [] }))),
  ]);
  const p = (perfil as { data: Record<string, unknown> | null }).data;
  if (p) {
    clienteNome = String(p.company_name || p.full_name || "") || null;
    const cfg = (p.services_config && typeof p.services_config === "object" ? p.services_config : {}) as Record<string, unknown>;
    const contratados = Object.keys(SERVICOS).filter((k) => cfg[k] === true).map((k) => SERVICOS[k].rotulo);
    partes.unshift(`Cliente: ${clienteNome || "sem nome"} (id ${clientId})${p.client_type ? ` · ${p.client_type}` : ""}`);
    partes.push(`Serviços contratados: ${contratados.length ? contratados.join(", ") : "nenhum marcado no cadastro"}`);
  } else {
    partes.unshift(`Cliente: id ${clientId}`);
  }
  const listaProjetos = ((projetos as { data: Record<string, unknown>[] | null }).data || []);
  if (listaProjetos.length) {
    const linhas = listaProjetos.map((x) => `- ${x.name} · ${x.status} · ${x.progress ?? 0}%${x.deadline ? ` · prazo ${x.deadline}` : ""}`);
    partes.push(`Projetos abertos:\n${linhas.join("\n")}`);
    linhasLocais.push(...listaProjetos.map((x) => `${x.name}: ${x.status}, ${x.progress ?? 0}%`));
    try {
      const { data: tarefas } = await supabase.from("tasks").select("title, status, due_date")
        .in("project_id", listaProjetos.map((x) => x.id as string)).neq("status", "done").is("deleted_at", null)
        .order("due_date", { ascending: true, nullsFirst: false }).limit(12);
      const t = (tarefas || []) as Record<string, unknown>[];
      if (t.length) {
        partes.push(`Tarefas abertas (as mais próximas):\n${t.map((x) => `- [${x.status}] ${x.title}${x.due_date ? ` · ${x.due_date}` : ""}`).join("\n")}`);
        linhasLocais.push(...t.slice(0, 6).map((x) => `Tarefa aberta: ${x.title}${x.due_date ? ` (${x.due_date})` : ""}`));
      }
    } catch { /* sem tarefas no pré-contexto */ }
  } else {
    partes.push("Projetos abertos: nenhum.");
  }
  const ctx = String((contexto as { texto?: string }).texto || "").trim();
  if (ctx) partes.push(ctx.slice(0, 4000));
  return { texto: `\n\n## PRÉ-CONTEXTO\n${partes.join("\n")}`.slice(0, 7000), clienteNome, linhasLocais };
}

const PERGUNTAS_PRONTAS: Record<string, string> = {
  resumo: "Faça um resumo do cliente para quem vai trabalhar nele hoje: quem é, o que contratou, em que pé está e o que está pendente. No máximo 6 frases.",
  proximos_passos: "Quais são os próximos passos concretos para este cliente neste serviço? Em ordem, com base nas tarefas abertas, nos projetos e no dossiê. No máximo 5 passos curtos.",
};

const PROMPT_DA_CONVERSA = `Você é o Aceleriq, agente de operações da agência Aceleriq, conversando com a equipe.
Responda à pergunta usando SÓ o PRÉ-CONTEXTO (cadastro, dossiê, memória do cliente, projetos e tarefas).
Regras:
- Português do Brasil, frases curtas e claras. Sem travessão. Sem markdown, sem asterisco.
- Não invente dado. Se faltar informação, diga o que falta e onde a equipe encontra.
- Seja específico: cite o nome da tarefa, do projeto e a data. Nada de conselho genérico que serviria para qualquer cliente.
- Use a CONVERSA ATÉ AQUI para entender "isso", "e a outra?" e a linha Hoje para datas.
- Financeiro, cobrança e cofre de senhas estão fora do seu alcance: se a pergunta for disso, diga que não acessa.
- Devolva JSON puro: { "resposta": string, "passos"?: string[] } (passos só quando pedirem passos, até 5).`;

// Extrai texto cru de PDF sem parser pesado: pega só strings ASCII dentro do
// stream — suficiente pra contratos digitais (texto, não scan). Limita 18k chars.
function quickPdfText(bytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);
  // junta runs de caracteres imprimíveis + acentos comuns
  const matches = raw.match(/[\x20-\x7E\u00C0-\u017F]{6,}/g) || [];
  return matches.join(" ").replace(/\s+/g, " ").slice(0, 18000);
}

type LoadedDoc = { fileName: string; text: string; source: string };

type DocumentSource = {
  fileUrl?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

function storageRefFromSource(
  source: DocumentSource,
): { bucket: string; path: string } | null {
  if (source.storageBucket && source.storagePath) {
    return { bucket: source.storageBucket, path: source.storagePath };
  }

  const value = source.fileUrl;
  if (!value) return null;
  const privatePrefixes = [
    ["files://", "files"],
    ["mcp-files://", "mcp-files"],
    ["workspace://", "workspace"],
  ] as const;
  for (const [prefix, bucket] of privatePrefixes) {
    if (value.startsWith(prefix)) {
      const path = value.slice(prefix.length);
      return path ? { bucket, path } : null;
    }
  }

  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const marker = "/storage/v1/object/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const parts = url.pathname
      .slice(markerIndex + marker.length)
      .split("/")
      .filter(Boolean);
    if (["public", "sign", "authenticated"].includes(parts[0])) parts.shift();
    const bucket = parts.shift();
    if (!bucket || parts.length === 0) return null;
    return {
      bucket: decodeURIComponent(bucket),
      path: decodeURIComponent(parts.join("/")),
    };
  } catch {
    return null;
  }
}

async function readableBodyAsText(
  body: Blob | Response,
  name: string,
  sourceHint = "",
): Promise<string> {
  const contentType = body instanceof Response
    ? body.headers.get("content-type") || ""
    : body.type || "";
  if (
    contentType.includes("pdf")
    || /\.pdf(\?|$)/i.test(sourceHint)
    || /\.pdf$/i.test(name)
  ) {
    const buf = new Uint8Array(await body.arrayBuffer());
    return quickPdfText(buf);
  }
  if (
    contentType.startsWith("text/")
    || contentType.includes("json")
    || /\.(txt|md|csv|tsv|json|yaml|yml|log|xml|html?)$/i.test(name)
  ) {
    const text = await body.text();
    return text.slice(0, 18000);
  }
  return "";
}

async function fetchOneAsText(
  // deno-lint-ignore no-explicit-any
  supabase: any, // tipagem do cliente muda entre versões do supabase-js; a função só lê
  source: DocumentSource,
  name: string,
): Promise<string> {
  try {
    const storageRef = storageRefFromSource(source);
    if (storageRef) {
      const { data, error } = await supabase.storage
        .from(storageRef.bucket)
        .download(storageRef.path);
      if (error || !data) return "";
      return await readableBodyAsText(data, name, storageRef.path);
    }
    // Never fetch arbitrary external URLs from a service-role function.
    // Contract/file documents must resolve to a known Supabase Storage object.
    return "";
  } catch { return ""; }
}

// Carrega TODOS os documentos relevantes de um cliente: contratos, briefings,
// e arquivos da pasta "contratos". A IA precisa ler tudo pra montar projeto
// completo, sem faltar uma vírgula.
async function loadAllClientDocs(
  // deno-lint-ignore no-explicit-any
  supabase: any, // tipagem do cliente muda entre versões do supabase-js; a função só lê
  clientId: string,
): Promise<LoadedDoc[]> {
  const docs: LoadedDoc[] = [];
  // Limite global pra não estourar prompt: ~6 documentos.
  const MAX_DOCS = 6;

  try {
    // 1) Contratos
    const { data: contracts } = await supabase
      .from("contracts")
      .select("original_file_url, original_file_name, description, title, updated_at")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(MAX_DOCS);
    for (const c of contracts || []) {
      if (docs.length >= MAX_DOCS) break;
      const name = (c.original_file_name || c.title || "contrato.pdf") as string;
      const inline = ((c.description || "") as string).slice(0, 18000);
      let text = inline;
      if ((!text || text.length < 200) && c.original_file_url) {
        const fetched = await fetchOneAsText(
          supabase,
          { fileUrl: c.original_file_url as string },
          name,
        );
        if (fetched) text = fetched;
      }
      if (text) docs.push({ fileName: name, text: text.slice(0, 18000), source: "contrato" });
    }
  } catch {}

  try {
    // 2) Arquivos da pasta "contratos" (uploads avulsos)
    const { data: files } = await supabase
      .from("files")
      .select("file_url, file_name, folder, file_type, storage_bucket, storage_path, created_at")
      .eq("client_id", clientId)
      .in("folder", ["contratos", "documentos", "operacionais"])
      .order("created_at", { ascending: false })
      .limit(MAX_DOCS);
    for (const f of files || []) {
      if (docs.length >= MAX_DOCS) break;
      // evita duplicar pelo nome
      if (docs.some((d) => d.fileName === f.file_name)) continue;
      if (!f.file_url && !(f.storage_bucket && f.storage_path)) continue;
      const text = await fetchOneAsText(
        supabase,
        {
          fileUrl: f.file_url as string | null,
          storageBucket: f.storage_bucket as string | null,
          storagePath: f.storage_path as string | null,
        },
        (f.file_name || "doc") as string,
      );
      if (text) docs.push({ fileName: (f.file_name || "doc") as string, text: text.slice(0, 18000), source: f.folder as string });
    }
  } catch {}

  try {
    // 3) Briefings (texto puro). Frente SYNC: as colunas são responses e submitted (answers e status não existem; a leitura falhava calada).
    const { data: brs } = await supabase
      .from("briefings")
      .select("responses, submitted, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(2);
    for (const b of brs || []) {
      if (docs.length >= MAX_DOCS) break;
      const text = typeof b.responses === "string" ? b.responses : JSON.stringify(b.responses || {}, null, 2);
      if (text && text.length > 50) {
        docs.push({ fileName: `briefing-${(b.created_at || "").slice(0, 10)}.json`, text: text.slice(0, 12000), source: "briefing" });
      }
    }
  } catch {}

  return docs;
}

// ─── Frente AG: ações do lançador, roteamento e conversa guardada ────────

const jsonResposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Projetos e tarefas abertos do cliente, com id (os apelidos saem daqui; o modelo nunca vê id). */
async function lerDadosDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string,
): Promise<DadosDoLancador> {
  const [perfil, projetos] = await Promise.all([
    Promise.resolve(supabase.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle()).catch((e) => (registrarFalha("voice-assistant-agent: leitura do banco falhou", e), ({ data: null }))),
    Promise.resolve(
      supabase.from("projects").select("id, name, status, deadline")
        .eq("client_id", clientId).is("deleted_at", null).not("status", "in", "(done,completed,cancelled)")
        .order("created_at", { ascending: false }).limit(12),
    ).catch((e) => (registrarFalha("voice-assistant-agent: leitura do banco falhou", e), ({ data: [] }))),
  ]);
  const p = (perfil as { data: Record<string, unknown> | null }).data;
  const lista = (((projetos as { data: unknown }).data || []) as Array<{ id: string; name: string; status: string | null; deadline: string | null }>);
  let tarefas: DadosDoLancador["tarefas"] = [];
  if (lista.length) {
    try {
      const { data } = await supabase.from("tasks").select("id, title, status, due_date, priority, project_id")
        .in("project_id", lista.map((x) => x.id)).neq("status", "done").is("deleted_at", null)
        .order("due_date", { ascending: true, nullsFirst: false }).limit(30);
      const nomeDoProjeto: Record<string, string> = {};
      for (const x of lista) nomeDoProjeto[x.id] = x.name;
      tarefas = ((data || []) as Array<{ id: string; title: string; status: string | null; due_date: string | null; priority: string | null; project_id: string }>)
        .map((t) => ({ ...t, projeto: nomeDoProjeto[t.project_id] || null }));
    } catch { /* sem tarefas: só projetos */ }
  }
  return {
    cliente: { id: clientId, nome: String((p && (p.company_name || p.full_name)) || "Cliente") },
    projetos: lista,
    tarefas,
  };
}

const AQUI_DO_LANCADOR = "o próprio Aceleriq faz: criar, concluir, mover de coluna, mudar prazo ou prioridade de tarefa, lembrete, nota sobre o cliente, projeto a partir do contrato, resumo e próximos passos do cliente";

/** Onde o pedido se resolve e se é ordem clara (Jev). Falha do Jev: null, e quem chama usa a reserva sem IA. */
async function rotearComJev(pedido: string, cliente: string | null, tela: string): Promise<Roteamento | null> {
  try {
    const r = await jevPerguntar(
      { state: { pedido: pedido.slice(0, 1500), agente: "Aceleriq, agente de operações do lançador", cliente: cliente || "nenhum escolhido", tela: tela || "/" }, questions: perguntasDoRoteador(AQUI_DO_LANCADOR) },
      { timeoutMs: 8_000 },
    );
    return lerRoteamento(r.answers);
  } catch (e) {
    console.warn(`[assistente] roteamento sem Jev: ${e instanceof Error ? e.message : "falha"}`);
    return null;
  }
}

/** Conversa do lançador com o cliente (uma por cliente, referência própria: não se mistura com as mesas). */
async function conversaDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase.from("agente_conversas").select("id")
    .eq("client_id", clientId).eq("agente", AGENTE_DA_CONVERSA_DO_LANCADOR).eq("referencia_tipo", REF_CONVERSA_DO_LANCADOR)
    // Histórico (09/10): "Nova conversa" arquiva a atual; a próxima mensagem abre outra.
    .is("arquivada_em", null)
    .order("criado_em", { ascending: false }).limit(1);
  const achada = ((data as { id: string }[] | null) ?? [])[0];
  if (achada) return achada.id;
  const { data: nova, error } = await supabase.from("agente_conversas")
    .insert({ client_id: clientId, agente: AGENTE_DA_CONVERSA_DO_LANCADOR, referencia_tipo: REF_CONVERSA_DO_LANCADOR, referencia_id: null, criado_por: userId })
    .select("id").single();
  if (error || !nova) return null;
  return (nova as { id: string }).id;
}

/** Núcleo comum: só com cliente escolhido (as leituras são do cliente). Nunca lança. */
function nucleoDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string | null | undefined,
  pedido: string,
  historico: { papel: string; texto: string }[],
): Promise<NucleoPreparado | null> {
  if (!clientId) return Promise.resolve(null);
  const ultima = [...historico].reverse().find((x) => x.papel === "aceleriq")?.texto || null;
  return prepararNucleo(supabase, { clientId, pedido, agente: "lancador", ultimaResposta: ultima, cobrar: cobrarDoLancador(clientId) })
    .catch((e) => (registrarFalha("voice-assistant-agent: núcleo não preparado (segue sem)", e), null));
}

/** Depois da IA: quadros conferidos e, quando a equipe pediu, o Hermes. Sem núcleo, o texto fica como veio. */
async function fecharNucleoDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  texto: string,
  nucleo: NucleoPreparado | null,
  o: { clientId: string | null | undefined; pedido: string; userId: string },
): Promise<string> {
  if (!nucleo || !o.clientId || !texto.trim()) return texto;
  try {
    const r = await fecharNucleo(supabase, texto, nucleo, { clientId: o.clientId, agente: "lancador", pedido: o.pedido, userId: o.userId, cobrar: cobrarDoLancador(o.clientId) });
    return r.texto.trim() ? r.texto : texto;
  } catch (e) {
    registrarFalha("voice-assistant-agent: conferência do núcleo falhou (segue o texto como veio)", e);
    return texto;
  }
}

/** Modo conversa (09/10): a troca também fica na conversa do lançador do cliente (histórico). Devolve o id da resposta. */
async function gravarTrocaDaConversa(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  o: { clientId: string; userId: string; pergunta: string; resposta: string },
): Promise<string | null> {
  try {
    const conversaId = await conversaDoLancador(supabase, o.clientId, o.userId);
    if (!conversaId) return null;
    const agora = Date.now();
    const { data, error } = await supabase.from("agente_mensagens").insert([
      { conversa_id: conversaId, client_id: o.clientId, papel: "usuario", conteudo: o.pergunta.slice(0, 4000) || "(pergunta)", criado_em: new Date(agora).toISOString(), anexos: [] },
      { conversa_id: conversaId, client_id: o.clientId, papel: "agente", conteudo: o.resposta.slice(0, 16000), anexos: [], criado_em: new Date(agora + 1).toISOString() },
    ]).select("id, papel");
    if (error) { console.error(`[assistente] conversa não gravada: ${error.message}`); return null; }
    return (((data as { id: string; papel: string }[] | null) ?? []).find((m) => m.papel === "agente") || { id: null }).id;
  } catch (e) {
    console.error(`[assistente] conversa não gravada: ${e instanceof Error ? e.message : "falha"}`);
    return null;
  }
}

/** Dependências do executor: a nota vai pelo cérebro do cliente (sem duplicar). */
function dependenciasDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clientId: string,
  userId: string,
) {
  return {
    userId,
    gravarNota: async (texto: string) => {
      const g = await gravarNoCerebro(supabase, { client_id: clientId, area: "geral", categoria: "aprendizado", texto, motivo: "anotado pelo Aceleriq do lançador", fonte: "lancador", criado_por: userId });
      return { id: g.id, situacao: g.situacao, reforcos: g.reforcos, substituidos: g.substituidos, erro: g.erro };
    },
  };
}

type ResultadoDasAcoes = {
  acao: AcaoDoAgente | null;
  mensagemId: string | null;
  destino: (DestinoNoPainel & { direto: boolean }) | null;
  direto: { direto: boolean; motivo: string } | null;
};

/**
 * Depois da resposta do modelo: lê as ações (apelidos), decide se vão direto
 * (regra 6 do contrato), acha o destino no mapa e guarda tudo na conversa do
 * cliente (a proposta mora na mensagem, como nas mesas).
 */
async function tratarAcoesDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  o: {
    parsed: Record<string, unknown>;
    texto: string;
    clientId: string | null;
    userId: string;
    alvos: AlvosDoLancador | null;
    rota: Roteamento | null;
  },
): Promise<ResultadoDasAcoes> {
  const hoje = hojeEmSaoPaulo();
  const { parsed, texto, clientId, userId, alvos, rota } = o;
  let acao = clientId && alvos ? normalizarAcoesDoLancador(parsed.acoes, alvos, { clientId, hoje }) : null;
  // Destino: o que o modelo pediu; senão, o Jev (área do mapa com certeza); sem Jev, as palavras do pedido.
  let destino: DestinoNoPainel | null = destinoDoPedido(parsed.ir_para, clientId);
  const kind = String((parsed.intent as { kind?: unknown } | undefined)?.kind || "unknown");
  const semOutraSaida = !acao && (kind === "unknown" || kind === "acao");
  if (!destino && semOutraSaida && rota && rota.area && rota.area !== OPCAO_AQUI && rota.area !== OPCAO_NENHUMA) destino = destinoDoPedido(rota.area, clientId);
  if (!destino && semOutraSaida && !rota) {
    const porPalavras = areaPorPalavras(texto);
    if (porPalavras && areaPorChave(porPalavras.area)) destino = destinoDoPedido(porPalavras.area, clientId);
  }
  const abrir = rota && rota.abrir !== null ? rota.abrir >= 0.7 : pedeParaAbrir(texto);
  const destinoFinal = destino ? { ...destino, direto: abrir && !acao } : null;

  if (!acao || !clientId) return { acao: null, mensagemId: null, destino: destinoFinal, direto: null };
  // Frente AG (27/09): o cartão leva o "Ir para" (a tarefa no Kanban, a nota no contexto);
  // "crie e me leva" abre sozinho ao terminar (o Jev já respondeu "abrir" nesta chamada).
  const levar = rota && rota.abrir !== null ? rota.abrir >= 0.7 : pedeParaLevar(texto);
  acao = comCaminho(acao, caminhoDoLancador(clientId, acao, { abrirSozinho: levar }));

  // "Ele já vai fazendo": ordem clara (Jev; sem Jev, verbo de ordem no começo), sem custo e com Desfazer.
  const pedidoClaro = rota && rota.ordem !== null ? rota.ordem >= 0.75 : pareceOrdem(texto);
  const direto = podeExecutarDireto(acao, regrasDoLancador(hoje), { pedidoClaro });
  if (direto.direto) {
    const deps = dependenciasDoLancador(supabase, clientId, userId);
    const inicio = Date.now();
    acao = await executarDireto(acao, (item, a) => executarItemDoLancador(supabase, clientId, item, a, deps), { userId });
    acao = comCaminho(acao, caminhoDoLancador(clientId, acao));
    const falhas = (acao.resultados || []).filter((r) => !r.ok).length;
    await auditLog({
      correlationId: crypto.randomUUID(), toolName: "aceleriq_acao_direta", origin: "painel:voice-assistant-agent",
      keyId: `painel:voice-assistant-agent:${userId}`, scopes: ["tasks:write"],
      input: { client_id: clientId, operacoes: acao.itens.map((i) => i.operacao) },
      success: falhas === 0, statusCode: 200, durationMs: Date.now() - inicio, resultRef: acao.id,
    });
  }
  // A proposta (ou a ação já feita) mora na conversa do cliente: o Desfazer e o Confirmar leem de lá.
  let mensagemId: string | null = null;
  try {
    const conversaId = await conversaDoLancador(supabase, clientId, userId);
    if (conversaId) {
      const agora = Date.now();
      // 16000: a resposta conferida pelo núcleo leva o quadro e a evidência das fontes (2000 cortava o bloco).
      const resposta = String(parsed.resposta || parsed.narrative || acao.resumo || "Pronto.").slice(0, 16000);
      const { data: gravadas, error: erroGravar } = await supabase.from("agente_mensagens").insert([
        { conversa_id: conversaId, client_id: clientId, papel: "usuario", conteudo: texto.slice(0, 4000) || "(pedido por voz)", criado_em: new Date(agora).toISOString(), anexos: [] },
        { conversa_id: conversaId, client_id: clientId, papel: "agente", conteudo: resposta, anexos: [acao], criado_em: new Date(agora + 1).toISOString() },
      ]).select("id, papel");
      // Frente AG3: o erro da gravação não some mais (foi assim que o anexos nulo escondeu a mensagem).
      if (erroGravar) console.error(`[assistente] conversa não gravada: ${erroGravar.message}`);
      mensagemId = (((gravadas as { id: string; papel: string }[] | null) ?? []).find((m) => m.papel === "agente") || { id: null }).id;
    } else {
      console.error("[assistente] conversa do lançador não abriu: a ação fica sem Confirmar/Desfazer");
    }
  } catch (e) {
    console.error(`[assistente] conversa não gravada: ${e instanceof Error ? e.message : "falha"}`);
  }
  if (!mensagemId && !acao.executada_em) acao = null; // sem onde guardar, nada para confirmar
  return { acao, mensagemId, destino: destinoFinal, direto };
}

/** executar_acao_agente / desfazer_acao_agente { mensagem_id, acao_id?, descartar? } */
async function acaoGuardadaDoLancador(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  caller: any,
  body: RequestBody,
  userId: string,
): Promise<Response> {
  const inicio = Date.now();
  try {
    const guardada = await acaoGuardadaNaMensagem(supabase, body.mensagem_id, async (clientId) => {
      const { data, error } = await caller.rpc("can_access_client", { _client_id: clientId });
      if (error || data !== true) throw new ErroDaAcao(403, "sem_acesso", "Você não tem acesso a este cliente.");
    }, { acaoId: body.acao_id, agente: AGENTE_DO_LANCADOR });
    const clientId = guardada.mensagem.client_id;
    if (body.acao === "desfazer_acao_agente") {
      const r = await desfazerAcaoGuardada(guardada, (x) => reverterItemDoLancador(supabase, clientId, x, {}), { userId });
      if (guardada.mensagem.conversa_id) {
        await Promise.resolve(supabase.from("agente_mensagens").insert({ conversa_id: guardada.mensagem.conversa_id, client_id: clientId, papel: "sistema", conteudo: `Aceleriq: desfeito (${r.voltaram} ${r.voltaram === 1 ? "item voltou" : "itens voltaram"}).` })).then(...registrarSeFalhar("voice-assistant-agent: mensagem de sistema nao gravada", { client_id: clientId }));
      }
      await auditLog({
        correlationId: crypto.randomUUID(), toolName: "aceleriq_desfazer_acao_do_agente", origin: "painel:voice-assistant-agent",
        keyId: `painel:voice-assistant-agent:${userId}`, scopes: ["tasks:write"],
        input: { client_id: clientId, mensagem_id: guardada.mensagem.id }, success: r.falharam.length === 0, statusCode: 200, durationMs: Date.now() - inicio, resultRef: guardada.mensagem.id,
      });
      return jsonResposta({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, custo_usd: 0 });
    }
    const deps = dependenciasDoLancador(supabase, clientId, userId);
    // Frente AG (27/09): em passos de 5 (andamento e Parar no cartão) e o "Ir para" com o que foi feito.
    const r = await confirmarAcaoGuardada(guardada, (item, acao) => executarItemDoLancador(supabase, clientId, item, acao, deps), {
      descartar: body.descartar === true, parar: body.parar === true, userId, lote: 1, porVez: 5, caminho: (feita) => caminhoDoLancador(clientId, feita),
    });
    if (body.descartar === true && !r.anexo.executada_em) return jsonResposta({ anexo: r.anexo, custo_usd: 0 });
    const feitos = r.resultados.filter((x) => x.ok).length;
    const falhas = r.resultados.length - feitos;
    if (r.terminou && r.anexo.executada_em && guardada.mensagem.conversa_id) {
      await Promise.resolve(supabase.from("agente_mensagens").insert({ conversa_id: guardada.mensagem.conversa_id, client_id: clientId, papel: "sistema", conteudo: `Aceleriq: ${textoDoResultado(r.anexo.resultados || [])}${r.anexo.parada_em ? " (parado no meio)" : ""}.` })).then(...registrarSeFalhar("voice-assistant-agent: mensagem de sistema nao gravada", { client_id: clientId }));
    }
    await auditLog({
      correlationId: crypto.randomUUID(), toolName: "aceleriq_executar_acao_do_agente", origin: "painel:voice-assistant-agent",
      keyId: `painel:voice-assistant-agent:${userId}`, scopes: ["tasks:write"],
      input: { client_id: clientId, mensagem_id: guardada.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) },
      success: falhas === 0, statusCode: 200, durationMs: Date.now() - inicio, resultRef: guardada.mensagem.id,
    });
    return jsonResposta({ anexo: r.anexo, feitos, falhas, custo_usd: 0 });
  } catch (e) {
    if (e instanceof ErroDaAcao) return jsonResposta({ error: e.codigo, mensagem: e.message }, e.status);
    return jsonResposta({ error: "acao_falhou", mensagem: e instanceof Error ? e.message : "Não foi possível." }, 500);
  }
}

async function callModel(
  provider: AiProvider,
  system: string,
  user: string,
): Promise<{ ok: true; content: string } | { ok: false; status: number; body: string }> {
  const resp = await fetchAiChatCompletion(provider, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      ...(/^gpt-5/i.test(provider.model) ? {} : { temperature: 0.2 }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, status: resp.status, body };
  }
  const data = await resp.json();
  return { ok: true, content: data?.choices?.[0]?.message?.content || "{}" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const providers = await resolverCadeiaDaIa({
      primaryModels: PRIMARY_MODEL_CHAIN,
      lovableModels: LOVABLE_COMPAT_MODEL_CHAIN,
      // Lote B (09/10): a conta direta do modelo dava 429 em toda chamada e o lançador caía no modo local.
      // O mesmo modelo pelo OpenRouter (chave do cofre) entra logo depois, como na Central.
      openRouterReserve: true,
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Require authenticated staff caller — this agent reads any client's
    // contracts/vault via service role, so IDOR by arbitrary clientId must be blocked.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userData.user.id });
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const caller = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });


    let body: RequestBody;
    try { body = (await req.json()) as RequestBody; }
    catch { body = { text: "" } as RequestBody; }
    if (typeof body?.text !== "string") body.text = "";
    if (body.clientId) {
      const { data: canAccess, error: accessError } = await caller.rpc(
        "can_access_client",
        { _client_id: body.clientId },
      );
      if (accessError || canAccess !== true) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Frente AG: Confirmar, Cancelar ou Desfazer do cartão (proposta guardada na conversa do cliente).
    if (body.acao === "executar_acao_agente" || body.acao === "desfazer_acao_agente") {
      return await acaoGuardadaDoLancador(supabase, caller, body, userData.user.id);
    }
    // Frente AG3: "Esquecer" da linha "Aprendi" (regra deste cliente, já com acesso conferido, ou do próprio dono).
    if (body.acao === "esquecer_regra") {
      const r = await esquecerRegra(supabase, { id: String(body.regra_id || ""), donosPermitidos: [userData.user.id, ...(body.clientId ? [body.clientId] : [])] });
      if (!r.ok) console.warn(`[assistente] esquecer regra recusado: ${r.motivo}`);
      return jsonResposta(r.ok ? { ok: true } : { error: "esquecer_falhou", mensagem: r.motivo }, r.ok ? 200 : 400);
    }
    if (body.acao === "guardar_regra") {
      try {
        const g = body.regra || {};
        const aprendido = await guardarNoServidor(supabase, {
          texto: String(g.texto || ""), categoria: g.categoria === "preferencia" ? "preferencia" : "evitar", escopo: g.escopo === "dono" ? "dono" : "cliente",
          agente: "geral", clientId: body.clientId || null, donoId: userData.user.id,
        });
        return jsonResposta({ aprendido });
      } catch (e) {
        console.warn(`[assistente] guardar regra falhou: ${e instanceof Error ? e.message : "falha"}`);
        return jsonResposta({ error: "guardar_falhou", mensagem: "Não foi possível guardar a regra agora." }, 400);
      }
    }
    const historico = historicoSeguro(body.historico);
    const hojeTexto = linhaDeHoje(hojeEmSaoPaulo());
    // Regras que o dono ensinou (do cliente e dele): leitura barata, sem IA, antes de qualquer modelo.
    const regrasLidas: Promise<RegraAtiva[]> = (body.fetchOnly || (!body.text?.trim() && body.modo !== "conversa"))
      ? Promise.resolve([])
      : regrasDoAgente(supabase, { agente: "geral", clientId: body.clientId || null, donoId: userData.user.id })
        .catch((e) => (registrarFalha("voice-assistant-agent: regras do dono não lidas", e), []));
    const incomingAttachments = [
      ...(body.attachment?.text ? [body.attachment] : []),
      ...((body.attachments || []).filter((a) => a?.text)),
    ];

    // Modo fetchOnly: UI quer só os documentos do cliente, sem rodar LLM.
    if (body.fetchOnly) {
      const documents = body.clientId ? await loadAllClientDocs(supabase, body.clientId) : [];
      return new Response(JSON.stringify({ documents }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const servico = servicoValido(body.servico);
    const tela = typeof body.tela === "string" ? body.tela.slice(0, 120) : "";

    // Modo conversa: responde em texto (resumo, próximos passos, pergunta
    // livre) com o pré-contexto. Não devolve intent nem cria nada.
    if (body.modo === "conversa") {
      const chave = typeof body.pergunta === "string" ? body.pergunta : "";
      const pergunta = (PERGUNTAS_PRONTAS[chave] || chave || body.text || "").slice(0, 1500).trim();
      if (!pergunta) {
        return new Response(JSON.stringify({ resposta: "Escreva a pergunta ou escolha um atalho.", passos: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // A pergunta livre também ensina ("nunca me mande resumo longo"); a pronta (atalho) não.
      const ehLivre = !PERGUNTAS_PRONTAS[chave];
      // Frente SPP: o Jev escolhe o método da casa em paralelo com o pré-contexto (nunca lança).
      const spP = superpoderesPara(supabase, { agente: "assistente.lancador", pedido: pergunta });
      // Núcleo comum: com cliente escolhido, o Jev escolhe as leituras do OS em paralelo com o pré-contexto.
      const nucleoP = nucleoDoLancador(supabase, body.clientId, pergunta, historico);
      const [pre, regras] = await Promise.all([lerPreContexto(supabase, body.clientId || null, servico, tela), regrasLidas]);
      const aprendizado = ehLivre
        ? aprenderNoServidor(supabase, { texto: pergunta, agente: "geral", clientId: body.clientId || null, donoId: userData.user.id, cliente: pre.clienteNome, contexto: historico.map((x) => x.texto).join(" | ") })
        : Promise.resolve(null);
      const local = {
        resposta: pre.linhasLocais.length
          ? `A IA não respondeu agora. O que o painel mostra${pre.clienteNome ? ` de ${pre.clienteNome}` : ""}:`
          : "A IA não respondeu agora e o painel não tem projetos abertos para este cliente.",
        passos: pre.linhasLocais.slice(0, 8),
        _degraded: true,
      };
      if (!providers.length) {
        return new Response(JSON.stringify({ ...local, aprendi: await aprendizado }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const pedidoDaConversa = `${hojeTexto}${blocoDoHistorico(historico)}\n\nPergunta da equipe:\n"""${pergunta}"""${pre.texto}\n\nRetorne APENAS o JSON.`;
      const erros: string[] = [];
      // O mapa do painel entra na conversa: "onde faço isso?" sai com a área certa e o link.
      const nucleo = await nucleoP;
      const sistemaDaConversa = `${PROMPT_DA_CONVERSA}\n\n${blocoDoMapaDoPainel(AGENTE_DO_LANCADOR)}${blocoDasRegras(regras)}${nucleo ? `\n\n${INSTRUCAO_DO_NUCLEO_DAS_MESAS}${nucleo.bloco ? `\n\n${nucleo.bloco}` : ""}` : ""}`;
      const sp = await spP;
      const sistemaComMetodo = juntarMetodoAoSistema(sistemaDaConversa, sp);
      for (const provider of providers) {
        const r = await callModel(provider, sistemaComMetodo, pedidoDaConversa);
        if (!r.ok) { erros.push(`${provider.label}: ${r.status}`); continue; }
        let j: any = null;
        try { j = JSON.parse(r.content); } catch {
          const m = r.content.match(/\{[\s\S]*\}/);
          try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
        }
        if (j && typeof j.resposta === "string" && j.resposta.trim()) {
          const passos = Array.isArray(j.passos) ? j.passos.map((p: unknown) => String(p)).filter(Boolean).slice(0, 5) : [];
          const irPara = destinoNaResposta(`${j.resposta} ${passos.join(" ")}`, body.clientId || null);
          // Núcleo comum: quadros conferidos contra as leituras e, quando a equipe pediu, o Hermes.
          const apresentada = await fecharNucleoDoLancador(supabase, j.resposta.trim(), nucleo, { clientId: body.clientId, pedido: pergunta, userId: userData.user.id });
          // Frente SPP: a conversa não executa nada; "pronto" ganha o aviso (sem refazer) e o método vira a linha "Método:".
          const fechado = await fecharComMetodo(supabase, { usoId: null, metodo: sp, resposta: apresentada, declarados: j.metodos_usados, acaoFeita: false, clientId: body.clientId || null });
          // A troca da conversa fica guardada na conversa do lançador do cliente (antes não gravava nada).
          const mensagemId = body.clientId
            ? await gravarTrocaDaConversa(supabase, {
              clientId: body.clientId, userId: userData.user.id,
              pergunta: (body.text || "").trim() || pergunta,
              resposta: `${fechado.resposta}${passos.length ? `\n\n${passos.map((p: string) => `- ${p}`).join("\n")}` : ""}`,
            })
            : null;
          return new Response(JSON.stringify({
            resposta: fechado.resposta, passos, ir_para: irPara ? { ...irPara, direto: false } : null, _model: provider.model,
            aprendi: await aprendizado, segui: regrasSeguidas(j.regras_seguidas, regras), metodo: fechado.anexo, mensagem_id: mensagemId,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        erros.push(`${provider.label}: parse_failed`);
      }
      console.warn(`[assistente] conversa sem resposta: ${erros.join(" | ")}`);
      return new Response(JSON.stringify({ ...local, _errors: erros, aprendi: await aprendizado }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!body.text && incomingAttachments.length === 0 && !body.clientId) {
      return new Response(JSON.stringify({
        intent: { kind: "unknown", raw: "" },
        suggestedClientIds: [], narrative: "Sem entrada — diga um comando ou anexe um documento.",
        confidence: 0, plan: null, _degraded: true, _reason: "empty_input",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const clientsCondensed = (body.clients || []).slice(0, 200).map((c) => ({
      id: c.id,
      name: c.company_name || c.full_name || c.email || "",
    }));

    // Auto-load documentos do sistema se nenhum attachment veio E não foi pedido pra pular.
    let systemLoaded: LoadedDoc[] = [];
    let contractAutoLoaded = false;
    if (incomingAttachments.length === 0 && body.clientId && !body.skipSystemContractAutoLoad) {
      systemLoaded = await loadAllClientDocs(supabase, body.clientId);
      contractAutoLoaded = systemLoaded.length > 0;
    }

    // Monta bloco com TODOS os documentos: anexos do usuário + carregados do sistema.
    const allDocs: { fileName: string; text: string; source?: string }[] = [
      ...incomingAttachments.map((a) => ({ fileName: a.fileName, text: a.text, source: "anexo" })),
      ...systemLoaded,
    ];
    // Cap total ~60k chars para não estourar o contexto do provider. O que
    // passa do teto fica de fora, e a contagem devolvida é só dos enviados.
    const documentosDoPedido = montarBlocosDeDocumentos(allDocs);
    const docBlocks = documentosDoPedido.blocos;
    const attachmentBlock = docBlocks.length
      ? `\n\n## ${docBlocks.length} DOCUMENTO(S) DO CLIENTE — leia INTEIRO, extraia números, prazos e formatos com precisão cirúrgica:${docBlocks.join("")}`
      : "";

    // Pré-contexto: cliente e serviço escolhidos no topo do agente, com o
    // dossiê e a memória resumidos (sem despejar tudo).
    // Frente AG: pedido explícito com texto (botão Analisar) liga as ações e o
    // caminho para as outras áreas. A análise automática (silenciosa) nunca faz nada.
    const agir = body.agir === true && body.text.trim().length > 0;
    // Frente SPP: o método da casa só no pedido explícito (agir); a análise automática e silenciosa fica sem.
    // Revisão 30/09: o Jev do método corre junto com o pré-contexto (antes esperava sozinho, até 3,5 s, depois dele).
    const spAgirP = agir ? superpoderesPara(supabase, { agente: "assistente.lancador", pedido: body.text }) : Promise.resolve(null);
    // Núcleo comum: só no pedido explícito com cliente (a análise automática e silenciosa não responde à equipe).
    const nucleoAgirP = agir ? nucleoDoLancador(supabase, body.clientId, body.text, historico) : Promise.resolve(null);
    const [preContexto, dadosDoLancador] = await Promise.all([
      body.clientId || body.servico || tela
        ? lerPreContexto(supabase, body.clientId || null, servico, tela).then((p) => p.texto)
        : Promise.resolve(""),
      agir && body.clientId ? lerDadosDoLancador(supabase, body.clientId).catch((e) => (registrarFalha("voice-assistant-agent: lerDadosDoLancador falhou", e), null)) : Promise.resolve(null),
    ]);
    const alvosDoPedido = dadosDoLancador ? alvosDoLancador(dadosDoLancador) : null;
    // Roteamento (Jev) corre junto do modelo: onde o pedido se resolve e se é ordem clara.
    const roteamento = agir ? rotearComJev(body.text, dadosDoLancador ? dadosDoLancador.cliente.nome : null, tela) : Promise.resolve(null);
    // Frente AG3: o pedido explícito também ensina (Jev decide se é regra), em paralelo ao modelo.
    const aprendizado = agir
      ? aprenderNoServidor(supabase, { texto: body.text, agente: "geral", clientId: body.clientId || null, donoId: userData.user.id, cliente: dadosDoLancador ? dadosDoLancador.cliente.nome : null, contexto: historico.map((x) => x.texto).join(" | ") })
      : Promise.resolve(null);
    const regras = await regrasLidas;
    const spAgir = await spAgirP;

    const userPrompt =
      `${hojeTexto}${agir ? blocoDoHistorico(historico) : ""}\n\n` +
      `Comando do administrador:\n"""${body.text.slice(0, 4000)}"""\n\n` +
      `Clientes disponíveis (JSON):\n${JSON.stringify(clientsCondensed)}\n` +
      preContexto +
      (agir ? `${alvosDoPedido ? blocoDasAcoesDoLancador(alvosDoPedido) : "\nSem cliente escolhido: acoes sempre null."}` : "") +
      attachmentBlock +
      `\n\nRetorne APENAS o JSON conforme schema, sem markdown.`;
    // O mapa do painel e a regra das ações só entram no pedido explícito (custo por mensagem).
    const nucleoAgir = await nucleoAgirP;
    const blocoDoNucleo = nucleoAgir ? `\n\n${INSTRUCAO_DO_NUCLEO_DAS_MESAS}${nucleoAgir.bloco ? `\n\n${nucleoAgir.bloco}` : ""}` : "";
    const sistema = juntarMetodoAoSistema((agir ? `${SYSTEM_PROMPT}\n\n${REGRA_DO_LANCADOR}\n\n${blocoDoMapaDoPainel(AGENTE_DO_LANCADOR)}` : SYSTEM_PROMPT) + blocoDasRegras(regras) + blocoDoNucleo, spAgir);

    // Fallback degradado se não há provider configurado.
    if (!providers.length) {
      return new Response(JSON.stringify({
        intent: { kind: "unknown", raw: body.text },
        suggestedClientIds: [], narrative: "IA indisponível (sem API key). Usando interpretação local.",
        confidence: 0, plan: null, _degraded: true, _reason: "no_api_key",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Tenta a cadeia portátil e depois a compatibilidade opcional.
    let parsed: any = null;
    let usedModel: string | null = null;
    const errors: string[] = [];
    for (const provider of providers) {
      const r = await callModel(provider, sistema, userPrompt);
      if (r.ok) {
        try { parsed = JSON.parse(r.content); }
        catch {
          const m = r.content.match(/\{[\s\S]*\}/);
          parsed = m ? JSON.parse(m[0]) : null;
        }
        if (parsed) { usedModel = provider.model; break; }
        errors.push(`${provider.label}: parse_failed`);
        continue;
      }
      errors.push(`${provider.label}: ${r.status}`);
      // Continua para o próximo modelo/provider, inclusive em falha de credencial
      // ou incompatibilidade de payload do provider anterior.
    }

    // Se TODOS falharem, degrada elegante — não trava o usuário — e deixa a
    // causa real registrada no log da função para diagnóstico.
    if (!parsed) {
      console.warn(`[assistente] todos os modelos falharam: ${errors.join(" | ")}`);
      // Sem modelo, o caminho no painel ainda sai (Jev ou palavras do pedido): "abre a Mesa Ads" funciona.
      const semModelo = agir
        ? await tratarAcoesDoLancador(supabase, { parsed: { intent: { kind: "unknown" } }, texto: body.text, clientId: body.clientId || null, userId: userData.user.id, alvos: null, rota: await roteamento })
        : null;
      return new Response(JSON.stringify({
        intent: { kind: semModelo && semModelo.destino ? "acao" : "unknown", raw: body.text },
        suggestedClientIds: [],
        narrative: "Modelos de IA temporariamente indisponíveis. Interpretação local ativa — você pode confirmar manualmente.",
        confidence: 0, plan: null,
        ir_para: semModelo ? semModelo.destino : null,
        aprendi: await aprendizado,
        _degraded: true, _reason: "all_models_failed", _errors: errors,
        _contractAutoLoaded: contractAutoLoaded,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Normalize
    if (!parsed.intent) parsed.intent = { kind: "unknown", raw: body.text };
    if (!Array.isArray(parsed.suggestedClientIds)) parsed.suggestedClientIds = [];
    if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
    if (typeof parsed.narrative !== "string") parsed.narrative = "";
    parsed._model = usedModel;
    parsed._contractAutoLoaded = contractAutoLoaded;
    parsed._contractName = allDocs[0]?.fileName || null;
    // Só os documentos que o modelo recebeu (antes contava também os que o teto cortou).
    parsed._documentsCount = documentosDoPedido.enviados;
    parsed._documentsLeftOut = documentosDoPedido.deFora;
    parsed._servico = servico;
    // Frente AG3: devolve o que aprendeu ("Aprendi: ... Esquecer") e as regras que pesaram ("Segui: ...").
    parsed.segui = regrasSeguidas(parsed.regras_seguidas, regras);
    delete parsed.regras_seguidas;
    parsed.aprendi = await aprendizado;

    // Frente AG: ações (direto quando pode), destino no mapa e a frase para a conversa.
    if (agir) {
      const rota = await roteamento;
      // Núcleo comum: a resposta é conferida ANTES de ir para a conversa do cliente (o que fica guardado é o conferido).
      if (nucleoAgir && typeof parsed.resposta === "string" && parsed.resposta.trim()) {
        parsed.resposta = await fecharNucleoDoLancador(supabase, parsed.resposta.trim(), nucleoAgir, { clientId: body.clientId, pedido: body.text, userId: userData.user.id });
      }
      const r = await tratarAcoesDoLancador(supabase, { parsed, texto: body.text, clientId: body.clientId || null, userId: userData.user.id, alvos: alvosDoPedido, rota });
      parsed.acao = r.acao;
      parsed.mensagem_id = r.mensagemId;
      parsed.ir_para = r.destino;
      parsed._direto = r.direto;
      // Feito direto, mas sem a mensagem guardada: a tela avisa (sem ela não há Desfazer pelo cartão).
      if (r.acao && r.acao.executada_em && !r.mensagemId) {
        parsed.aviso_da_acao = `Feito (${textoDoResultado(r.acao.resultados || [])}), mas a conversa não gravou: o Desfazer deste pedido não está disponível. Confira no Kanban.`;
      }
      parsed._roteamento = rota ? { area: rota.area, ordem: rota.ordem, abrir: rota.abrir } : null;
      if (typeof parsed.resposta !== "string" || !parsed.resposta.trim()) {
        parsed.resposta = r.acao
          ? r.acao.executada_em ? `Feito: ${r.acao.resumo}` : r.acao.resumo
          : r.destino ? `Isso é na ${r.destino.nome}. Abro para você?` : "";
      }
      // Frente SPP: "feito" só com a ação executada (só aviso, sem refazer); o método vira a linha "Método:".
      if (parsed.resposta) {
        const fechado = await fecharComMetodo(supabase, { usoId: null, metodo: spAgir, resposta: parsed.resposta, declarados: parsed.metodos_usados, acaoFeita: !!(r.acao && r.acao.executada_em), resultados: r.acao ? r.acao.resultados : null, clientId: body.clientId || null });
        // Lote B: feito na hora não aparece como "pronta para confirmar" (a fala foi escrita antes de executar).
        parsed.resposta = falaDoQueFoiFeito(fechado.resposta, !!(r.acao && r.acao.executada_em));
        parsed.metodo = fechado.anexo;
      }
      delete parsed.metodos_usados;
      // A ação do cartão substitui as intenções que a tela faria sozinha (nada roda duas vezes).
      const k = String(parsed.intent?.kind || "unknown");
      if ((r.acao && ["unknown", "acao", "create_task", "update_task_status"].indexOf(k) >= 0) || (!r.acao && r.destino && (k === "unknown" || k === "acao"))) {
        parsed.intent = { kind: "acao", raw: body.text };
      }
    } else {
      delete parsed.acoes;
      delete parsed.ir_para;
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Última linha de defesa: nunca quebra a UI. Frente AG3: o motivo vai para o log (antes sumia).
    console.error(`[assistente] erro interno: ${err instanceof Error ? err.message : String(err)}`);
    return new Response(JSON.stringify({
      intent: { kind: "unknown", raw: "" },
      suggestedClientIds: [], narrative: "Erro interno do agente. Interpretação local ativa.",
      confidence: 0, plan: null, _degraded: true, _reason: (err as Error).message,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
