/**
 * briefing-agente: o lado da equipe do briefing (frente BRF, 30/09/2026).
 * POST { acao, ... }, só equipe com acesso ao cliente (is_staff +
 * can_access_client). Erro sai como { error, mensagem }.
 *
 * Link:
 * - modelos {} -> { modelos: [{ slug, nome, titulo, versao, minutos }] } (os vigentes: banco ou fábrica)
 * - gerar_link { client_id, modelo, marca_id?, project_id?, validade_dias?, titulo? }
 *   -> { briefing: { id, token, expira_em, modelo }, caminho, cliente, telefone }
 *   (grava a cópia do modelo e o dado já sabido do cliente para confirmar)
 * - reabrir { briefing_id, dias? } -> { briefing } (o cliente volta a editar; a validade estica)
 * - validade { briefing_id, dias } -> { briefing }
 * - arquivar { briefing_id, arquivar } -> { briefing }
 * Agente de briefing (decupagem pelo Jev, sugestões com Confirmar e Desfazer):
 * - decupar { briefing_id, forcar? } -> { decupagem, motivo? }
 * - aplicar { decupagem_id, sugestoes: string[] } -> { aplicadas, destino }
 * - desfazer { decupagem_id } -> { voltaram, mantidos, destino }
 * Leitura:
 * - exportar_pdf { briefing_id } -> { file_id, ja_existia } (Arquivos > Documentos operacionais, só equipe)
 *
 * Toda ação que muda algo deixa um registro (mcp_audit_log) com o resumo e a
 * prova: é o gancho do "documento de entrega" (frente DOC). Nada vai para o
 * cliente daqui: o link é copiado e enviado pela equipe.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { auditLog } from "../_shared/mcp-audit.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { contasDaMarcaDoCliente, marcasDoCliente } from "../_shared/marca.ts";
import {
  camposDoModelo,
  campoVisivel,
  type DadosSabidos,
  ehSlugDeBriefing,
  estadoDoLink,
  type LinhaDeModelo,
  modeloDoLink,
  modeloVigente,
  prefillDoModelo,
  SLUGS_DE_BRIEFING,
  textoDaResposta,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
} from "../_shared/briefing-modelos.ts";
import { porCategoria, type ItemDecupado } from "../_shared/briefing-decupagem.ts";
import {
  anexosDoBriefing,
  aplicarDecupagem,
  CAMPOS_DA_DECUPAGEM,
  decuparBriefing,
  desfazerDecupagem,
  ErroDaDecupagem,
  type LinhaDaDecupagem,
} from "../_shared/briefing-decupar.ts";
import { gerarPdfDoBriefing, nomeDoArquivoDoBriefing } from "../_shared/pdf-briefing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_DO_BRIEFING =
  "id, token, client_id, project_id, marca_id, modelo, modelo_versao, modelo_conteudo, prefill, titulo, responses, submitted, expira_em, enviado_em, envios, reabertura_pedida_em, reabertura_motivo, reaberto_em, arquivado_em, arquivo_pdf_id, created_at";

class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

function respostaDeErro(err: unknown): Response {
  if (err instanceof ErroHttp) return json({ error: err.codigo, mensagem: err.message }, err.status);
  if (err instanceof ErroDaDecupagem) return json({ error: err.codigo, mensagem: err.message }, err.status);
  const motivo = registrarFalha("briefing-agente: erro inesperado", err);
  return json({ error: "erro_interno", mensagem: `Falha inesperada no briefing: ${motivo}` }, 500);
}

// ------------------------------------------------------------------ banco e acesso

type Chamador = { userId: string; doChamador: SupabaseClient };

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return servicoCache;
}

async function identificar(req: Request): Promise<Chamador> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) throw new ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo no painel.");
  const { data: staff, error } = await servico().rpc("is_staff", { _user_id: userId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
  if (staff !== true) throw new ErroHttp(403, "somente_equipe", "Somente a equipe gera e lê briefings.");
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: string | null) {
  if (!clientId || !UUID.test(clientId)) throw new ErroHttp(400, "client_id_invalido", "Escolha o cliente.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente agora.");
  if (data !== true) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroHttp(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const dias = (v: unknown, padrao: number) => Math.max(1, Math.min(VALIDADE_MAXIMA_DIAS, Math.floor(Number(v) || padrao)));

type LinhaDoBriefing = {
  id: string;
  token: string;
  client_id: string | null;
  project_id: string | null;
  marca_id: string | null;
  modelo: string | null;
  modelo_versao: number | null;
  modelo_conteudo: unknown;
  prefill: Record<string, unknown> | null;
  titulo: string | null;
  responses: Record<string, unknown> | null;
  submitted: boolean | null;
  expira_em: string | null;
  enviado_em: string | null;
  envios: number | null;
  reabertura_pedida_em: string | null;
  arquivado_em: string | null;
  arquivo_pdf_id: string | null;
  created_at: string;
};

async function lerBriefing(ch: Chamador, briefingId: unknown): Promise<LinhaDoBriefing> {
  const id = idDe(briefingId, "briefing_id");
  const { data, error } = await servico().from("briefings").select(CAMPOS_DO_BRIEFING).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "briefing_indisponivel", "Não foi possível ler o briefing.");
  if (!data) throw new ErroHttp(404, "briefing_inexistente", "Briefing não encontrado.");
  const b = data as LinhaDoBriefing;
  // Briefing antigo sem cliente: só admin mexe (is_staff já conferido; can_access_client pede cliente).
  if (b.client_id) await garantirAcesso(ch, b.client_id);
  else {
    const { data: admin } = await servico().rpc("has_role", { _user_id: ch.userId, _role: "admin" });
    if (admin !== true) throw new ErroHttp(403, "somente_admin", "Briefing sem cliente: só um admin mexe nele.");
  }
  return b;
}

async function nomeDoCliente(clientId: string | null): Promise<{ nome: string; telefone: string | null }> {
  if (!clientId) return { nome: "Cliente", telefone: null };
  const { data } = await servico().from("profiles").select("company_name, full_name, phone").eq("id", clientId).maybeSingle();
  const p = data as { company_name?: string | null; full_name?: string | null; phone?: string | null } | null;
  return { nome: (p && (p.company_name || p.full_name)) || "Cliente", telefone: p?.phone ?? null };
}

async function registrar(ch: Chamador, toolName: string, input: Record<string, unknown>, resultRef: string | null) {
  await auditLog({
    correlationId: crypto.randomUUID(),
    toolName,
    origin: "mesa:briefing-agente",
    keyId: `mesa:briefing-agente:${ch.userId}`,
    scopes: ["briefings:write"],
    input,
    success: true,
    statusCode: 200,
    durationMs: 0,
    resultRef: resultRef ?? undefined,
  });
}

// ------------------------------------------------------------------ modelos e link

async function linhasDeModelos(): Promise<LinhaDeModelo[]> {
  const { data, error } = await servico().from("briefing_modelos").select("slug, versao, conteudo, ativo").eq("ativo", true);
  if (error) {
    // Sem a tabela (migração pendente) ou fora do ar: valem os de fábrica, com o motivo no log.
    registrarFalha("briefing-agente: modelos do banco não lidos", error);
    return [];
  }
  return (data as LinhaDeModelo[] | null) ?? [];
}

async function modelos() {
  const linhas = await linhasDeModelos();
  return json({
    modelos: SLUGS_DE_BRIEFING.map((s) => {
      const m = modeloVigente(s, linhas);
      return { slug: m.slug, nome: m.nome, titulo: m.titulo, versao: m.versao, minutos: m.minutos };
    }),
  });
}

async function dadosSabidos(clientId: string, marcaId: string | null): Promise<DadosSabidos> {
  const dados: DadosSabidos = {};
  const [perfil, kit, marcas] = await Promise.all([
    servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(),
    servico().from("cliente_kit_marca").select("contexto").eq("client_id", clientId).maybeSingle(),
    marcasDoCliente(servico(), clientId).catch((e) => (registrarFalha("briefing-agente: marcas não lidas", e), [])),
  ]);
  const p = perfil.data as { company_name?: string | null; full_name?: string | null } | null;
  const marca = marcaId ? marcas.find((m) => m.id === marcaId) ?? null : null;
  const outraMarca = !!marca && !marca.principal;
  dados.empresa = (outraMarca ? marca!.nome : p?.company_name || p?.full_name) || undefined;

  // Contexto: a outra marca só com o dela (regra de herança); a principal e o cliente com o do kit.
  let contexto: Record<string, unknown> = {};
  if (outraMarca) {
    const { data } = await servico().from("cliente_marcas").select("contexto").eq("id", marca!.id).eq("client_id", clientId).maybeSingle();
    contexto = ((data as { contexto?: Record<string, unknown> } | null)?.contexto) || {};
  } else {
    contexto = ((kit.data as { contexto?: Record<string, unknown> } | null)?.contexto) || {};
  }
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  dados.negocio = texto(contexto.negocio) || undefined;
  dados.publico = texto(contexto.publico) || undefined;
  dados.oferta = texto(contexto.oferta) || undefined;
  if (Array.isArray(contexto.diferenciais)) dados.diferenciais = (contexto.diferenciais as unknown[]).map(String).join("; ") || undefined;
  dados.site = texto(contexto.site) || undefined;

  // Instagram: a conta da marca (ou do cliente, sem marca).
  const { data: contas } = await servico().from("external_accounts").select("id, platform, handle").eq("client_id", clientId).eq("platform", "instagram");
  let lista = ((contas as Array<{ id: string; handle: string | null }> | null) ?? []).filter((c) => c.handle);
  if (marca) {
    const ids = await contasDaMarcaDoCliente(servico(), clientId, marca);
    if (ids) lista = lista.filter((c) => ids.indexOf(c.id) >= 0);
  }
  if (lista[0]?.handle) dados.instagram = lista[0].handle.indexOf("@") === 0 ? lista[0].handle : `@${lista[0].handle}`;
  return dados;
}

async function gerarLink(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const slug = corpo.modelo;
  if (!ehSlugDeBriefing(slug)) throw new ErroHttp(400, "modelo_invalido", "Escolha o tipo de briefing.");
  const marcaPedida = corpo.marca_id ? idDe(corpo.marca_id, "marca_id") : null;
  const projetoPedido = corpo.project_id ? idDe(corpo.project_id, "project_id") : null;
  if (marcaPedida) {
    const marcas = await marcasDoCliente(servico(), clientId);
    if (!marcas.some((m) => m.id === marcaPedida)) throw new ErroHttp(400, "marca_de_outro_cliente", "Esta marca não é deste cliente.");
  }
  if (projetoPedido) {
    const { data } = await servico().from("projects").select("id").eq("id", projetoPedido).eq("client_id", clientId).maybeSingle();
    if (!data) throw new ErroHttp(400, "projeto_de_outro_cliente", "Este projeto não é deste cliente.");
  }
  const modelo = modeloVigente(slug, await linhasDeModelos());
  const prefill = prefillDoModelo(modelo, await dadosSabidos(clientId, marcaPedida).catch((e) => {
    registrarFalha("briefing-agente: dado já sabido não lido", e, { client_id: clientId });
    return {} as DadosSabidos;
  }));
  const expira = new Date(Date.now() + dias(corpo.validade_dias, VALIDADE_PADRAO_DIAS) * 86_400_000).toISOString();
  const { data, error } = await servico()
    .from("briefings")
    .insert({
      client_id: clientId,
      project_id: projetoPedido,
      marca_id: marcaPedida,
      modelo: modelo.slug,
      modelo_versao: modelo.versao,
      modelo_conteudo: modelo,
      prefill,
      titulo: limpo(corpo.titulo, 120) || null,
      expira_em: expira,
      criado_por: ch.userId,
    })
    .select("id, token, expira_em, modelo")
    .single();
  if (error || !data) {
    registrarFalha("briefing-agente: link não criado", error, { client_id: clientId });
    throw new ErroHttp(503, "link_nao_criado", "Não foi possível gerar o link agora. Tente de novo.");
  }
  const b = data as { id: string; token: string; expira_em: string; modelo: string };
  const cliente = await nomeDoCliente(clientId);
  await registrar(ch, "briefing_gerar_link", { client_id: clientId, modelo: b.modelo, marca_id: marcaPedida, expira_em: b.expira_em, confirmados: Object.keys(prefill) }, b.id);
  return json({ briefing: b, caminho: `/briefing/${b.token}`, cliente: cliente.nome, telefone: cliente.telefone, prefill_campos: Object.keys(prefill) });
}

async function reabrir(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  if (b.arquivado_em) throw new ErroHttp(409, "arquivado", "Este briefing está arquivado.");
  if (!b.submitted) throw new ErroHttp(409, "ja_aberto", "Este briefing ainda não foi enviado: o link já está aberto.");
  const minimo = Date.now() + dias(corpo.dias, 7) * 86_400_000;
  const atual = b.expira_em ? new Date(b.expira_em).getTime() : 0;
  const expira = new Date(Math.max(minimo, atual || 0)).toISOString();
  const { data, error } = await servico()
    .from("briefings")
    .update({ submitted: false, reaberto_em: new Date().toISOString(), reaberto_por: ch.userId, reabertura_pedida_em: null, reabertura_motivo: null, expira_em: expira })
    .eq("id", b.id)
    .eq("submitted", true)
    .select("id, submitted, expira_em, reaberto_em")
    .maybeSingle();
  if (error) throw new ErroHttp(503, "reabrir_falhou", "Não foi possível reabrir agora.");
  if (!data) throw new ErroHttp(409, "ja_aberto", "Outra pessoa reabriu este briefing agora.");
  await registrar(ch, "briefing_reabrir", { briefing_id: b.id, expira_em: expira }, b.id);
  return json({ briefing: data });
}

async function validade(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  if (b.submitted) throw new ErroHttp(409, "ja_enviado", "Briefing enviado não expira. Para editar de novo, use Reabrir.");
  const expira = new Date(Date.now() + dias(corpo.dias, VALIDADE_PADRAO_DIAS) * 86_400_000).toISOString();
  const { data, error } = await servico().from("briefings").update({ expira_em: expira }).eq("id", b.id).select("id, expira_em").maybeSingle();
  if (error || !data) throw new ErroHttp(503, "validade_falhou", "Não foi possível mudar a validade agora.");
  await registrar(ch, "briefing_validade", { briefing_id: b.id, expira_em: expira }, b.id);
  return json({ briefing: data });
}

async function arquivar(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  const querArquivar = corpo.arquivar !== false;
  const { data, error } = await servico().from("briefings").update({ arquivado_em: querArquivar ? new Date().toISOString() : null }).eq("id", b.id).select("id, arquivado_em").maybeSingle();
  if (error || !data) throw new ErroHttp(503, "arquivar_falhou", "Não foi possível arquivar agora.");
  await registrar(ch, querArquivar ? "briefing_arquivar" : "briefing_desarquivar", { briefing_id: b.id }, b.id);
  return json({ briefing: data });
}

// ------------------------------------------------------------------ agente de briefing

async function decupar(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  if (!b.submitted) throw new ErroHttp(409, "nao_enviado", "A decupagem começa depois que o briefing é enviado.");
  const r = await decuparBriefing(servico(), b.id, { criadoPor: ch.userId, forcar: corpo.forcar === true });
  if (r.motivo === "ja_aplicada") throw new ErroHttp(409, "ja_aplicada", "As sugestões desta decupagem já foram confirmadas. Desfaça antes de decupar de novo.");
  if (corpo.forcar === true && r.decupagem) await registrar(ch, "briefing_decupar", { briefing_id: b.id, status: r.decupagem.status, custo_usd: r.decupagem.custo_usd }, r.decupagem.id);
  return json({ decupagem: r.decupagem, motivo: r.motivo ?? null, custo_usd: r.decupagem?.custo_usd ?? 0 });
}

async function lerDecupagemComAcesso(ch: Chamador, decupagemId: unknown): Promise<LinhaDaDecupagem> {
  const id = idDe(decupagemId, "decupagem_id");
  const { data, error } = await servico().from("briefing_decupagens").select(CAMPOS_DA_DECUPAGEM).eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(503, "decupagem_indisponivel", "Não foi possível ler a decupagem.");
  if (!data) throw new ErroHttp(404, "decupagem_inexistente", "Decupagem não encontrada.");
  const linha = data as LinhaDaDecupagem;
  await garantirAcesso(ch, linha.client_id);
  return linha;
}

async function aplicar(ch: Chamador, corpo: Record<string, unknown>) {
  const linha = await lerDecupagemComAcesso(ch, corpo.decupagem_id);
  const escolhidas = (Array.isArray(corpo.sugestoes) ? corpo.sugestoes : []).map((x) => String(x).slice(0, 40)).slice(0, 20);
  const r = await aplicarDecupagem(servico(), linha.id, escolhidas, ch.userId);
  await registrar(ch, "briefing_aplicar_decupagem", { decupagem_id: linha.id, briefing_id: linha.briefing_id, campos: r.aplicadas.map((a) => a.campo), destino: r.destino }, linha.id);
  return json(r);
}

async function desfazer(ch: Chamador, corpo: Record<string, unknown>) {
  const linha = await lerDecupagemComAcesso(ch, corpo.decupagem_id);
  const r = await desfazerDecupagem(servico(), linha.id, ch.userId);
  await registrar(ch, "briefing_desfazer_decupagem", { decupagem_id: linha.id, voltaram: r.voltaram, mantidos: r.mantidos.map((m) => m.campo) }, linha.id);
  return json(r);
}

// ------------------------------------------------------------------ PDF para Arquivos

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function exportarPdf(ch: Chamador, corpo: Record<string, unknown>) {
  const b = await lerBriefing(ch, corpo.briefing_id);
  if (!b.client_id) throw new ErroHttp(409, "sem_cliente", "Briefing sem cliente não vai para Arquivos. Ligue um cliente antes.");
  const modelo = modeloDoLink(b.modelo, b.modelo_conteudo);
  const respostas = (b.responses || {}) as Record<string, unknown>;
  const anexos = await anexosDoBriefing(servico(), b.id);
  const { data: dec } = await servico().from("briefing_decupagens").select("itens, tom_de_voz, status").eq("briefing_id", b.id).order("envio", { ascending: false }).limit(1).maybeSingle();
  const decupagem = dec as { itens: ItemDecupado[]; tom_de_voz: string | null; status: string } | null;
  const pronta = decupagem && ["pronta", "aplicada", "desfeita"].indexOf(decupagem.status) >= 0;
  const cliente = await nomeDoCliente(b.client_id);
  const estado = estadoDoLink(b);
  const bytes = gerarPdfDoBriefing({
    cliente: cliente.nome,
    titulo: b.titulo || modelo.titulo,
    enviadoEm: b.enviado_em,
    estado: estado === "enviado" ? "enviado" : estado === "expirado" ? "rascunho (link expirado)" : "rascunho (ainda não enviado)",
    tom: pronta ? decupagem!.tom_de_voz : null,
    pontos: pronta ? porCategoria(decupagem!.itens || []).map((g) => ({ rotulo: g.rotulo, itens: g.itens.map((i) => i.texto) })) : [],
    blocos: modelo.blocos.map((bl) => ({
      titulo: bl.titulo,
      itens: bl.campos
        .filter((c) => campoVisivel(c, respostas))
        .map((c) => ({ pergunta: c.pergunta, resposta: textoDaResposta(c, respostas, anexos) }))
        .filter((i) => i.resposta),
    })),
  });
  const sha = await sha256Hex(bytes);
  const chave = `briefing-pdf:${b.id}:${sha.slice(0, 24)}`;
  const { data: existente } = await servico().from("files").select("id, client_id").eq("idempotency_key", chave).maybeSingle();
  const ja = existente as { id: string; client_id: string } | null;
  if (ja) {
    if (ja.client_id !== b.client_id) throw new ErroHttp(409, "chave_de_arquivo_em_uso", "O registro deste PDF pertence a outro cliente.");
    return json({ file_id: ja.id, ja_existia: true });
  }
  const fileId = crypto.randomUUID();
  const nome = nomeDoArquivoDoBriefing(modelo.nome, cliente.nome, b.enviado_em);
  const caminho = `${b.client_id}/${fileId}/v1/${nome}`;
  const { error: erroUpload } = await ch.doChamador.storage.from("files").upload(caminho, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if (erroUpload) throw new ErroHttp(503, "envio_de_arquivo_falhou", `Não foi possível enviar o PDF para Arquivos: ${erroUpload.message}`);
  const camposRespondidos = camposDoModelo(modelo).filter((c) => textoDaResposta(c, respostas, anexos)).length;
  const { data: registro, error: erroRegistro } = await ch.doChamador.rpc("create_file_record", {
    p_file: {
      id: fileId,
      client_id: b.client_id,
      project_id: b.project_id,
      file_name: nome,
      file_url: `files://${caminho}`,
      file_type: "briefing",
      mime_type: "application/pdf",
      extension: "pdf",
      storage_bucket: "files",
      storage_path: caminho,
      size_bytes: bytes.byteLength,
      sha256: sha,
      folder: "operacionais",
      tags: ["briefing", modelo.slug],
      status: "ready",
      version: 1,
      description: `${modelo.titulo} de ${cliente.nome}: ${camposRespondidos} respostas${b.enviado_em ? `, enviado em ${new Date(b.enviado_em).toLocaleDateString("pt-BR")}` : ""}.`.slice(0, 1000),
      idempotency_key: chave,
    },
  });
  if (erroRegistro || !registro) {
    const { error: e } = await ch.doChamador.storage.from("files").remove([caminho]);
    if (e) registrarFalha("briefing-agente: PDF órfão no Storage", e, { caminho });
    throw new ErroHttp(503, "registro_de_arquivo_falhou", `O PDF subiu, mas o registro em Arquivos falhou: ${erroRegistro?.message ?? "sem resposta"}`);
  }
  const id = (registro as { id: string }).id;
  const { error: erroLigacao } = await servico().from("briefings").update({ arquivo_pdf_id: id }).eq("id", b.id);
  if (erroLigacao) registrarFalha("briefing-agente: PDF não ligado ao briefing", erroLigacao, { file_id: id });
  await registrar(ch, "briefing_exportar_pdf", { briefing_id: b.id, file_id: id, sha256: sha }, id);
  return json({ file_id: id, ja_existia: false });
}

// ------------------------------------------------------------------ roteador

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  modelos: () => modelos(),
  gerar_link: gerarLink,
  reabrir,
  validade,
  arquivar,
  decupar,
  aplicar,
  desfazer,
  exportar_pdf: exportarPdf,
};

/** Ações que podem demorar (Jev, PDF): a resposta começa na hora. */
const ACOES_LONGAS = new Set(["decupar", "exportar_pdf"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
