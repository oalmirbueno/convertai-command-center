// Aceleriq OS — Agente da Central ("Atualizar todos")
//
// O dono: "quando eu gero, é atualizar o dossiê geral de todo mundo com tudo,
// com um botão. Ele atualiza o geral de forma organizada de cada um, me faz
// duas perguntas de cada um, eu respondo tudo ali, posso complementar com
// contexto; ele atualiza tudo, publica no portal, e eu copio".
//
// Limite das Edge Functions: nada de um request gigante com a carteira toda.
// O painel conduz a fila cliente a cliente (em lotes pequenos, com progresso
// na tela) e cada chamada aqui trata UM cliente:
//
//   { action: "clientes" }                       quem entra (régua do Ciclo)
//   { action: "preparar", client_id, ritual }    lê tudo, grava a Leitura da
//                                                semana no dossiê e devolve 2
//                                                perguntas
//   { action: "aplicar", client_id, ritual,      incorpora as respostas no
//     leitura, perguntas, respostas,             dossiê (seção Confirmado pelo
//     contexto_extra }                           dono), grava no diário e no
//                                                cérebro e escreve o ritual
//
// A publicação no portal é feita pelo painel, com o fluxo de sempre
// (rascunho conferido pela fonte e publicação por quem tem a carteira), para
// ficar no nome de quem respondeu: a resposta do dono no agente É a
// aprovação, e o registro diz quem aprovou.
//
// Tudo é lido e gravado com o JWT de quem pediu (RLS). Trabalho longo
// responde com fôlego (_shared/resposta-com-folego.ts) para não cair no 504.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "../_shared/ai-provider.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { AREAS_DO_CEREBRO, type AreaDoCerebro } from "../_shared/cerebro-do-cliente.ts";
import { METODO_ACELERA } from "../_shared/metodo-acelera.ts";
import { lerContextoDoRitual } from "../ritual-writer/contexto.ts";
import { conferirRepeticao, escreverRitual, extractJson, PRIMARY_MODEL_CHAIN, RITUAL_BRIEF } from "../ritual-writer/escritor.ts";
import { extrairMemoriaDoRitual } from "../ritual-writer/memoria.ts";
import {
  clienteEntraNoAgente,
  comporDossie,
  fatosDoAgente,
  linhasDeConfirmacao,
  normalizarLeitura,
  normalizarPerguntas,
  secaoDaLeitura,
  type LeituraDaSemana,
} from "./regras.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mesmos rótulos de SERVICE_LABELS (src/lib/cycleDefs.ts).
const SERVICOS: Record<string, string> = {
  social: "Social", trafego: "Tráfego", design: "Design", copywriting: "Copy", edicao_video: "Edição de vídeo",
  videos_ia: "Vídeo com IA", site: "Site", seo: "SEO", automacao: "Automação", email_marketing: "E-mail", relatorios: "Relatórios",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SISTEMA_PREPARAR = `Você é o agente da Central da Aceleriq, agência de growth marketing que conduz cada cliente pelo método ACELERA (Analisar, Clarear, Estruturar, Lançar, Executar, Revisar, Acelerar). Você lê o dossiê geral de UM cliente, a memória dos rituais enviados, o que mudou desde o último, as pendências, os números, o cérebro do cliente e a fase do método. Devolve a leitura organizada da semana (interna, para o dossiê) e DUAS perguntas para o dono da agência.

As duas perguntas são as que mais mudam a condução deste cliente nesta semana: o que o dossiê e o painel NÃO dizem e só o dono sabe (uma decisão em aberto, uma conversa com o cliente, verba, prioridade, resultado que aconteceu fora do painel, se um combinado do último ritual andou). Cada pergunta é curta, específica, com nome (campanha X, post Y, combinado Z), respondível em uma ou duas frases. Nunca pergunte o que já está no dossiê ou nos fatos. Nunca pergunte algo genérico ("como está o cliente?").

Regras: use só os fatos; nada inventado. Português do Brasil, sem travessão (use vírgula ou ponto). Conteúdo (Instagram, posts) e anúncios são frentes separadas. "o_que_andou" só com evidência. "proximos" nasce do dossiê ou de um fato, com QUAL peça, QUAL campanha, QUAL decisão. "lacunas" é o que falta no painel para conduzir com firmeza (até 4).

Responda SOMENTE JSON: {"leitura":{"onde_estamos":"2 a 3 frases","fase":{"nome":"nome da fase ACELERA","motivo":"por que","proximo_degrau":"o que falta para subir"},"o_que_andou":["..."],"pendencias":["..."],"proximos":[{"frente":"social|trafego|geral","passo":"..."}],"lacunas":["..."]},"perguntas":[{"pergunta":"...?","por_que":"o que a resposta muda"},{"pergunta":"...?","por_que":"..."}]}`;

const SISTEMA_APLICAR = `Você é o agente da Central da Aceleriq. Recebe a leitura da semana de UM cliente, as duas perguntas feitas ao dono da agência, as respostas dele e um contexto extra que ele pode ter colado. A resposta do dono vale sobre o que o painel sugeria.

Devolva:
- "leitura": a leitura da semana atualizada com as respostas (mesmo formato), sem perder o que continua certo.
- "confirmacoes": uma frase curta por resposta útil, em voz neutra, com o fato que o dono confirmou (ex.: "A campanha de primavera segue com R$ 30 por dia até 10/10."). Pergunta sem resposta não gera confirmação.
- "aprendizados": de 0 a 3 fatos DURÁVEIS ditos pelo dono que valem para as próximas semanas (preferência do cliente, o que evitar, o que funcionou). Cada um {"texto":"...","area":"geral|calendario|campanha|arte|foto|ads|copy|conta","categoria":"preferencia|evitar|aprendizado"}. Fato só desta semana não é aprendizado.

Português do Brasil, sem travessão. Só JSON: {"leitura":{...},"confirmacoes":["..."],"aprendizados":[{"texto":"...","area":"geral","categoria":"aprendizado"}]}`;

async function perguntarIA(sistema: string, usuario: string): Promise<{ dados: Record<string, unknown>; modelo: string } | null> {
  const providers = resolveAiProviderChain({ primaryModels: PRIMARY_MODEL_CHAIN, lovableModels: DEFAULT_LOVABLE_MODEL_CHAIN });
  const { response, provider } = await requestAiChatCompletion(providers, {
    messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
    temperature: 0.3,
  });
  if (!response.ok) {
    console.warn(`[agente-central] IA sem resposta: ${provider.label} HTTP ${response.status}`);
    return null;
  }
  const c = await response.json();
  try {
    return { dados: extractJson(c?.choices?.[0]?.message?.content || ""), modelo: provider.model };
  } catch {
    return null;
  }
}

type Dossie = { id: string; version: number; content: string; summary: string | null; metadata: Record<string, unknown> } | null;

async function lerDossie(db: SupabaseClient, clientId: string): Promise<Dossie> {
  const { data } = await db.from("client_dossiers").select("id, version, content, summary, metadata")
    .eq("client_id", clientId).eq("dossier_type", "contexto").is("project_id", null).eq("is_current", true).maybeSingle();
  return data ? { id: String(data.id), version: Number(data.version), content: String(data.content ?? ""), summary: data.summary ?? null, metadata: (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown> } : null;
}

/** Grava a versão nova pelo RPC de sempre, com a versão lida (sem regressão silenciosa). */
async function gravarDossie(db: SupabaseClient, clientId: string, atual: Dossie, conteudo: string, motivo: string, metadata: Record<string, unknown>) {
  if (atual && conteudo.trim() === atual.content.trim()) return { versao: atual.version, gravou: false };
  const { data, error } = await db.rpc("upsert_current_dossier", {
    _client_id: clientId,
    _content: conteudo,
    _dossier_type: "contexto",
    _project_id: null,
    _summary: atual?.summary ?? null,
    _change_reason: motivo,
    _source: "agente-central",
    _actor: null,
    _tags: ["agente-central"],
    // Mantém o que a versão anterior carregava (ex.: marca dos avanços automáticos).
    _metadata: { ...(atual?.metadata ?? {}), ...metadata },
    _expected_version: atual ? atual.version : 0,
  });
  if (error) throw new Error(/version_conflict/.test(error.message) ? "O dossiê mudou enquanto o agente lia. Tente de novo este cliente." : `dossiê: ${error.message}`);
  return { versao: Number((data as Record<string, unknown> | null)?.version ?? (atual?.version ?? 0) + 1), gravou: true };
}

async function perfilDe(db: SupabaseClient, clientId: string) {
  const { data } = await db.from("profiles").select("id, full_name, company_name, plan_name, plan_status, client_type, services_config, deleted_at")
    .eq("id", clientId).maybeSingle();
  return data as Record<string, unknown> | null;
}

function nomes(p: Record<string, unknown> | null) {
  const empresa = String(p?.company_name ?? "").trim();
  const pessoa = String(p?.full_name ?? "").trim();
  const contato = !pessoa || (empresa && pessoa.toLowerCase() === empresa.toLowerCase()) ? "" : pessoa.split(/\s+/)[0];
  const cfg = (p?.services_config ?? {}) as Record<string, unknown>;
  return {
    nome: empresa || pessoa || "Cliente",
    contato,
    servicos: Object.entries(SERVICOS).filter(([k]) => cfg[k] === true).map(([, v]) => v),
  };
}

async function acaoClientes(db: SupabaseClient) {
  const { data: papeis, error: e1 } = await db.from("user_roles").select("user_id").eq("role", "client");
  if (e1) return json({ error: "Não consegui ler a carteira." }, 500);
  const ids = (papeis ?? []).map((r: Record<string, unknown>) => String(r.user_id));
  if (!ids.length) return json({ clientes: [] });
  const [perfis, projetos, dossies] = await Promise.all([
    db.from("profiles").select("id, full_name, company_name, plan_status, client_type, services_config, deleted_at").in("id", ids).is("deleted_at", null),
    db.from("projects").select("id, client_id, status").in("client_id", ids).is("deleted_at", null),
    db.from("client_dossiers").select("client_id, version, updated_at").in("client_id", ids).eq("dossier_type", "contexto").is("project_id", null).eq("is_current", true),
  ]);
  const comProjeto = new Set((projetos.data ?? []).map((p: Record<string, unknown>) => String(p.client_id)));
  const dossiePor = new Map((dossies.data ?? []).map((d: Record<string, unknown>) => [String(d.client_id), d]));
  const clientes = (perfis.data ?? [])
    .filter((p: Record<string, unknown>) => clienteEntraNoAgente(p as never, comProjeto.has(String(p.id))))
    .map((p: Record<string, unknown>) => {
      const n = nomes(p);
      const d = dossiePor.get(String(p.id)) as Record<string, unknown> | undefined;
      return { id: String(p.id), nome: n.nome, contato: n.contato, dossie_versao: d ? Number(d.version) : null, dossie_em: d ? String(d.updated_at) : null };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return json({ clientes });
}

async function acaoPreparar(db: SupabaseClient, uid: string, clientId: string, ritual: string): Promise<Response> {
  const [perfil, dossie, contexto] = await Promise.all([
    perfilDe(db, clientId),
    lerDossie(db, clientId),
    lerContextoDoRitual(db, clientId, { ritual, limite: 8000 }),
  ]);
  const n = nomes(perfil);
  const fase = METODO_ACELERA[contexto.fase];
  const r = await perguntarIA(SISTEMA_PREPARAR, [
    `CLIENTE: ${n.nome}`,
    `SERVIÇOS CONTRATADOS: ${n.servicos.join(", ") || "não marcados no cadastro"}`,
    `FASE CALCULADA PELO PAINEL: ${fase.nome} (${contexto.motivoDaFase})`,
    `MEMÓRIA, MUDANÇAS, PENDÊNCIAS, NÚMEROS, CÉREBRO E MÉTODO:\n${contexto.texto}`,
    dossie ? `DOSSIÊ GERAL ATUAL v${dossie.version}:\n${dossie.content.slice(0, 9000)}` : "DOSSIÊ GERAL: não existe ainda.",
  ].join("\n\n"));
  if (!r) return json({ error: "A IA não respondeu agora. Tente este cliente de novo." }, 502);
  const leitura = normalizarLeitura(r.dados.leitura);
  if (!leitura.fase.nome) leitura.fase = { nome: fase.nome, motivo: contexto.motivoDaFase, proximo_degrau: fase.sinalDeAvanco };
  const perguntas = normalizarPerguntas(r.dados.perguntas);
  const agora = new Date();

  // O dossiê já sai atualizado com a leitura organizada (antes das respostas).
  let versao = dossie?.version ?? null;
  let dossieAviso: string | null = null;
  if (dossie) {
    try {
      const g = await gravarDossie(db, clientId, dossie, comporDossie(dossie.content, { leitura: secaoDaLeitura(leitura, agora) }),
        "Agente da Central: leitura organizada da semana", { agente_central: { etapa: "leitura", por: uid, em: agora.toISOString(), ritual } });
      versao = g.versao;
    } catch (e) {
      dossieAviso = e instanceof Error ? e.message : "Não foi possível gravar a leitura no dossiê.";
    }
  } else {
    dossieAviso = "Cliente sem dossiê geral: a leitura fica só aqui até a equipe criar o dossiê.";
  }

  return json({
    client_id: clientId, nome: n.nome, contato: n.contato,
    fase: contexto.fase, motivo_da_fase: contexto.motivoDaFase,
    leitura, perguntas, dossie_versao: versao, dossie_aviso: dossieAviso,
    contagem: contexto.contagem, modelo: r.modelo,
  });
}

async function acaoAplicar(db: SupabaseClient, uid: string, clientId: string, ritual: string, body: Record<string, unknown>): Promise<Response> {
  const leituraAntes = normalizarLeitura(body.leitura);
  const perguntas = normalizarPerguntas(body.perguntas);
  const respostasBrutas = Array.isArray(body.respostas) ? body.respostas : [];
  const respostas = perguntas.map((p, i) => ({ pergunta: p.pergunta, resposta: String(respostasBrutas[i] ?? "").trim().slice(0, 1500) }));
  const contextoExtra = String(body.contexto_extra ?? "").trim().slice(0, 3000);
  const agora = new Date();
  const temResposta = respostas.some((r) => r.resposta) || !!contextoExtra;

  let leitura: LeituraDaSemana = leituraAntes;
  let confirmacoes: string[] = [];
  let aprendizados: Array<{ texto: string; area: AreaDoCerebro; categoria: "preferencia" | "evitar" | "aprendizado" }> = [];
  if (temResposta) {
    const r = await perguntarIA(SISTEMA_APLICAR, [
      `LEITURA DA SEMANA:\n${JSON.stringify(leituraAntes)}`,
      `PERGUNTAS E RESPOSTAS DO DONO:\n${respostas.map((x) => `- ${x.pergunta}\n  Resposta: ${x.resposta || "(sem resposta)"}`).join("\n")}`,
      contextoExtra ? `CONTEXTO EXTRA DO DONO:\n${contextoExtra}` : "",
    ].filter(Boolean).join("\n\n"));
    if (r) {
      const nova = normalizarLeitura(r.dados.leitura);
      if (nova.onde_estamos) leitura = nova;
      confirmacoes = (Array.isArray(r.dados.confirmacoes) ? r.dados.confirmacoes : []).map((c) => String(c)).filter((c) => c.trim().length > 3).slice(0, 4);
      aprendizados = (Array.isArray(r.dados.aprendizados) ? r.dados.aprendizados : [])
        .map((a) => a && typeof a === "object" ? a as Record<string, unknown> : {})
        .map((a) => ({
          texto: String(a.texto ?? "").trim().slice(0, 500),
          area: ((AREAS_DO_CEREBRO as readonly string[]).includes(String(a.area)) ? a.area : "geral") as AreaDoCerebro,
          categoria: (a.categoria === "preferencia" || a.categoria === "evitar" ? a.categoria : "aprendizado") as "preferencia" | "evitar" | "aprendizado",
        }))
        .filter((a) => a.texto.length > 5)
        .slice(0, 3);
    }
    // Sem IA, a resposta do dono entra do jeito que ele escreveu.
    if (!confirmacoes.length) confirmacoes = respostas.filter((x) => x.resposta).map((x) => `${x.pergunta} ${x.resposta}`);
    if (!confirmacoes.length && contextoExtra) confirmacoes = [contextoExtra.slice(0, 380)];
  }

  // 1) Dossiê: leitura nova + o que o dono confirmou, pelo RPC de sempre.
  const dossie = await lerDossie(db, clientId);
  let versao = dossie?.version ?? null;
  let dossieAviso: string | null = null;
  const aprovacao = { por: uid, em: agora.toISOString(), via: "agente_central" };
  if (dossie) {
    try {
      const g = await gravarDossie(db, clientId, dossie,
        comporDossie(dossie.content, { leitura: secaoDaLeitura(leitura, agora), confirmacoes: linhasDeConfirmacao(agora, confirmacoes) }),
        temResposta ? "Agente da Central: respostas do dono incorporadas" : "Agente da Central: leitura da semana confirmada",
        { agente_central: { etapa: "respostas", ...aprovacao, perguntas: respostas.map((x) => x.pergunta), ritual } });
      versao = g.versao;
    } catch (e) {
      dossieAviso = e instanceof Error ? e.message : "Não foi possível gravar no dossiê.";
    }
  } else {
    dossieAviso = "Cliente sem dossiê geral: as respostas ficaram no diário.";
  }

  // 2) Diário: as respostas são decisão do dono, com quem aprovou.
  if (temResposta) {
    const { error } = await db.from("project_memory").insert({
      client_id: clientId,
      kind: "decisao",
      title: "Respostas ao agente da Central",
      content: [
        ...respostas.filter((x) => x.resposta).map((x) => `${x.pergunta}\n${x.resposta}`),
        contextoExtra ? `Contexto: ${contextoExtra}` : "",
      ].filter(Boolean).join("\n\n").slice(0, 8000),
      source: "agente-central",
      tags: ["agente-central", ritual],
      metadata: { client_visible: false, aprovado_por: uid, aprovado_em: aprovacao.em, aprovado_via: aprovacao.via, perguntas: respostas.map((x) => x.pergunta) },
      created_by: uid,
    });
    if (error) console.warn(`[agente-central] diário não gravado: ${error.message}`);
  }

  // 3) Cérebro: o que vale para as próximas semanas (sem duplicar; o Jev julga).
  const cerebro = [];
  for (const a of aprendizados) {
    const g = await gravarNoCerebro(db, {
      client_id: clientId, area: a.area, categoria: a.categoria, texto: a.texto,
      motivo: "Dito pelo dono ao agente da Central.", evidencia: "agente-central", fonte: "agente_central", criado_por: uid,
    });
    cerebro.push({ texto: a.texto, situacao: g.situacao, erro: g.erro });
  }

  // 4) Avanços automáticos do dossiê em dia (melhor esforço).
  await db.rpc("dossie_registrar_avancos", { _client_id: clientId }).then(() => null, () => null);

  // 5) O ritual, com a memória do servidor e o dossiê novo.
  const [perfil, dossieNovo, contexto] = await Promise.all([
    perfilDe(db, clientId),
    lerDossie(db, clientId),
    lerContextoDoRitual(db, clientId, { ritual }),
  ]);
  const n = nomes(perfil);
  const fatos = fatosDoAgente({
    nome: n.nome, planoNome: perfil?.plan_name ? String(perfil.plan_name) : null, servicos: n.servicos,
    dossie: (dossieNovo?.content ?? "").slice(0, 7000), versao: dossieNovo?.version ?? versao,
    leitura, respostas, contextoExtra,
  }).slice(0, 12000);
  const escrito = RITUAL_BRIEF[ritual]
    ? await escreverRitual({ ritual, clientName: n.nome, contactName: n.contato, facts: fatos, continuidade: contexto.texto }).catch(() => null)
    : null;
  const repeticao = escrito
    ? await conferirRepeticao(escrito.body, contexto.anteriores.map((a) => ({ quando: a.quando, titulo: a.titulo, texto: a.texto })))
    : null;

  return json({
    client_id: clientId, nome: n.nome, contato: n.contato,
    dossie_versao: dossieNovo?.version ?? versao, dossie_aviso: dossieAviso,
    leitura, confirmacoes, cerebro, aprovacao,
    ritual: escrito
      ? {
        tipo: ritual, title: escrito.title, body: escrito.body, next_steps: escrito.next_steps, alertas: escrito.alertas,
        tarefas_sugeridas: escrito.tarefas_sugeridas, model: escrito.model, repeticao, memoria: extrairMemoriaDoRitual(escrito.body, escrito.next_steps),
        fase: contexto.fase,
      }
      : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sessão expirada." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "Sessão expirada." }, 401);
    const { data: staff } = await admin.rpc("is_staff", { _user_id: u.user.id });
    if (!staff) return json({ error: "Somente equipe." }, 403);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const acao = String(body.action ?? "");
    if (acao === "clientes") return await acaoClientes(db);

    const clientId = String(body.client_id ?? "");
    if (!UUID.test(clientId)) return json({ error: "client_id inválido." }, 400);
    const ritual = RITUAL_BRIEF[String(body.ritual ?? "")] ? String(body.ritual) : "meio_semana";
    const { data: pode } = await db.rpc("can_access_client", { _client_id: clientId });
    if (pode !== true) return json({ error: "Sem acesso a este cliente." }, 403);

    if (acao === "preparar") return respostaComFolego(() => acaoPreparar(db, u.user.id, clientId, ritual), corsHeaders);
    if (acao === "aplicar") return respostaComFolego(() => acaoAplicar(db, u.user.id, clientId, ritual, body), corsHeaders);
    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    console.error(`[agente-central] falha: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "O agente falhou agora. Tente de novo." }, 500);
  }
});
