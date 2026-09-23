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
import {
  artesAprovadas,
  caminhoDoArquivo,
  candidatosALogo,
  lerContextoConsolidado,
  lerDocumentosDeMarca,
  lerDossie,
  sincronizarReferencias,
  type ContextoConsolidado,
} from "../_shared/contexto-cliente.ts";

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
const MAX_LEITURAS_POR_VEZ = 8;
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

function raciocinioPara(m: ModeloIa, preferidos: string[]): string | undefined {
  const aceitos = m.raciocinio ?? [];
  return preferidos.find((r) => aceitos.includes(r));
}

type Kit = {
  client_id: string;
  paleta: { nome?: string; hex?: string; papel?: string }[] | null;
  logo_file_id: string | null;
  estilo: string | null;
  regras: string | null;
  contexto: ContextoConsolidado | null;
  contexto_atualizado_em: string | null;
} | null;

async function lerKit(clientId: string): Promise<Kit> {
  const { data } = await servico()
    .from("cliente_kit_marca")
    .select("client_id, paleta, logo_file_id, estilo, regras, contexto, contexto_atualizado_em")
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
  const sinc = await sincronizarReferencias(db, clientId);
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
  if (!kit?.logo_file_id) lacunas.push(logos.length ? "Escolha qual arquivo é a logo oficial." : "Envie a logo oficial em imagem (PNG com fundo transparente de preferência).");
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
      sincronizadas_agora: sinc.workspace_novas + sinc.arquivos_novas,
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
  for (const r of pendentes) {
    const imagem = await imagemDaReferencia(clientId, r);
    if (imagem) comImagem.push({ ref: r, imagem });
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

  await sincronizarReferencias(db, clientId);
  const leitura = await lerReferenciasPendentes(ch, clientId).catch((e) => {
    if (e instanceof IaMotorErro && STATUS_MOTOR[e.codigo]) throw e;
    return { lidas: 0, custo: 0 };
  });

  const [kit, docs, dossie, artes, nome] = await Promise.all([
    lerKit(clientId),
    lerDocumentosDeMarca(db, clientId, 20_000),
    lerDossie(db, clientId, 5000),
    artesAprovadas(db, clientId, MAX_ARTES_NO_MONTAR),
    nomeDoCliente(clientId),
  ]);
  const imagens: ImagemEntrada[] = [];
  for (const a of artes) {
    const c = caminhoDoArquivo(a);
    const img = c ? await baixarImagem(c.bucket, c.caminho, `arte-publicada-${imagens.length + 1}`) : null;
    if (img) imagens.push(img);
  }
  if (!docs.length && !dossie && !imagens.length) {
    throw new ErroContexto(409, "sem_fontes", "Ainda não há documentos, dossiê nem artes deste cliente no painel para ler.");
  }

  const leitor = await modeloDoPapel("leitura");
  const r = await chamarTexto({
    clientId,
    tarefa: "contexto",
    agente: "contexto",
    modeloId: leitor.id,
    raciocinio: raciocinioPara(leitor, ["medium", "low"]),
    sistema: SISTEMA_CONTEXTO,
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
      ...(imagens.length ? [`${imagens.length} artes publicadas`] : []),
    ],
  };

  const estilo = texto(c.estilo, 3000);
  const regras = texto(c.regras, 3000);
  const vazio = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
  const sugestoes: Record<string, unknown> = {};
  const patch: Record<string, unknown> = {
    client_id: clientId,
    contexto,
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
};

/**
 * Par título + texto escolhido pelo Jev entre os pareamentos da biblioteca,
 * pelo contexto da marca. Grava em cliente_fontes com origem biblioteca.
 */
async function escolherFontesDaBiblioteca(ch: Chamador, clientId: string) {
  const db = servico();
  const { data } = await db
    .from("fontes_biblioteca")
    .select("id, familia, categoria, personalidade, usos, nichos, pareamentos, amostra_path, suporta_portugues")
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

  const linhas = [
    { client_id: clientId, nome: par.titulo.familia, papel: "titulo", amostra_path: par.titulo.amostra_path, biblioteca_id: par.titulo.id, origem: "biblioteca" },
    { client_id: clientId, nome: par.texto.familia, papel: "texto", amostra_path: par.texto.amostra_path, biblioteca_id: par.texto.id, origem: "biblioteca" },
  ];
  const { error } = await db.from("cliente_fontes").insert(linhas);
  if (error) return null;
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
    required: ["resposta", "estilo", "regras", "paleta", "contexto", "memoria"],
    properties: {
      resposta: { type: "string" },
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

  const estrategista = await modeloDoPapel("estrategista");
  const estado = {
    cliente: nome,
    kit: { paleta: kit?.paleta ?? [], estilo: kit?.estilo ?? null, regras: kit?.regras ?? null, tem_logo: !!kit?.logo_file_id },
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
    sistema: `${SISTEMA_CONVERSA}\n\nCONTEXTO ATUAL (JSON):\n${JSON.stringify(estado)}`,
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
  if (Object.keys(patch).length > 3) await db.from("cliente_kit_marca").upsert(patch, { onConflict: "client_id" });

  const memorias = (Array.isArray(o.memoria) ? o.memoria : [])
    .filter((m: any) => ["estrategista", "diretor_arte"].includes(m?.agente) && ["aprendizado", "preferencia", "evitar"].includes(m?.tipo) && texto(m?.texto))
    .slice(0, 5)
    .map((m: any) => ({ client_id: clientId, agente: m.agente, tipo: m.tipo, texto: texto(m.texto, 600), origem: "manual" }));
  if (memorias.length) await db.from("agente_memoria").insert(memorias);

  const resposta = texto(o.resposta, 4000) || "Pronto.";
  await db.from("agente_mensagens").insert([
    { conversa_id: conversaId, papel: "usuario", conteudo: mensagem },
    { conversa_id: conversaId, papel: "agente", conteudo: resposta, uso_id: r.usoId || null },
  ]);

  return json({
    resposta,
    mudou,
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
    .select("papel, conteudo, criado_em")
    .eq("conversa_id", conversa.id)
    .order("criado_em", { ascending: true })
    .limit(60);
  return json({ mensagens: msgs ?? [] });
}

// ------------------------------------------------------------------ roteamento

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  ler,
  montar,
  conversar,
  historico,
  fontes_da_biblioteca: fontesDaBiblioteca,
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
