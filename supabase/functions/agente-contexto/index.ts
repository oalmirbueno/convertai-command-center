/**
 * Agente de contexto da Mesa do cliente.
 *
 * O dono não quer carregar de novo o que o cliente já entregou. Este agente
 * lê o que o painel já tem (documentos de marca, dossiê, artes aprovadas,
 * pastas de referência do workspace) e monta o contexto que o estrategista e
 * o diretor de arte usam.
 *
 * Ações (equipe com acesso ao cliente):
 * - ler { client_id }: sem IA. Sincroniza as referências (workspace e artes
 *   aprovadas), devolve o que foi encontrado, o kit atual, candidatos a logo e
 *   o que ainda falta.
 * - montar { client_id, forcar? }: com IA barata (modelo de leitura). Lê as
 *   referências ainda sem leitura em lote (visão) e os documentos, e escreve o
 *   contexto consolidado no kit. Campos que a equipe já preencheu não são
 *   sobrescritos: viram sugestão (a não ser com forcar).
 * - conversar { client_id, mensagem }: conversa com o agente sobre a marca;
 *   ele aplica as mudanças pedidas no kit e na memória dos agentes.
 * - fontes_da_biblioteca { client_id }: escolhe (Jev) um par de fontes da
 *   biblioteca global da agência quando o cliente ainda não tem fonte.
 * - acervo_sincronizar { client_id }: sem IA. Traz as imagens reais do cliente
 *   (todas as pastas do workspace e Arquivos, fora referências e materiais
 *   entregues) para o acervo, com a pasta e uma categoria provável.
 * - acervo_classificar { client_id, ids? }: centavos. Lê em lote (modelo de
 *   leitura, imagens reduzidas) e preenche descrição, categoria e tags.
 * - definir_logo { client_id, origem, id, alternativa? }: sem IA. Copia a
 *   imagem escolhida (Arquivos, workspace ou acervo) para mesa/<cliente>/marca
 *   e grava logo_path (ou logo_alt_path) no kit.
 *
 * Custos: toda IA passa pelo motor (carteira do cliente). O Jev é cobrado
 * pelo cobrarJev.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  chamarTexto,
  cobrarJev,
  IaMotorErro,
  modeloPadrao,
  type ImagemEntrada,
  type ModeloIa,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar } from "../_shared/jev.ts";
import { dimensoesDoCabecalho } from "../_shared/imagem-local.ts";
import {
  artesAprovadas,
  caminhoDoArquivo,
  candidatosALogo,
  lerContextoConsolidado,
  lerDocumentosDeMarca,
  lerDossie,
  sincronizarAcervo,
  sincronizarReferencias,
  type ContextoConsolidado,
} from "../_shared/contexto-cliente.ts";
import { conhecimentoContexto } from "../_shared/conhecimento-dos-agentes.ts";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import type { AreaDoCerebro, CategoriaDoCerebro } from "../_shared/cerebro-do-cliente.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import {
  type AcaoDoAgente,
  type AcaoGuardada,
  acaoGuardadaNaMensagem,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  type ItemDaAcaoDoAgente,
  type ResultadoDoItem,
  textoDoResultado,
} from "../_shared/acoes-do-agente.ts";
import { executarNoAcervo, type FotoDoAcervo, reverterNoAcervo } from "../_shared/acoes-do-acervo.ts";
import { executarNoWorkspace, type NoDoWorkspace, reverterNoWorkspace } from "../_shared/acoes-do-workspace.ts";
import {
  blocoDasAcoesDoContexto,
  type DadosDoContexto,
  ESQUEMA_DAS_ACOES_DO_CONTEXTO,
  normalizarAcoesDoContexto,
  pedeAcaoNoContexto,
  type ReferenciaDoCliente,
} from "./acoes-do-contexto.ts";

/**
 * Frente H (25/09): voz de marca, posicionamento, objeções e identidade
 * (conhecimento-marketing.ts, teto de 6.500). Quando faltar guia de voz,
 * posicionamento ou lista de objeções, o agente propõe um rascunho marcado
 * como proposta. Só montar e conversar recebem; leitura e acervo não.
 */
const CONHECIMENTO_DO_CONTEXTO = conhecimentoContexto().texto;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const erro = (status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) =>
  json({ error: codigo, mensagem, ...detalhes }, status);

class ErroContexto extends Error {
  status: number;
  codigo: string;
  detalhes: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

const STATUS_MOTOR: Record<string, number> = {
  saldo_insuficiente: 402,
  cota_da_chave_esgotada: 402,
  cliente_sem_chave: 403,
  provedor_sem_chave: 503,
};
const MENSAGEM_MOTOR: Record<string, string> = {
  saldo_insuficiente: "Saldo insuficiente na carteira de IA do cliente. Recarregue antes de continuar.",
  cota_da_chave_esgotada: "A cota do mês da chave de IA do cliente acabou.",
  cliente_sem_chave: "O cliente não tem chave de IA própria e não está autorizado a usar a da agência.",
  provedor_sem_chave: "O provedor de IA escolhido ainda não tem chave configurada.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_LEITURAS_POR_VEZ = 12;
const MAX_ARTES_NO_MONTAR = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const REF_TIPO = "cliente_contexto";

let servicoCache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!servicoCache) {
    servicoCache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return servicoCache;
}

type Chamador = { userId: string; doChamador: SupabaseClient };

async function identificar(req: Request): Promise<Chamador | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data: user } = await servico().auth.getUser(token);
  const userId = user?.user?.id;
  if (!userId) return null;
  const { data: staff } = await servico().rpc("is_staff", { _user_id: userId });
  if (staff !== true) return null;
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, doChamador };
}

async function garantirAcesso(ch: Chamador, clientId: string) {
  if (!UUID.test(clientId)) throw new ErroContexto(400, "cliente_invalido", "Cliente inválido.");
  const { data, error } = await ch.doChamador.rpc("can_access_client", { _client_id: clientId });
  if (error) throw new ErroContexto(503, "acesso_indisponivel", "Não foi possível conferir o acesso ao cliente.");
  if (data !== true) throw new ErroContexto(403, "sem_acesso_ao_cliente", "Você não tem acesso a este cliente.");
}

const texto = (v: unknown, max = 4000) => (v == null ? "" : String(v)).slice(0, max).trim();

function mimeDe(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

async function baixarImagem(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada | null> {
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;
    const mime = mimeDe(bytes);
    if (!mime) return null;
    return { bytes, mime, nome };
  } catch {
    return null;
  }
}

type Referencia = {
  id: string;
  origem: string;
  papel: string;
  workspace_node_id: string | null;
  file_id: string | null;
  storage_path: string | null;
  leitura: string | null;
};

/** Bytes de uma referência, venha ela do bucket mesa, do workspace ou de Arquivos. */
async function imagemDaReferencia(clientId: string, r: Referencia): Promise<ImagemEntrada | null> {
  if (r.storage_path) return await baixarImagem("mesa", r.storage_path, `ref-${r.id.slice(0, 8)}`);
  if (r.workspace_node_id) {
    const { data } = await servico().from("workspace_nodes").select("client_id, storage_path").eq("id", r.workspace_node_id).maybeSingle();
    const n = data as { client_id: string | null; storage_path: string | null } | null;
    if (!n || n.client_id !== clientId || !n.storage_path) return null;
    return await baixarImagem("workspace", n.storage_path, `ref-${r.id.slice(0, 8)}`);
  }
  if (r.file_id) {
    const { data } = await servico().from("files").select("client_id, storage_bucket, storage_path, file_url").eq("id", r.file_id).maybeSingle();
    const f = data as { client_id: string; storage_bucket: string | null; storage_path: string | null; file_url: string | null } | null;
    if (!f || f.client_id !== clientId) return null;
    const c = caminhoDoArquivo(f);
    return c ? await baixarImagem(c.bucket, c.caminho, `arte-${r.id.slice(0, 8)}`) : null;
  }
  return null;
}

async function modeloDoPapel(papel: string): Promise<ModeloIa> {
  const m = await modeloPadrao(papel);
  if (!m) throw new ErroContexto(503, "modelo_padrao_ausente", `O catálogo não tem modelo padrão ativo para ${papel}.`);
  return m;
}

/** Modelo do agente de contexto (papel próprio no catálogo); sem ele, o de leitura. */
async function modeloDoContexto(): Promise<ModeloIa> {
  return (await modeloPadrao("contexto")) ?? await modeloDoPapel("leitura");
}

function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

type Kit = {
  client_id: string;
  paleta: { nome?: string; hex?: string; papel?: string }[] | null;
  logo_file_id: string | null;
  logo_path?: string | null;
  logo_alt_path?: string | null;
  estilo: string | null;
  regras: string | null;
  contexto: ContextoConsolidado | null;
  contexto_atualizado_em: string | null;
} | null;

async function lerKit(clientId: string): Promise<Kit> {
  const { data } = await servico()
    .from("cliente_kit_marca")
    .select("client_id, paleta, logo_file_id, logo_path, logo_alt_path, estilo, regras, contexto, contexto_atualizado_em")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as Kit) ?? null;
}

async function nomeDoCliente(clientId: string): Promise<string> {
  const { data } = await servico().from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle();
  const p = data as { company_name: string | null; full_name: string | null } | null;
  return texto(p?.company_name || p?.full_name || "Cliente", 120);
}

// -------------------------------------------------------------------- ler

async function ler(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const db = servico();
  // Sincronizar (referências e acervo) não segura a tela: espera no máximo
  // 1,5 s e o resto termina em segundo plano; a próxima leitura já vem completa.
  const sincronizar = Promise.all([
    sincronizarReferencias(db, clientId),
    sincronizarAcervo(db, clientId).catch(() => null),
  ]);
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(sincronizar.catch(() => null));
  const sinc = await Promise.race([
    sincronizar.then(([r]) => r).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);
  const [kit, docs, dossie, artes, logos, refs, fontes] = await Promise.all([
    lerKit(clientId),
    lerDocumentosDeMarca(db, clientId, 60_000),
    lerDossie(db, clientId, 400),
    artesAprovadas(db, clientId, 12),
    candidatosALogo(db, clientId),
    db.from("cliente_referencias").select("id, origem, papel, leitura").eq("client_id", clientId).eq("ativa", true),
    db.from("cliente_fontes").select("id, nome, papel, origem").eq("client_id", clientId),
  ]);
  const listaRefs = (refs.data as { origem: string; papel: string; leitura: string | null }[] | null) ?? [];
  const listaFontes = (fontes.data as { nome: string; papel: string; origem: string }[] | null) ?? [];

  const lacunas: string[] = [];
  if (!kit?.logo_file_id && !kit?.logo_path) lacunas.push(logos.length ? "Escolha qual arquivo é a logo oficial." : "Envie a logo oficial em imagem (PNG com fundo transparente de preferência).");
  if (!Array.isArray(kit?.paleta) || !kit!.paleta!.length) lacunas.push("Paleta ainda não definida: o agente pode ler dos documentos e das artes.");
  if (!listaFontes.length) lacunas.push("Sem fonte definida: o agente escolhe um par da biblioteca da agência.");
  if (!kit?.contexto_atualizado_em) lacunas.push("Contexto ainda não montado pelo agente.");

  return json({
    kit,
    fontes: listaFontes,
    encontrado: {
      documentos: docs.map((d) => ({ file_id: d.file_id, nome: d.nome, prioridade: d.prioridade, caracteres: d.texto.length })),
      tem_dossie: !!dossie,
      artes_aprovadas: artes.length,
      referencias: {
        total: listaRefs.length,
        identidade: listaRefs.filter((r) => r.papel === "identidade").length,
        tecnica: listaRefs.filter((r) => r.papel !== "identidade").length,
        sem_leitura: listaRefs.filter((r) => !r.leitura).length,
      },
      sincronizadas_agora: sinc ? sinc.workspace_novas + sinc.arquivos_novas : 0,
    },
    candidatos_a_logo: logos,
    lacunas,
  });
}

// ----------------------------------------------------- leitura de referências

const ESQUEMA_LEITURAS = {
  nome: "leituras",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["leituras"],
    properties: {
      leituras: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "tecnica", "tags"],
          properties: {
            imagem: { type: "integer" },
            tecnica: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

const SISTEMA_LEITURA = `Você é o leitor de referências de um estúdio de direção de arte. Para cada imagem anexada, descreva a TÉCNICA, não o assunto, em 4 a 6 frases objetivas, para outro diretor reaproveitar sem copiar: grid e margens, posição e escala da headline, hierarquia (quantos níveis de texto), tipografia (classificação, peso, caixa, espacejamento), paleta com hex aproximados, relação entre foto e texto (recorte, sobreposição, área de respiro), profundidade e luz, e o que faz a peça funcionar. Tags curtas em minúsculas com hífen (ex.: tipografia-grande, foto-integrada, grid-assimetrico, recorte, numero-dominante, minimalista, colagem). Escreva sem travessão.`;

/** Lê em lote (uma chamada com várias imagens) as referências ainda sem leitura. */
async function lerReferenciasPendentes(ch: Chamador, clientId: string): Promise<{ lidas: number; custo: number }> {
  const { data } = await servico()
    .from("cliente_referencias")
    .select("id, origem, papel, workspace_node_id, file_id, storage_path, leitura")
    .eq("client_id", clientId)
    .eq("ativa", true)
    .is("leitura", null)
    .order("papel", { ascending: true })
    .limit(MAX_LEITURAS_POR_VEZ);
  const pendentes = (data as Referencia[] | null) ?? [];
  if (!pendentes.length) return { lidas: 0, custo: 0 };

  const comImagem: { ref: Referencia; imagem: ImagemEntrada }[] = [];
  const semArquivo: string[] = [];
  for (const r of pendentes) {
    const imagem = await imagemDaReferencia(clientId, r);
    if (imagem) comImagem.push({ ref: r, imagem });
    else semArquivo.push(r.id);
  }
  // Referência cujo arquivo não abre sai da fila (fica inativa e marcada), senão travava a leitura para sempre.
  if (semArquivo.length) {
    await servico().from("cliente_referencias").update({ ativa: false, tags: ["arquivo_indisponivel"] }).in("id", semArquivo).eq("client_id", clientId);
  }
  if (!comImagem.length) return { lidas: 0, custo: 0 };

  const leitor = await modeloDoPapel("leitura");
  const r = await chamarTexto({
    clientId,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["low", "minimal"]),
    sistema: SISTEMA_LEITURA,
    mensagens: [{
      papel: "usuario",
      conteudo: `Leia as ${comImagem.length} imagens anexadas, na ordem (imagem 1, 2, 3...). ` +
        comImagem.map((c, i) => `Imagem ${i + 1}: ${c.ref.papel === "identidade" ? "arte já publicada pela própria marca" : "referência de técnica"}.`).join(" "),
      imagens: comImagem.map((c) => c.imagem),
    }],
    esquemaJson: ESQUEMA_LEITURAS,
    maxTokensSaida: 4000,
    referencia: { tipo: REF_TIPO, id: clientId },
    criadoPor: ch.userId,
  });
  const leituras = ((r.json as { leituras?: { imagem: number; tecnica: string; tags: string[] }[] } | undefined)?.leituras) ?? [];
  let lidas = 0;
  for (const l of leituras) {
    const alvo = comImagem[Math.round(l.imagem) - 1];
    if (!alvo || !texto(l.tecnica)) continue;
    const tags = Array.from(new Set([...(Array.isArray(l.tags) ? l.tags : []).map((t) => texto(t, 40).toLowerCase()).filter(Boolean)])).slice(0, 12);
    await servico().from("cliente_referencias").update({ leitura: texto(l.tecnica, 1500), tags }).eq("id", alvo.ref.id);
    lidas++;
  }
  return { lidas, custo: r.custoUsd };
}

// ------------------------------------------------------------------ montar

const ESQUEMA_CONTEXTO = {
  nome: "contexto_da_marca",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["negocio", "publico", "oferta", "tom_de_voz", "diferenciais", "paleta", "estilo", "regras", "tipografia", "logo", "lacunas"],
    properties: {
      negocio: { type: "string" },
      publico: { type: "string" },
      oferta: { type: "string" },
      tom_de_voz: { type: "string" },
      diferenciais: { type: "array", items: { type: "string" } },
      paleta: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "hex", "papel"],
          properties: { nome: { type: "string" }, hex: { type: "string" }, papel: { type: "string" } },
        },
      },
      estilo: { type: "string" },
      regras: { type: "string" },
      tipografia: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "texto", "observacao"],
        properties: { titulo: { type: "string" }, texto: { type: "string" }, observacao: { type: "string" } },
      },
      logo: {
        type: "object",
        additionalProperties: false,
        required: ["descricao"],
        properties: { descricao: { type: "string" } },
      },
      lacunas: { type: "array", items: { type: "string" } },
    },
  },
};

const SISTEMA_CONTEXTO = `Você é o agente de contexto de uma agência de marketing. Sua função é consolidar a identidade e o negócio de um cliente a partir do que a agência JÁ TEM: documentos de marca e estratégia, dossiê e artes já publicadas (anexadas como imagens). Nada de inventar: o que não estiver nas fontes vira lacuna.

Devolva:
- negocio: o que a empresa faz, onde e para quem, em até 4 frases.
- publico: públicos prioritários e o que eles buscam.
- oferta: oferta e serviços principais.
- tom_de_voz: como a marca fala (3 a 5 traços, com exemplo curto).
- diferenciais: até 6, só os comprovados nas fontes.
- paleta: as cores oficiais com hex exato quando os documentos trazem; se não trazem, os hex aproximados observados nas artes publicadas (papel: primaria, secundaria, destaque, fundo, texto). Nome de cada cor. De 3 a 7 cores.
- estilo: a linguagem visual da marca em 6 a 10 frases que um diretor de arte usa para criar peças novas no mesmo sistema: fotografia (tipo, luz, enquadramento), tipografia (classificação, peso, caixa), composição recorrente, grafismos, texturas, clima, o que diferencia a marca. Baseie nas artes publicadas e nos documentos.
- regras: faça e não faça da marca, em tópicos curtos (uso da logo, cores proibidas, tom, o que nunca mostrar).
- tipografia: fontes citadas nos documentos para título e texto (nome exato) ou descrição do estilo observado nas artes; observacao com pesos e uso.
- logo: descrição da logo (forma, cores, versões) como aparece nas fontes.
- lacunas: o que falta para a identidade ficar completa (ex.: "logo em PNG", "manual de marca").

Português do Brasil, sem travessão.`;

async function montar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const forcar = corpo.forcar === true;
  const db = servico();

  await Promise.all([sincronizarReferencias(db, clientId), sincronizarAcervo(db, clientId).catch(() => null)]);
  const [kit, docs, dossie, artes, nome] = await Promise.all([
    lerKit(clientId),
    lerDocumentosDeMarca(db, clientId, 20_000),
    lerDossie(db, clientId, 5000),
    artesAprovadas(db, clientId, MAX_ARTES_NO_MONTAR),
    nomeDoCliente(clientId),
  ]);

  // Roda uma vez: sem fonte nova desde a última montagem, devolve o que já tem, sem gastar.
  const fontesAgora = [
    ...docs.map((d) => d.nome),
    ...(dossie ? ["Dossiê atual"] : []),
    ...(artes.length ? [`${Math.min(artes.length, MAX_ARTES_NO_MONTAR)} artes publicadas`] : []),
  ];
  const fontesAntes = kit?.contexto?.fontes_lidas ?? [];
  const semNovidade = !!kit?.contexto_atualizado_em && fontesAgora.length === fontesAntes.length &&
    fontesAgora.every((f) => fontesAntes.includes(f));
  if (!forcar && corpo.atualizar !== true && semNovidade) {
    // Contexto já montado: só completa o que falta (referências sem leitura e
    // fonte, se o cliente ainda não tem), sem refazer a montagem.
    const [leitura, qtdFontes] = await Promise.all([
      lerReferenciasPendentes(ch, clientId).catch((e) => {
        if (e instanceof IaMotorErro && STATUS_MOTOR[e.codigo]) throw e;
        return { lidas: 0, custo: 0 };
      }),
      db.from("cliente_fontes").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    ]);
    const fontesEscolhidas = qtdFontes.count ? null : await escolherFontesDaBiblioteca(ch, clientId).catch(() => null);
    return json({
      kit: await lerKit(clientId),
      sugestoes: {},
      fontes_escolhidas: fontesEscolhidas,
      referencias_lidas: leitura.lidas,
      custo_usd: leitura.custo,
      saldo_usd: null,
      ja_atualizado: true,
    });
  }

  // Leitura das referências pendentes corre junto com a montagem, não antes.
  const leituraEmCurso = lerReferenciasPendentes(ch, clientId).catch((e) => {
    if (e instanceof IaMotorErro && STATUS_MOTOR[e.codigo]) throw e;
    return { lidas: 0, custo: 0 };
  });
  const baixadas = await Promise.all(artes.map((a, i) => {
    const c = caminhoDoArquivo(a);
    return c ? baixarImagem(c.bucket, c.caminho, `arte-publicada-${i + 1}`) : Promise.resolve(null);
  }));
  const imagens = baixadas.filter(Boolean) as ImagemEntrada[];
  if (!docs.length && !dossie && !imagens.length) {
    await leituraEmCurso;
    throw new ErroContexto(409, "sem_fontes", "Ainda não há documentos, dossiê nem artes deste cliente no painel para ler.");
  }

  const leitor = await modeloDoContexto();
  const r = await chamarTexto({
    clientId,
    tarefa: "contexto",
    agente: "contexto",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["medium", "low"]),
    sistema: `${SISTEMA_CONTEXTO}\n\n${CONHECIMENTO_DO_CONTEXTO}`,
    mensagens: [{
      papel: "usuario",
      conteudo: [
        `Cliente: ${nome}.`,
        imagens.length ? `Anexei ${imagens.length} artes já publicadas pela marca.` : "Nenhuma arte publicada anexada.",
        dossie ? `DOSSIÊ ATUAL:\n${dossie}` : "",
        ...docs.map((d) => `DOCUMENTO "${d.nome}"${d.prioridade ? " (identidade/estratégia)" : ""}:\n${d.texto}`),
      ].filter(Boolean).join("\n\n"),
      imagens,
    }],
    esquemaJson: ESQUEMA_CONTEXTO,
    maxTokensSaida: 6000,
    referencia: { tipo: REF_TIPO, id: clientId },
    criadoPor: ch.userId,
  });
  const leitura = await leituraEmCurso;

  const c = (r.json ?? {}) as Record<string, any>;
  const paleta = (Array.isArray(c.paleta) ? c.paleta : [])
    .map((p: any) => ({ nome: texto(p?.nome, 40), hex: texto(p?.hex, 7).toUpperCase(), papel: texto(p?.papel, 20) }))
    .filter((p: any) => HEX.test(p.hex))
    .slice(0, 8);
  const contexto: ContextoConsolidado = {
    negocio: texto(c.negocio, 1200),
    publico: texto(c.publico, 1200),
    oferta: texto(c.oferta, 1000),
    tom_de_voz: texto(c.tom_de_voz, 1000),
    diferenciais: (Array.isArray(c.diferenciais) ? c.diferenciais : []).map((d: unknown) => texto(d, 200)).filter(Boolean).slice(0, 6),
    tipografia: {
      titulo: texto(c.tipografia?.titulo, 120) || null,
      texto: texto(c.tipografia?.texto, 120) || null,
      observacao: texto(c.tipografia?.observacao, 500) || null,
    },
    logo: { descricao: texto(c.logo?.descricao, 600) || null },
    lacunas: (Array.isArray(c.lacunas) ? c.lacunas : []).map((d: unknown) => texto(d, 200)).filter(Boolean).slice(0, 8),
    fontes_lidas: [
      ...docs.map((d) => d.nome),
      ...(dossie ? ["Dossiê atual"] : []),
      ...(artes.length ? [`${Math.min(artes.length, MAX_ARTES_NO_MONTAR)} artes publicadas`] : []),
    ],
  };

  const estilo = texto(c.estilo, 3000);
  const regras = texto(c.regras, 3000);
  const vazio = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
  const sugestoes: Record<string, unknown> = {};
  // O que a equipe ensinou pela conversa (campo preenchido) fica, a menos que venha forcar.
  const antigo = ((kit as { contexto?: ContextoConsolidado | null } | null)?.contexto ?? null) as ContextoConsolidado | null;
  const cheio = (v: unknown) => (typeof v === "string" ? !!v.trim() : Array.isArray(v) ? v.length > 0 : v != null);
  const mesclado: ContextoConsolidado = forcar || !antigo ? contexto : {
    ...contexto,
    negocio: cheio(antigo.negocio) ? antigo.negocio : contexto.negocio,
    publico: cheio(antigo.publico) ? antigo.publico : contexto.publico,
    oferta: cheio(antigo.oferta) ? antigo.oferta : contexto.oferta,
    tom_de_voz: cheio(antigo.tom_de_voz) ? antigo.tom_de_voz : contexto.tom_de_voz,
    diferenciais: cheio(antigo.diferenciais) ? antigo.diferenciais : contexto.diferenciais,
    tipografia: {
      titulo: antigo.tipografia?.titulo || contexto.tipografia?.titulo || null,
      texto: antigo.tipografia?.texto || contexto.tipografia?.texto || null,
      observacao: antigo.tipografia?.observacao || contexto.tipografia?.observacao || null,
    },
  };
  const patch: Record<string, unknown> = {
    client_id: clientId,
    contexto: mesclado,
    contexto_atualizado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    atualizado_por: ch.userId,
  };
  if (paleta.length) {
    if (forcar || vazio(kit?.paleta)) patch.paleta = paleta;
    else sugestoes.paleta = paleta;
  }
  if (estilo) {
    if (forcar || vazio(kit?.estilo)) patch.estilo = estilo;
    else sugestoes.estilo = estilo;
  }
  if (regras) {
    if (forcar || vazio(kit?.regras)) patch.regras = regras;
    else sugestoes.regras = regras;
  }
  const { error } = await db.from("cliente_kit_marca").upsert(patch, { onConflict: "client_id" });
  if (error) throw new ErroContexto(503, "kit_nao_gravado", "O contexto foi montado, mas não foi gravado. Tente de novo.", { uso_id: r.usoId });

  // Fonte: sem nenhuma, escolhe um par da biblioteca da agência.
  let fontesEscolhidas: unknown = null;
  const { count } = await db.from("cliente_fontes").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (!count) fontesEscolhidas = await escolherFontesDaBiblioteca(ch, clientId).catch(() => null);

  return json({
    kit: await lerKit(clientId),
    sugestoes,
    fontes_escolhidas: fontesEscolhidas,
    referencias_lidas: leitura.lidas,
    custo_usd: r.custoUsd + leitura.custo,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

// ------------------------------------------------------ fontes da biblioteca

type FonteBiblioteca = {
  id: string;
  familia: string;
  categoria: string | null;
  personalidade: string[];
  usos: string[];
  nichos: string[];
  pareamentos: { com?: string; papel_desta?: string; papel_da_outra?: string; porque?: string }[];
  amostra_path: string | null;
  suporta_portugues: boolean;
  arquivos?: { peso: number; estilo?: string; arquivo: string; italico?: boolean }[] | null;
};

/**
 * Par título + texto escolhido pelo Jev entre os pareamentos da biblioteca,
 * pelo contexto da marca. Grava em cliente_fontes com origem biblioteca.
 */
/** Arquivo da família para o papel: título pega o peso mais forte até 800, texto o regular; nunca itálico. */
function arquivoDaFamilia(f: FonteBiblioteca, papel: "titulo" | "texto"): string {
  const retos = (f.arquivos ?? []).filter((a) => a && a.arquivo && !a.italico);
  const lista = retos.length ? retos : (f.arquivos ?? []).filter((a) => a && a.arquivo);
  if (!lista.length) return f.amostra_path || `biblioteca/fontes/${f.familia}`;
  const alvo = papel === "titulo" ? 800 : 400;
  const melhor = lista.reduce((a, b) => {
    const da = papel === "titulo" && a.peso > alvo ? 1000 : Math.abs(a.peso - alvo);
    const db = papel === "titulo" && b.peso > alvo ? 1000 : Math.abs(b.peso - alvo);
    return db < da ? b : a;
  });
  return melhor.arquivo;
}

async function escolherFontesDaBiblioteca(ch: Chamador, clientId: string) {
  const db = servico();
  const { data } = await db
    .from("fontes_biblioteca")
    .select("id, familia, categoria, personalidade, usos, nichos, pareamentos, amostra_path, suporta_portugues, arquivos")
    .eq("ativa", true)
    .eq("suporta_portugues", true)
    .limit(200);
  const biblioteca = (data as FonteBiblioteca[] | null) ?? [];
  if (!biblioteca.length) return null;
  const porNome = new Map(biblioteca.map((f) => [f.familia.toLowerCase(), f]));

  // Opções: cada pareamento vira "Título X + Texto Y".
  const opcoes = new Map<string, { titulo: FonteBiblioteca; texto: FonteBiblioteca; porque: string }>();
  for (const f of biblioteca) {
    for (const p of f.pareamentos ?? []) {
      const outra = porNome.get(texto(p.com, 80).toLowerCase());
      if (!outra) continue;
      // papel_desta diz se esta família entra como título ou como texto.
      const desta = texto(p.papel_desta, 30).toLowerCase();
      const titulo = desta.indexOf("texto") >= 0 ? outra : f;
      const corpoFonte = titulo === f ? outra : f;
      if (titulo.id === corpoFonte.id) continue;
      const chave = `${titulo.familia} + ${corpoFonte.familia}`;
      if (!opcoes.has(chave)) opcoes.set(chave, { titulo, texto: corpoFonte, porque: texto(p.porque, 200) });
    }
  }
  if (opcoes.size < 2) return null;
  const lista = Array.from(opcoes.entries()).slice(0, 40);

  const [kit, nome] = await Promise.all([lerKit(clientId), nomeDoCliente(clientId)]);
  const criterios: Record<string, unknown> = {};
  lista.forEach(([chave, o], i) => {
    criterios[`par_${i}`] = {
      titulo: `${o.titulo.familia} (${o.titulo.categoria ?? ""}; ${o.titulo.personalidade.join(", ")})`,
      texto: `${o.texto.familia} (${o.texto.categoria ?? ""}; ${o.texto.personalidade.join(", ")})`,
      combina_com: Array.from(new Set([...o.titulo.nichos, ...o.texto.nichos])).slice(0, 8),
      porque: o.porque,
      rotulo: chave,
    };
  });
  const res = await jevPerguntar({
    state: {
      cliente: nome,
      negocio: kit?.contexto?.negocio ?? null,
      publico: kit?.contexto?.publico ?? null,
      tom_de_voz: kit?.contexto?.tom_de_voz ?? null,
      estilo_visual: kit?.estilo ?? null,
      tipografia_citada: kit?.contexto?.tipografia ?? null,
    },
    questions: {
      par: {
        type: "choice",
        instructions: "Qual par de fontes (título e texto) combina melhor com a personalidade, o público e o estilo visual desta marca, para carrosséis de Instagram lidos no celular? Se a tipografia citada pela marca for parecida com uma das opções, prefira a mais próxima.",
        criteria: criterios,
      },
    },
  });
  await cobrarJev(res, { clientId, tarefa: "contexto", referencia: { tipo: REF_TIPO, id: clientId }, criadoPor: ch.userId });
  const escolha = res.answers.par?.choice ?? "";
  const indice = Number(escolha.replace("par_", ""));
  const par = lista[Number.isFinite(indice) ? indice : -1]?.[1];
  if (!par) return null;

  // storage_path é obrigatório em cliente_fontes: o arquivo da própria biblioteca
  // (peso forte para título, regular para texto). Sem ele o insert falhava calado.
  const linhas = [
    { client_id: clientId, nome: par.titulo.familia, papel: "titulo", storage_path: arquivoDaFamilia(par.titulo, "titulo"), amostra_path: par.titulo.amostra_path, biblioteca_id: par.titulo.id, origem: "biblioteca" },
    { client_id: clientId, nome: par.texto.familia, papel: "texto", storage_path: arquivoDaFamilia(par.texto, "texto"), amostra_path: par.texto.amostra_path, biblioteca_id: par.texto.id, origem: "biblioteca" },
  ];
  const { error } = await db.from("cliente_fontes").insert(linhas);
  if (error) {
    console.error("agente-contexto: fontes da biblioteca nao gravadas", { client_id: clientId, erro: error.message });
    return null;
  }
  return { titulo: par.titulo.familia, texto: par.texto.familia, porque: par.porque, confianca: res.answers.par?.confidence ?? null };
}

async function fontesDaBiblioteca(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const { count } = await servico().from("cliente_fontes").select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (count) throw new ErroContexto(409, "cliente_ja_tem_fonte", "Este cliente já tem fonte definida. Remova as atuais para trocar pela biblioteca.");
  const escolha = await escolherFontesDaBiblioteca(ch, clientId);
  if (!escolha) throw new ErroContexto(409, "biblioteca_vazia", "A biblioteca de fontes da agência ainda não tem pares suficientes.");
  return json({ fontes_escolhidas: escolha });
}

// --------------------------------------------------------------- conversar

const ESQUEMA_CONVERSA = {
  nome: "conversa_de_contexto",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "estilo", "regras", "paleta", "contexto", "memoria", "acoes"],
    properties: {
      resposta: { type: "string" },
      // Logos, referências, acervo e workspace: só a lista; a equipe confirma (acoes-do-contexto.ts).
      acoes: ESQUEMA_DAS_ACOES_DO_CONTEXTO,
      estilo: { type: ["string", "null"] },
      regras: { type: ["string", "null"] },
      paleta: {
        type: ["array", "null"],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "hex", "papel"],
          properties: { nome: { type: "string" }, hex: { type: "string" }, papel: { type: "string" } },
        },
      },
      contexto: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["negocio", "publico", "oferta", "tom_de_voz"],
        properties: {
          negocio: { type: ["string", "null"] },
          publico: { type: ["string", "null"] },
          oferta: { type: ["string", "null"] },
          tom_de_voz: { type: ["string", "null"] },
        },
      },
      memoria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["agente", "tipo", "texto"],
          properties: {
            agente: { type: "string", enum: ["estrategista", "diretor_arte"] },
            tipo: { type: "string", enum: ["aprendizado", "preferencia", "evitar"] },
            texto: { type: "string" },
          },
        },
      },
    },
  },
};

const SISTEMA_CONVERSA = `Você é o agente de contexto da Mesa do cliente, numa agência de marketing. Você conhece a marca pelo contexto em JSON que recebe (kit, contexto consolidado, fontes, referências e memória dos agentes) e conversa com a equipe para deixar esse contexto completo e correto.

Quando pedirem uma mudança, aplique: devolva o campo novo completo (estilo, regras, paleta ou contexto); campos que não mudam vão como null. Quando a equipe ensinar algo que o estrategista ou o diretor de arte deve lembrar sempre, registre em memoria (agente, tipo e texto curto). Nunca invente dado do cliente: se faltar informação, pergunte. Responda curto e direto, em português do Brasil, sem travessão.`;

async function garantirConversa(clientId: string, userId: string): Promise<string> {
  const db = servico();
  const { data } = await db
    .from("agente_conversas")
    .select("id")
    .eq("client_id", clientId)
    .eq("agente", "contexto")
    .order("criado_em", { ascending: false })
    .limit(1);
  const existente = ((data as { id: string }[] | null) ?? [])[0];
  if (existente) return existente.id;
  const { data: nova, error } = await db
    .from("agente_conversas")
    .insert({ client_id: clientId, agente: "contexto", referencia_tipo: REF_TIPO, referencia_id: clientId, criado_por: userId })
    .select("id")
    .single();
  if (error || !nova) throw new ErroContexto(503, "conversa_nao_criada", "Não foi possível abrir a conversa com o agente de contexto.");
  return (nova as { id: string }).id;
}

async function conversar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const mensagem = texto(corpo.mensagem, 4000);
  if (!mensagem) throw new ErroContexto(400, "mensagem_vazia", "Escreva o que você quer ajustar no contexto.");
  const db = servico();
  const conversaId = await garantirConversa(clientId, ch.userId);

  const [kit, nome, historico, fontes, memoria, refs] = await Promise.all([
    lerKit(clientId),
    nomeDoCliente(clientId),
    db.from("agente_mensagens").select("papel, conteudo").eq("conversa_id", conversaId).order("criado_em", { ascending: false }).limit(12),
    db.from("cliente_fontes").select("nome, papel, origem").eq("client_id", clientId),
    db.from("agente_memoria").select("agente, tipo, texto").eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(30),
    db.from("cliente_referencias").select("papel, leitura, tags").eq("client_id", clientId).eq("ativa", true).not("leitura", "is", null).limit(12),
  ]);
  const anteriores = ((historico.data as { papel: string; conteudo: string }[] | null) ?? []).reverse();

  // Pedido de mexer em logo, referência, foto ou arquivo: as listas entram no prompt (com apelidos, nunca id).
  const dadosDasAcoes = pedeAcaoNoContexto(mensagem) ? await dadosParaAcoes(clientId).catch(() => null) : null;
  // Papel próprio do agente de contexto no catálogo (padrão barato); sem ele, o de leitura.
  const estrategista = await modeloDoContexto();
  const estado = {
    cliente: nome,
    kit: { paleta: kit?.paleta ?? [], estilo: kit?.estilo ?? null, regras: kit?.regras ?? null, tem_logo: !!(kit?.logo_file_id || kit?.logo_path) },
    contexto: kit?.contexto ?? {},
    fontes: fontes.data ?? [],
    memoria_dos_agentes: memoria.data ?? [],
    referencias_lidas: ((refs.data as { papel: string; leitura: string; tags: string[] }[] | null) ?? []).map((r) => ({ papel: r.papel, tecnica: texto(r.leitura, 400) })),
  };
  const r = await chamarTexto({
    clientId,
    tarefa: "contexto",
    agente: "contexto",
    modeloId: estrategista.id,
    raciocinio: raciocinioPara(estrategista, ["low", "medium"]),
    sistema: `${SISTEMA_CONVERSA}\n\n${CONHECIMENTO_DO_CONTEXTO}\n\nCONTEXTO ATUAL (JSON):\n${JSON.stringify(estado)}${dadosDasAcoes ? `\n${blocoDasAcoesDoContexto(dadosDasAcoes)}` : "\n- acoes: sempre null nesta mensagem."}`,
    mensagens: [
      ...anteriores.map((m) => ({ papel: (m.papel === "agente" ? "agente" : "usuario") as "agente" | "usuario", conteudo: texto(m.conteudo, 3000) })),
      { papel: "usuario", conteudo: mensagem },
    ],
    esquemaJson: ESQUEMA_CONVERSA,
    maxTokensSaida: 4000,
    referencia: { tipo: REF_TIPO, id: clientId },
    criadoPor: ch.userId,
  });
  const o = (r.json ?? {}) as Record<string, any>;
  const patch: Record<string, unknown> = { client_id: clientId, atualizado_em: new Date().toISOString(), atualizado_por: ch.userId };
  const mudou: string[] = [];
  if (typeof o.estilo === "string" && o.estilo.trim()) { patch.estilo = texto(o.estilo, 3000); mudou.push("estilo"); }
  if (typeof o.regras === "string" && o.regras.trim()) { patch.regras = texto(o.regras, 3000); mudou.push("regras"); }
  if (Array.isArray(o.paleta) && o.paleta.length) {
    const paleta = o.paleta.map((p: any) => ({ nome: texto(p?.nome, 40), hex: texto(p?.hex, 7).toUpperCase(), papel: texto(p?.papel, 20) })).filter((p: any) => HEX.test(p.hex));
    if (paleta.length) { patch.paleta = paleta.slice(0, 8); mudou.push("paleta"); }
  }
  if (o.contexto && typeof o.contexto === "object") {
    const atual = await lerContextoConsolidado(db, clientId);
    const novo: Record<string, unknown> = { ...atual };
    for (const k of ["negocio", "publico", "oferta", "tom_de_voz"]) {
      if (typeof o.contexto[k] === "string" && o.contexto[k].trim()) { novo[k] = texto(o.contexto[k], 1200); mudou.push(k); }
    }
    patch.contexto = novo;
  }
  if (Object.keys(patch).length > 3) {
    const { error: erroKit } = await db.from("cliente_kit_marca").upsert(patch, { onConflict: "client_id" });
    if (erroKit) console.error("agente-contexto: kit nao gravado na conversa", { client_id: clientId, erro: erroKit.message });
  }

  const memorias = (Array.isArray(o.memoria) ? o.memoria : [])
    .filter((m: any) => ["estrategista", "diretor_arte"].includes(m?.agente) && ["aprendizado", "preferencia", "evitar"].includes(m?.tipo) && texto(m?.texto))
    .slice(0, 5)
    .map((m: any) => ({ client_id: clientId, agente: m.agente, tipo: m.tipo, texto: texto(m.texto, 600), origem: "manual" }));
  // Frente H: grava pelo cérebro do cliente, uma de cada vez (a segunda já enxerga a primeira):
  // o mesmo aprendizado vira reforço e o que contradiz um antigo o aposenta.
  for (const m of memorias) {
    const area: AreaDoCerebro = m.agente === "diretor_arte" ? "arte" : "calendario";
    const g = await gravarNoCerebro(db, {
      client_id: clientId,
      area,
      categoria: m.tipo as CategoriaDoCerebro,
      texto: m.texto,
      motivo: "ensinado na conversa do agente de contexto",
      fonte: "agente_contexto",
      criado_por: ch.userId,
    });
    if (!g.gravada) console.error("agente-contexto: memoria nao gravada", { client_id: clientId, erro: g.erro });
  }

  const acaoProposta = dadosDasAcoes ? normalizarAcoesDoContexto(o.acoes, dadosDasAcoes, clientId) : null;
  const resposta = texto(o.resposta, 4000) || (acaoProposta ? "A lista está pronta para você confirmar." : "Pronto.");
  // client_id é obrigatório em agente_mensagens: sem ele o insert falhava calado e a conversa nunca ficava salva.
  const agora = Date.now();
  const { data: gravadas, error: erroMensagens } = await db.from("agente_mensagens").insert([
    { conversa_id: conversaId, client_id: clientId, papel: "usuario", conteudo: mensagem, criado_em: new Date(agora).toISOString() },
    { conversa_id: conversaId, client_id: clientId, papel: "agente", conteudo: resposta, uso_id: r.usoId || null, criado_em: new Date(agora + 1).toISOString(), anexos: acaoProposta ? [acaoProposta] : [] },
  ]).select("id, papel");
  if (erroMensagens) console.error("agente-contexto: conversa nao gravada", { client_id: clientId, erro: erroMensagens.message });
  const mensagemId = ((gravadas ?? []) as Array<{ id: string; papel: string }>).find((m) => m.papel === "agente")?.id ?? null;

  return json({
    resposta,
    mudou,
    acao: acaoProposta && mensagemId ? acaoProposta : null,
    mensagem_id: mensagemId,
    memorias: memorias.length,
    kit: await lerKit(clientId),
    custo_usd: r.custoUsd,
    saldo_usd: r.saldoUsd,
    reserva_usada: r.reservaUsada ?? null,
  });
}

async function historico(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const { data } = await servico()
    .from("agente_conversas")
    .select("id")
    .eq("client_id", clientId)
    .eq("agente", "contexto")
    .order("criado_em", { ascending: false })
    .limit(1);
  const conversa = ((data as { id: string }[] | null) ?? [])[0];
  if (!conversa) return json({ mensagens: [] });
  const { data: msgs } = await servico()
    .from("agente_mensagens")
    .select("id, papel, conteudo, criado_em, anexos")
    .eq("conversa_id", conversa.id)
    .order("criado_em", { ascending: true })
    .limit(60);
  return json({ mensagens: msgs ?? [] });
}

// ------------------------------------------------------------------ roteamento

// ------------------------------------------------------------------ acervo

async function acervoSincronizar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const r = await sincronizarAcervo(servico(), clientId);
  return json(r);
}

const CATEGORIAS_ACERVO = ["ambiente", "produto", "pessoa", "antes_depois", "equipe", "detalhe", "fachada", "logo", "arte", "outro"];
const MAX_CLASSIFICAR_POR_VEZ = 12;

const ESQUEMA_ACERVO = {
  nome: "acervo",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["itens"],
    properties: {
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "nome", "descricao", "categoria", "tags"],
          properties: {
            imagem: { type: "integer" },
            nome: { type: "string" },
            descricao: { type: "string" },
            categoria: { type: "string", enum: CATEGORIAS_ACERVO },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

const SISTEMA_ACERVO = `Você organiza o acervo de fotos reais de um cliente de agência. Para cada imagem anexada (na ordem), devolva:
- nome: nome curto e descritivo em português (ex.: "Quarto casal com luz natural", "Antes e depois do sofá").
- descricao: 1 a 2 frases objetivas do que aparece (ambiente, objeto, pessoas, luz, enquadramento) e onde há área calma para texto (céu, parede lisa, fundo desfocado).
- categoria: ambiente, produto, pessoa, antes_depois, equipe, detalhe, fachada, logo, arte (peça gráfica já pronta) ou outro.
- tags: 3 a 6 palavras curtas em minúsculas.
Não invente o que não aparece. Sem travessão.`;

/** Imagem reduzida pela transformação do Storage (menos tokens); sem ela, a original. */
async function imagemReduzida(bucket: string, caminho: string, nome: string): Promise<ImagemEntrada | null> {
  try {
    const { data, error } = await servico().storage.from(bucket).download(caminho, {
      transform: { width: 640, height: 640, resize: "contain", format: "origin" },
    });
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const mime = mimeDe(bytes);
      if (mime && bytes.byteLength <= MAX_BYTES) return { bytes, mime, nome };
    }
  } catch {
    // cai na original
  }
  return await baixarImagem(bucket, caminho, nome);
}

async function acervoClassificar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const ids = Array.isArray(corpo.ids) ? (corpo.ids as unknown[]).map((x) => texto(x, 64)).filter((x) => UUID.test(x)) : [];
  let q = servico().from("cliente_imagens").select("id, storage_bucket, storage_path, nome").eq("client_id", clientId).eq("ativa", true);
  q = ids.length ? q.in("id", ids.slice(0, MAX_CLASSIFICAR_POR_VEZ)) : q.is("descricao", null).order("criado_em", { ascending: true });
  const { data } = await q.limit(MAX_CLASSIFICAR_POR_VEZ);
  const linhas = (data as { id: string; storage_bucket: string; storage_path: string; nome: string }[] | null) ?? [];
  if (!linhas.length) return json({ classificadas: 0, custo_usd: 0, restantes: 0 });

  const baixadas = await Promise.all(linhas.map((l, i) => imagemReduzida(l.storage_bucket, l.storage_path, `foto-${i + 1}`)));
  const comImagem = linhas.map((l, i) => ({ linha: l, imagem: baixadas[i] })).filter((x) => x.imagem) as { linha: typeof linhas[number]; imagem: ImagemEntrada }[];
  // Foto cujo arquivo não abre sai da fila (inativa), senão as mesmas 12 voltavam sempre.
  const semArquivo = linhas.filter((_, i) => !baixadas[i]).map((l) => l.id);
  if (semArquivo.length) {
    await servico().from("cliente_imagens").update({ ativa: false, descricao: "Arquivo indisponível: não foi possível abrir a imagem." }).in("id", semArquivo).eq("client_id", clientId);
  }
  if (!comImagem.length) return json({ classificadas: 0, custo_usd: 0, restantes: 0 });

  const leitor = await modeloDoPapel("leitura");
  const r = await chamarTexto({
    clientId,
    tarefa: "contexto",
    agente: "contexto",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["minimal", "low"]),
    sistema: SISTEMA_ACERVO,
    mensagens: [{
      papel: "usuario",
      conteudo: `Organize as ${comImagem.length} fotos anexadas, na ordem. Nome atual do arquivo de cada uma: ` +
        comImagem.map((c, i) => `${i + 1}) ${c.linha.nome}`).join("; "),
      imagens: comImagem.map((c) => c.imagem),
    }],
    esquemaJson: ESQUEMA_ACERVO,
    maxTokensSaida: 4000,
    referencia: { tipo: REF_TIPO, id: clientId },
    criadoPor: ch.userId,
  });
  const itens = ((r.json as { itens?: { imagem: number; nome: string; descricao: string; categoria: string; tags: string[] }[] } | undefined)?.itens) ?? [];
  let classificadas = 0;
  await Promise.all(itens.map(async (it) => {
    const alvo = comImagem[Math.round(it.imagem) - 1];
    if (!alvo || !texto(it.descricao)) return;
    const tags = Array.from(new Set((Array.isArray(it.tags) ? it.tags : []).map((t) => texto(t, 40).toLowerCase()).filter(Boolean))).slice(0, 8);
    const { error } = await servico().from("cliente_imagens").update({
      nome: texto(it.nome, 120) || alvo.linha.nome,
      descricao: texto(it.descricao, 600),
      categoria: CATEGORIAS_ACERVO.includes(it.categoria) ? it.categoria : "outro",
      tags,
    }).eq("id", alvo.linha.id).eq("client_id", clientId);
    if (!error) classificadas++;
  }));
  const { count } = await servico().from("cliente_imagens").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("ativa", true).is("descricao", null);
  return json({ classificadas, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, restantes: count ?? 0, reserva_usada: r.reservaUsada ?? null });
}

// ------------------------------------------------------------------- logo

const EXTENSAO: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Onde mora a imagem escolhida, sempre conferindo que é do mesmo cliente. */
async function origemDaImagem(clientId: string, origem: string, id: string): Promise<{ bucket: string; caminho: string } | null> {
  if (origem === "arquivo") {
    const { data } = await servico().from("files").select("client_id, storage_bucket, storage_path, file_url").eq("id", id).maybeSingle();
    const f = data as { client_id: string; storage_bucket: string | null; storage_path: string | null; file_url: string | null } | null;
    return f && f.client_id === clientId ? caminhoDoArquivo(f) : null;
  }
  if (origem === "workspace") {
    const { data } = await servico().from("workspace_nodes").select("client_id, storage_path").eq("id", id).maybeSingle();
    const n = data as { client_id: string | null; storage_path: string | null } | null;
    return n && n.client_id === clientId && n.storage_path ? { bucket: "workspace", caminho: n.storage_path } : null;
  }
  if (origem === "acervo") {
    const { data } = await servico().from("cliente_imagens").select("client_id, storage_bucket, storage_path").eq("id", id).maybeSingle();
    const a = data as { client_id: string; storage_bucket: string; storage_path: string } | null;
    return a && a.client_id === clientId ? { bucket: a.storage_bucket, caminho: a.storage_path } : null;
  }
  return null;
}

/** Logo acima disto não entra no kit como está: o Estúdio não consegue abrir (limite de memória da função). */
const LOGO_MAX_PIXELS = 16_000_000;

async function definirLogo(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = texto(corpo.client_id, 64);
  await garantirAcesso(ch, clientId);
  const origem = texto(corpo.origem, 20);
  const id = texto(corpo.id, 64);
  if (!["arquivo", "workspace", "acervo"].includes(origem) || !UUID.test(id)) {
    throw new ErroContexto(400, "logo_invalida", "Escolha uma imagem de Arquivos, do workspace ou do acervo.");
  }
  const alternativa = corpo.alternativa === true;
  const onde = await origemDaImagem(clientId, origem, id);
  if (!onde) throw new ErroContexto(404, "logo_inexistente", "Esta imagem não foi encontrada entre as do cliente.");
  const img = await baixarImagem(onde.bucket, onde.caminho, "logo");
  if (!img) throw new ErroContexto(415, "logo_nao_e_imagem", "A logo precisa ser PNG, JPG ou WEBP (PNG com fundo transparente de preferência).");
  // 26/09: logo de 7813 x 7813 px derrubou o Estúdio por memória (o Storage não reduz imagem desse tamanho).
  // Acima de 16 MP a tela reduz no navegador e grava a versão menor (ContextoLogos).
  const dim = dimensoesDoCabecalho(img.bytes);
  if (dim && dim.largura * dim.altura > LOGO_MAX_PIXELS) {
    throw new ErroContexto(413, "logo_grande_demais", `A logo tem ${dim.largura} x ${dim.altura} px. A tela reduz para 2048 px e grava de novo.`, {
      largura: dim.largura,
      altura: dim.altura,
      bucket: onde.bucket,
      caminho: onde.caminho,
    });
  }

  const destino = `${clientId}/marca/${alternativa ? "logo-alternativa" : "logo"}-${Date.now()}.${EXTENSAO[img.mime] ?? "png"}`;
  const { error: erroUpload } = await servico().storage.from("mesa").upload(destino, new Blob([new Uint8Array(img.bytes)], { type: img.mime }), {
    contentType: img.mime,
    upsert: true,
  });
  if (erroUpload) throw new ErroContexto(503, "logo_nao_copiada", "Não foi possível guardar a logo. Tente de novo.");
  const agora = new Date().toISOString();
  const { error } = await servico().from("cliente_kit_marca").upsert({
    client_id: clientId,
    [alternativa ? "logo_alt_path" : "logo_path"]: destino,
    atualizado_em: agora,
    atualizado_por: ch.userId,
  }, { onConflict: "client_id" });
  if (error) throw new ErroContexto(503, "kit_nao_gravado", "A logo foi copiada, mas o kit não foi atualizado.");
  // Clara ou escura era da logo anterior: zera, e a tela grava o da nova logo logo depois
  // (ContextoLogos, lida no navegador). Sem a coluna no banco (T-logo-tom.sql), só segue.
  await servico()
    .from("cliente_kit_marca")
    .update({ [alternativa ? "logo_alt_tom" : "logo_tom"]: null })
    .eq("client_id", clientId)
    .then(() => undefined, () => undefined);
  return json({ kit: await lerKit(clientId), caminho: destino });
}

// ------------------------------------------------------------------ ações (propor e confirmar)

const comoErroDoContexto = (e: unknown) => (e instanceof ErroDaAcao ? new ErroContexto(e.status, e.codigo, e.message) : e);

/** O que o agente de contexto pode mexer: logos do kit, referências, acervo e workspace do cliente. */
async function dadosParaAcoes(clientId: string): Promise<DadosDoContexto> {
  const db = servico();
  const [kit, refs, fotos, nos] = await Promise.all([
    lerKit(clientId),
    db.from("cliente_referencias").select("id, papel, origem, tags, leitura, destaque").eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(60),
    db.from("cliente_imagens").select("id, nome, pasta, tags, ativa, aprovada, origem, gerada").eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(80),
    db.from("workspace_nodes").select("id, parent_id, kind, name, inbox_token").eq("scope", "client").eq("client_id", clientId).order("name").limit(300),
  ]);
  // Sem a coluna de recebimento (ou de destaque/aprovação), relê só o essencial: a lista não some.
  const refsOk = refs.error
    ? await db.from("cliente_referencias").select("id, papel, origem, tags, leitura").eq("client_id", clientId).eq("ativa", true).limit(60)
    : refs;
  const fotosOk = fotos.error
    ? await db.from("cliente_imagens").select("id, nome, pasta, tags, ativa, origem").eq("client_id", clientId).eq("ativa", true).limit(80)
    : fotos;
  const nosOk = nos.error
    ? await db.from("workspace_nodes").select("id, parent_id, kind, name").eq("scope", "client").eq("client_id", clientId).order("name").limit(300)
    : nos;
  return {
    kit: kit ? { logo_path: kit.logo_path ?? null, logo_alt_path: kit.logo_alt_path ?? null, logo_file_id: kit.logo_file_id ?? null } : null,
    referencias: (refsOk.data ?? []) as ReferenciaDoCliente[],
    fotos: (fotosOk.data ?? []) as FotoDoAcervo[],
    nos: (nosOk.data ?? []) as NoDoWorkspace[],
  };
}

/** Uma operação do agente de contexto, já confirmada. */
async function executarItemDoContexto(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const db = servico();
  if (item.operacao === "trocar_logo") {
    const alternativa = item.alvo_id === "alternativa";
    const antes = await lerKit(clientId);
    const caminhoAntes = alternativa ? antes?.logo_alt_path ?? null : antes?.logo_path ?? null;
    try {
      await definirLogo(ch, { client_id: clientId, origem: "acervo", id: String(item.para), alternativa });
    } catch (e) {
      if (e instanceof ErroContexto && e.codigo === "logo_grande_demais") throw new Error("A imagem é grande demais para virar logo aqui. Troque pela tela de Logos, que reduz antes de gravar.");
      throw e;
    }
    return { desfazer: { alternativa, caminho: caminhoAntes } };
  }
  if (item.operacao === "arquivar_referencia") {
    const { data } = await db.from("cliente_referencias").select("id, client_id, ativa").eq("id", item.alvo_id).maybeSingle();
    const r = data as { id: string; client_id: string; ativa: boolean } | null;
    if (!r || r.client_id !== clientId) throw new Error("Esta referência não está mais com o cliente.");
    if (!r.ativa) return { aviso: "já estava arquivada" };
    const { error } = await db.from("cliente_referencias").update({ ativa: false }).eq("id", r.id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível arquivar a referência.");
    return { desfazer: { ativa: true } };
  }
  if (["arquivar_foto", "mover_foto", "marcar_foto", "tirar_marca"].indexOf(item.operacao) >= 0) return executarNoAcervo(db, clientId, item);
  if (["mover", "renomear", "arquivar"].indexOf(item.operacao) >= 0) return executarNoWorkspace(db, clientId, ch.userId, item);
  throw new Error("Operação desconhecida.");
}

async function desfazerItemDoContexto(clientId: string, r: ResultadoDoItem) {
  const db = servico();
  const d = (r.desfazer ?? {}) as Record<string, unknown>;
  if (r.operacao === "trocar_logo") {
    const alternativa = d.alternativa === true;
    const { error } = await db.from("cliente_kit_marca").update({ [alternativa ? "logo_alt_path" : "logo_path"]: (d.caminho as string | null) ?? null, atualizado_em: new Date().toISOString() }).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível voltar a logo de antes.");
    await db.from("cliente_kit_marca").update({ [alternativa ? "logo_alt_tom" : "logo_tom"]: null }).eq("client_id", clientId).then(() => undefined, () => undefined);
    return;
  }
  if (r.operacao === "arquivar_referencia") {
    const { error } = await db.from("cliente_referencias").update({ ativa: true }).eq("id", r.alvo_id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível devolver a referência.");
    return;
  }
  if (["arquivar_foto", "mover_foto", "marcar_foto", "tirar_marca"].indexOf(r.operacao) >= 0) return reverterNoAcervo(db, clientId, r);
  if (["mover", "renomear", "arquivar"].indexOf(r.operacao) >= 0) return reverterNoWorkspace(db, clientId, r);
}

async function propostaDoContexto(ch: Chamador, corpo: Record<string, unknown>): Promise<AcaoGuardada> {
  try {
    return await acaoGuardadaNaMensagem(servico(), corpo.mensagem_id, (clientId) => garantirAcesso(ch, clientId), { acaoId: corpo.acao_id, agente: "contexto" });
  } catch (e) {
    throw comoErroDoContexto(e);
  }
}

/** executar_acao_agente { mensagem_id, acao_id?, descartar? }: a equipe confirmou (ou cancelou) o que o agente de contexto propôs. */
async function executarAcaoDoContexto(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaDoContexto(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  const inicio = Date.now();
  let r: { anexo: AcaoDoAgente; resultados: ResultadoDoItem[] };
  try {
    r = await confirmarAcaoGuardada(guardada, (item) => executarItemDoContexto(ch, clientId, item), { descartar: corpo.descartar === true, userId: ch.userId, lote: 3 });
  } catch (e) {
    throw comoErroDoContexto(e);
  }
  if (corpo.descartar === true) return json({ anexo: r.anexo });
  const feitos = r.resultados.filter((x) => x.ok).length;
  const falhas = r.resultados.length - feitos;
  if (guardada.mensagem.conversa_id) {
    await servico().from("agente_mensagens").insert({ conversa_id: guardada.mensagem.conversa_id, client_id: clientId, papel: "sistema", conteudo: `Contexto: ${textoDoResultado(r.resultados)}.` }).then(() => undefined, () => undefined);
  }
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "contexto_acao_do_agente", origin: "mesa:agente-contexto",
    keyId: `mesa:agente-contexto:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: clientId, mensagem_id: guardada.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) },
    success: falhas === 0, statusCode: 200, durationMs: Date.now() - inicio, resultRef: guardada.mensagem.id,
  });
  return json({ anexo: r.anexo, feitos, falhas, kit: await lerKit(clientId) });
}

/** desfazer_acao_agente { mensagem_id, acao_id? }: volta o que a ação mudou. */
async function desfazerAcaoDoContexto(ch: Chamador, corpo: Record<string, unknown>) {
  const guardada = await propostaDoContexto(ch, corpo);
  const clientId = guardada.mensagem.client_id;
  let r: { anexo: AcaoDoAgente; voltaram: number; falharam: Array<{ ref: string; titulo: string; motivo: string }> };
  try {
    r = await desfazerAcaoGuardada(guardada, (x) => desfazerItemDoContexto(clientId, x), { userId: ch.userId });
  } catch (e) {
    throw comoErroDoContexto(e);
  }
  if (guardada.mensagem.conversa_id) {
    await servico().from("agente_mensagens").insert({ conversa_id: guardada.mensagem.conversa_id, client_id: clientId, papel: "sistema", conteudo: `Contexto: ação desfeita (${r.voltaram} ${r.voltaram === 1 ? "item voltou" : "itens voltaram"}).` }).then(() => undefined, () => undefined);
  }
  await auditLog({
    correlationId: crypto.randomUUID(), toolName: "contexto_desfazer_acao_do_agente", origin: "mesa:agente-contexto",
    keyId: `mesa:agente-contexto:${ch.userId}`, scopes: ["files:write"],
    input: { client_id: clientId, mensagem_id: guardada.mensagem.id }, success: r.falharam.length === 0, statusCode: 200, durationMs: 0, resultRef: guardada.mensagem.id,
  });
  return json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam, kit: await lerKit(clientId) });
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  ler,
  montar,
  conversar,
  historico,
  acervo_sincronizar: acervoSincronizar,
  acervo_classificar: acervoClassificar,
  definir_logo: definirLogo,
  fontes_da_biblioteca: fontesDaBiblioteca,
  executar_acao_agente: executarAcaoDoContexto,
  desfazer_acao_agente: desfazerAcaoDoContexto,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return erro(405, "metodo_nao_permitido", "Use POST.");
  let ch: Chamador | null = null;
  try {
    ch = await identificar(req);
  } catch {
    ch = null;
  }
  if (!ch) return erro(401, "nao_autorizado", "Sessão expirada ou sem permissão de equipe.");
  let corpo: Record<string, unknown> = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio */ }
  const acao = String(corpo.acao ?? "");
  const executar = ACOES[acao];
  if (!executar) return erro(400, "acao_desconhecida", "Ação desconhecida.", { aceitas: Object.keys(ACOES) });
  try {
    return await executar(ch, corpo);
  } catch (e) {
    if (e instanceof ErroContexto) return erro(e.status, e.codigo, e.message, e.detalhes);
    if (e instanceof IaMotorErro) {
      const status = STATUS_MOTOR[e.codigo] ?? e.status;
      return json({ ...(e.paraJson() as Record<string, unknown>), mensagem: MENSAGEM_MOTOR[e.codigo] ?? e.message }, status);
    }
    if (e instanceof JevErro) return erro(502, "jev_indisponivel", "O Jev não respondeu. Tente de novo.", { codigo: e.codigo });
    console.error("agente-contexto: falha inesperada", { acao, erro: e instanceof Error ? e.name : "desconhecido" });
    return erro(500, "erro_interno", "Erro inesperado no agente de contexto. Tente de novo.");
  }
});
