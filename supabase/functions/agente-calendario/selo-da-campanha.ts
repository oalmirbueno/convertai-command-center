/**
 * Selo da campanha no servidor (frente SEL, 30/09). Ações da função
 * agente-calendario (POST { acao, ... }), todas com o acesso ao cliente
 * conferido e escrita só pela chave de serviço:
 *
 * - selo_estado { campanha_id } -> { campanha, versoes, referencias, direcao, impacto } (sem custo)
 * - selo_gerar { campanha_id, lote_id?, estilo?, variacao?, modelo_id?, qualidade?, texto?, pedido? }
 *     UMA opção por chamada (a tela pede 3 ou 4 em paralelo com o mesmo lote_id: cabe no limite
 *     de CPU e cada opção aparece quando fica pronta). Não escolhe: a equipe escolhe.
 * - selo_melhorar { campanha_id, selo_id, pedido, referencias?, link?, modelo_id?, qualidade? }
 *     edita a versão pedida (imagem 1) com o pedido e as referências; a nova fica ao lado da antiga.
 * - selo_escolher { campanha_id, selo_id | null } -> vira o selo da campanha (Desfazer = escolher a anterior)
 * - selo_usar { campanha_id, origem: acervo|arquivo|enviado|logo, imagem_id?, selo_id?, caminho?, remover_fundo? }
 *     selo pronto, sem gerador: o arquivo é só limpo (fundo liso tirado, margem aparada, PNG de até 512 px)
 *     e escolhido. Sem custo.
 * - selo_referencias { campanha_id, adicionar?: [{ caminho?, link?, nota? }], tirar?: [caminho], pedido? }
 *     cada referência nova é descrita pelo leitor (visão) e o Jev (Choice) diz o papel dela:
 *     estilo, forma, cor ou só inspiração. A direção usa o papel.
 * - selo_arquivar { campanha_id, selo_id } -> apagar é arquivar (a escolhida não arquiva)
 *
 * O Estúdio cola o selo escolhido pelo código, intacto (estudio-arte, gravarVersao).
 * Regras puras e o porquê do selo genérico: _shared/selo-da-campanha.ts.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aceitaFundoTransparente,
  carregarModelo,
  chamarImagem,
  chamarTexto,
  cobrarJev,
  estimarComModelo,
  IaMotorErro,
  type ImagemEntrada,
  modeloPadrao,
  type ModeloIa,
  type Qualidade,
} from "../_shared/ia-motor.ts";
import { decodificar, logoLimpa } from "../_shared/imagem-local.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { jevPerguntar, type PerguntaJev } from "../_shared/jev.ts";
import { fontesDaMarca, kitComMarca, type MarcaDoCliente, resolverMarca } from "../_shared/marca.ts";
import { lerRegrasDoDono } from "../_shared/aprendizado-nos-agentes.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { auditLog } from "../_shared/mcp-audit.ts";
import { DEFINICAO_DO_TIPO, direcaoDoSeloDoTipo, tipoDaCampanha } from "../_shared/tipos-de-campanha.ts";
import {
  avisosDoTexto,
  caminhoDoSelo,
  type ConferenciaDoTexto,
  conferirTextoDoSelo,
  type ContextoDoSelo,
  direcaoDoSelo,
  estiloValido,
  impactoDaTroca,
  intencaoPelaResposta,
  type IntencaoDoSelo,
  MAX_REFERENCIAS_DO_SELO,
  ORIGENS_DO_SELO,
  type OrigemDoSelo,
  papelPelaResposta,
  perguntaDoPapelDaReferencia,
  perguntaDoPedidoDoSelo,
  planoDasOpcoes,
  type ReferenciaDoSelo,
  referenciasDoSelo,
  textoDoSelo,
  type TrabalhoDaCampanha,
} from "../_shared/selo-da-campanha.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = "mesa_campanha";
const LADO_DO_SELO = 1024;
const MAX_BYTES = 20 * 1024 * 1024;

export type Chamador = { userId: string; token: string };

export type CampanhaDoSelo = {
  id: string;
  client_id: string;
  nome: string;
  objetivo: string | null;
  conceito: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  identidade: Record<string, unknown> | null;
  briefing?: Record<string, unknown> | null;
  selo_path: string | null;
  selo_id?: string | null;
  selo_referencias?: unknown;
  custo_usd: number;
};

export type VersaoDoSelo = {
  id: string;
  campanha_id: string;
  client_id: string;
  caminho: string;
  origem: OrigemDoSelo;
  estilo: string | null;
  texto: string | null;
  conferencia: ConferenciaDoTexto | null;
  pedido: string | null;
  anterior_id: string | null;
  lote_id: string | null;
  fonte: Record<string, unknown> | null;
  modelo_id: string | null;
  custo_usd: number;
  escolhido_em: string | null;
  arquivado_em: string | null;
  criado_em: string;
};

export type DepsDoSelo = {
  erro: (status: number, codigo: string, mensagem: string, extra?: Record<string, unknown>) => Error;
  json: (body: unknown, status?: number) => Response;
  carregarCampanha: (servico: SupabaseClient, id: unknown) => Promise<CampanhaDoSelo>;
  exigirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  somarCusto: (servico: SupabaseClient, id: string, clientId: string, valor: number) => Promise<void>;
};

const arred = (n: number) => Math.round(n * 1e6) / 1e6;
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const qualidadeValida = (v: unknown): Qualidade => (v === "baixa" || v === "alta" ? v : "media");

/** O SQL de 30/09 ainda não rodou (tabela ou coluna nova ausente). */
export function faltaOSqlDoSelo(e: unknown): boolean {
  const o = (e ?? {}) as { code?: string; message?: string };
  return ["42P01", "42703", "PGRST204", "PGRST205"].indexOf(String(o.code || "")) >= 0 ||
    /mesa_campanha_selos|selo_id|selo_referencias/.test(String(o.message || ""));
}

export function acoesDoSelo(deps: DepsDoSelo) {
  const semSql = () => deps.erro(503, "selo_sem_sql", "O banco ainda não tem as versões do selo. Falta aplicar o SQL 20260930100000_selo_da_campanha.sql.");
  const falhaDoBanco = (e: unknown, codigo: string, mensagem: string) => (faltaOSqlDoSelo(e) ? semSql() : deps.erro(503, codigo, mensagem));

  // ---------------------------------------------------------------- leituras

  async function campanhaComAcesso(servico: SupabaseClient, ch: Chamador, id: unknown): Promise<CampanhaDoSelo> {
    const c = await deps.carregarCampanha(servico, id);
    await deps.exigirAcesso(ch, c.client_id);
    return c;
  }

  /** A marca da campanha manda (identidade.marca_id); sem ela, a da casca; sem nada, a principal. */
  function marcaDaCampanha(servico: SupabaseClient, c: CampanhaDoSelo, corpo: Record<string, unknown>): Promise<MarcaDoCliente | null> {
    const daCampanha = c.identidade && typeof c.identidade === "object" ? (c.identidade as Record<string, unknown>).marca_id : null;
    return resolverMarca(servico, c.client_id, { marca_id: typeof daCampanha === "string" && UUID.test(daCampanha) ? daCampanha : corpo.marca_id });
  }

  type Kit = { paleta?: unknown; logo_path?: string | null; logo_file_id?: string | null; estilo?: string | null; regras?: string | null; contexto?: unknown } & Record<string, unknown>;

  async function lerKit(servico: SupabaseClient, clientId: string, marca: MarcaDoCliente | null): Promise<Kit | null> {
    const { data, error } = await servico
      .from("cliente_kit_marca")
      .select("paleta, logo_path, logo_file_id, logo_alt_path, logo_alt_file_id, estilo, regras, contexto")
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) registrarFalha("selo: kit da marca não lido", error, { client_id: clientId });
    return kitComMarca((data as Kit | null) ?? null, marca);
  }

  async function lerFontes(servico: SupabaseClient, clientId: string, marca: MarcaDoCliente | null): Promise<{ nome: string; papel: string | null }[]> {
    const { data, error } = await servico.from("cliente_fontes").select("nome, papel, marca_id").eq("client_id", clientId).limit(20);
    if (error) {
      registrarFalha("selo: fontes não lidas", error, { client_id: clientId });
      return [];
    }
    return fontesDaMarca(((data ?? []) as { nome: string; papel: string | null; marca_id: string | null }[]), marca).map((f) => ({ nome: f.nome, papel: f.papel }));
  }

  async function lerVersao(servico: SupabaseClient, c: CampanhaDoSelo, id: unknown): Promise<VersaoDoSelo> {
    const sid = String(id ?? "");
    if (!UUID.test(sid)) throw deps.erro(400, "selo_invalido", "Selo inválido.");
    const { data, error } = await servico.from("mesa_campanha_selos").select("*").eq("id", sid).eq("client_id", c.client_id).maybeSingle();
    if (error) throw falhaDoBanco(error, "selo_indisponivel", "Não foi possível ler o selo.");
    if (!data) throw deps.erro(404, "selo_inexistente", "Selo não encontrado nesta campanha.");
    return data as VersaoDoSelo;
  }

  async function lerVersoes(servico: SupabaseClient, c: CampanhaDoSelo): Promise<VersaoDoSelo[]> {
    const { data, error } = await servico
      .from("mesa_campanha_selos")
      .select("*")
      .eq("campanha_id", c.id)
      .eq("client_id", c.client_id)
      .is("arquivado_em", null)
      .order("criado_em", { ascending: false })
      .limit(40);
    if (error) throw falhaDoBanco(error, "selos_indisponiveis", "Não foi possível ler os selos da campanha.");
    return (data ?? []) as VersaoDoSelo[];
  }

  /** Imagem de até 1024 px (cópia leve quando existe; a original grande não abre aqui). */
  async function reduzida(servico: SupabaseClient, bucket: string, caminho: string, lado = LADO_DO_SELO): Promise<ImagemEntrada> {
    const r = await reduzidaSemTransformacao(servico, bucket, caminho, lado, lado, { copiaSoEmPng: true, maxBytes: MAX_BYTES, pedirCopia: true })
      ?? await reduzidaSemTransformacao(servico, bucket, caminho, lado, lado, { maxBytes: MAX_BYTES, pedirCopia: true });
    if (!r || !r.cabe) throw deps.erro(422, "imagem_grande_demais", "A imagem é grande demais para abrir aqui. Envie uma versão menor (até 2000 px).");
    return { bytes: r.bytes, mime: r.mime, nome: caminho.split("/").pop() || "imagem" };
  }

  /**
   * O selo pronto para colar: PNG com a margem aparada e até 512 px. Com
   * `removerFundo`, o fundo claro e liso ligado à borda vira transparente
   * (logoLimpa). Devolve se o resultado tem fundo transparente.
   */
  async function seloLimpo(bytes: Uint8Array, removerFundo: boolean): Promise<{ png: Uint8Array; transparente: boolean }> {
    let saida = removerFundo ? await logoLimpa(bytes, { aparar: true }) : bytes;
    const img = await decodificar(saida);
    let final = img;
    if (!removerFundo || img.width > 512 || img.height > 512) {
      final = img.width > 512 || img.height > 512 ? img.clone().contain(512, 512) : img;
    }
    const b = final.bitmap;
    const W = final.width, H = final.height;
    const cantos = [0, W - 1, (H - 1) * W, (H - 1) * W + W - 1, Math.floor(W / 2), (H - 1) * W + Math.floor(W / 2)];
    const transparente = cantos.filter((p) => b[p * 4 + 3] < 24).length >= 4;
    const ehPng = saida.length > 8 && saida[0] === 0x89 && saida[1] === 0x50;
    if (final !== img || !ehPng) saida = await final.encode(1);
    return { png: saida, transparente };
  }

  const avisoDoFundo = "O selo tem fundo (não é transparente): na arte ele entra com esse fundo. Marque Tirar o fundo liso, ou use Tirar fundo (pro) na imagem do acervo.";

  // ---------------------------------------------------------------- gravar e escolher

  async function gravarVersaoDoSelo(
    servico: SupabaseClient,
    c: CampanhaDoSelo,
    v: { png: Uint8Array; origem: OrigemDoSelo; caminho?: string; estilo?: string | null; texto?: string | null; conferencia?: ConferenciaDoTexto | null; pedido?: string | null; anterior_id?: string | null; lote_id?: string | null; fonte?: Record<string, unknown> | null; modelo_id?: string | null; custo_usd?: number; userId: string },
  ): Promise<VersaoDoSelo> {
    let caminho = v.caminho;
    if (!caminho) {
      caminho = caminhoDoSelo(c.client_id, c.id, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const { error } = await servico.storage.from("mesa").upload(caminho, new Blob([new Uint8Array(v.png)], { type: "image/png" }), { contentType: "image/png" });
      if (error) throw deps.erro(503, "selo_nao_guardado", "O selo ficou pronto, mas não foi guardado. Tente de novo.");
    }
    const lote = typeof v.lote_id === "string" && UUID.test(v.lote_id) ? v.lote_id : null;
    const { data, error } = await servico
      .from("mesa_campanha_selos")
      .insert({
        campanha_id: c.id,
        client_id: c.client_id,
        caminho,
        origem: v.origem,
        estilo: v.estilo ?? null,
        texto: v.texto ?? null,
        conferencia: v.conferencia ?? null,
        pedido: v.pedido ?? null,
        anterior_id: v.anterior_id ?? null,
        lote_id: lote,
        fonte: v.fonte ?? null,
        modelo_id: v.modelo_id ?? null,
        custo_usd: arred(v.custo_usd ?? 0),
        criado_por: v.userId,
      })
      .select("*")
      .single();
    if (error || !data) throw falhaDoBanco(error, "selo_nao_registrado", "O selo foi guardado, mas não entrou no histórico. Tente de novo.");
    return data as VersaoDoSelo;
  }

  /** Vira o selo da campanha (null tira o selo). Devolve a campanha e o que era antes (para o Desfazer). */
  async function escolherSelo(servico: SupabaseClient, c: CampanhaDoSelo, v: VersaoDoSelo | null, userId?: string): Promise<{ campanha: CampanhaDoSelo; anterior: { selo_id: string | null; selo_path: string | null } }> {
    const anterior = { selo_id: c.selo_id ?? null, selo_path: c.selo_path };
    const { data, error } = await servico
      .from("mesa_campanhas")
      .update({ selo_path: v ? v.caminho : null, selo_id: v ? v.id : null })
      .eq("id", c.id)
      .eq("client_id", c.client_id)
      .select("*")
      .single();
    if (error || !data) throw falhaDoBanco(error, "campanha_nao_salva", "O selo não foi trocado. Tente de novo.");
    if (v) {
      const { error: e2 } = await servico.from("mesa_campanha_selos").update({ escolhido_em: new Date().toISOString(), arquivado_em: null }).eq("id", v.id).eq("client_id", c.client_id);
      if (e2) registrarFalha("selo: escolhido_em não gravado", e2, { selo_id: v.id });
    }
    // Gancho do documento de entrega (frente DOC): o evento da troca com o resumo e as provas.
    await auditLog({
      correlationId: crypto.randomUUID(),
      toolName: "mesa_selo_escolhido",
      origin: "mesa:agente-calendario",
      keyId: `mesa:agente-calendario:${userId || "sistema"}`,
      scopes: ["clients:write"],
      input: {
        client_id: c.client_id,
        campanha_id: c.id,
        resumo: v ? `Selo da campanha "${c.nome}": ${v.origem}${v.estilo ? ` (${v.estilo})` : ""}.` : `Selo da campanha "${c.nome}" retirado.`,
        provas: { selo_id: v ? v.id : null, caminho: v ? v.caminho : null, origem: v ? v.origem : null, texto_conferido: v && v.conferencia ? v.conferencia.ok : null, anterior },
      },
      success: true,
      statusCode: 200,
      durationMs: 0,
      resultRef: v ? v.id : c.id,
    }).catch((e) => registrarFalha("selo: evento da troca não registrado", e, { campanha_id: c.id }));
    return { campanha: data as CampanhaDoSelo, anterior };
  }

  // ---------------------------------------------------------------- impacto da troca

  async function lerImpacto(servico: SupabaseClient, c: CampanhaDoSelo, seloAtual: string | null) {
    const { data, error } = await servico
      .from("estudio_trabalhos")
      .select("id, entrega_status, aprovado_em, post_id, modelo_imagem_id, qualidade, cards, cards_da_direcao:direcao->cards, titulo:direcao->>conceito")
      .eq("client_id", c.client_id)
      .eq("direcao->>campanha_id", c.id)
      .limit(60);
    if (error) {
      registrarFalha("selo: artes da campanha não lidas", error, { campanha_id: c.id });
      return { ...impactoDaTroca([], seloAtual), erro: "Não foi possível contar as artes desta campanha agora." };
    }
    const trabalhos: TrabalhoDaCampanha[] = ((data ?? []) as Record<string, unknown>[]).map((t) => ({
      id: String(t.id),
      titulo: typeof t.titulo === "string" ? t.titulo.slice(0, 80) : null,
      entrega_status: (t.entrega_status as string | null) ?? null,
      aprovado_em: (t.aprovado_em as string | null) ?? null,
      post_id: (t.post_id as string | null) ?? null,
      modelo_imagem_id: (t.modelo_imagem_id as string | null) ?? null,
      qualidade: (t.qualidade as string | null) ?? null,
      total: Array.isArray(t.cards_da_direcao) ? t.cards_da_direcao.length : 1,
      cards: (Array.isArray(t.cards) ? t.cards : []) as TrabalhoDaCampanha["cards"],
    }));
    return { ...impactoDaTroca(trabalhos, seloAtual), erro: null as string | null };
  }

  // ---------------------------------------------------------------- direção

  async function modeloDeImagem(id: unknown): Promise<ModeloIa> {
    if (typeof id === "string" && id.trim()) {
      try {
        return await carregarModelo(id.trim(), "imagem");
      } catch (e) {
        if (e instanceof IaMotorErro) throw deps.erro(400, "modelo_invalido", "Este modelo de imagem não está ligado. Escolha outro.");
        throw e;
      }
    }
    const m = await modeloPadrao("imagem");
    if (!m) throw deps.erro(409, "sem_modelo_de_imagem", "O catálogo não tem gerador de imagem padrão.");
    return m;
  }

  async function montarContexto(
    servico: SupabaseClient,
    c: CampanhaDoSelo,
    corpo: Record<string, unknown>,
    o: { estilo: ContextoDoSelo["estilo"]; variacao?: number; texto: string; pedido?: string | null; refs: ReferenciaDoSelo[]; transparente: boolean; melhorar?: { pedido: string } | null },
  ) {
    const marca = await marcaDaCampanha(servico, c, corpo);
    const [kit, fontes, regras] = await Promise.all([
      lerKit(servico, c.client_id, marca),
      lerFontes(servico, c.client_id, marca),
      lerRegrasDoDono(servico as never, c.client_id, { areas: ["arte", "campanha", "geral"], marcaId: marca ? marca.id : null }),
    ]);
    const id = (c.identidade ?? {}) as Record<string, any>;
    const b = (c.briefing && typeof c.briefing === "object" ? c.briefing : {}) as Record<string, unknown>;
    const tipo = tipoDaCampanha(c.identidade);
    const contexto = kit && kit.contexto && typeof kit.contexto === "object" ? (kit.contexto as Record<string, unknown>) : {};
    const paleta = (Array.isArray(kit?.paleta) ? kit!.paleta as Record<string, unknown>[] : [])
      .map((p) => ({ nome: txt(p.nome, 40) || null, hex: txt(p.hex, 7), papel: txt(p.papel, 20) || null }))
      .filter((p) => /^#[0-9a-f]{6}$/i.test(p.hex))
      .slice(0, 6);
    const ctx: ContextoDoSelo = {
      texto: o.texto,
      estilo: o.estilo,
      variacao: o.variacao,
      campanha: {
        nome: c.nome,
        tipo,
        tipoRotulo: tipo ? DEFINICAO_DO_TIPO[tipo].rotulo : null,
        direcaoDoTipo: tipo ? direcaoDoSeloDoTipo(tipo).replace(/^Selo bonito e sem poluir: [^.]+\. /, "") : null,
        objetivo: c.objetivo,
        conceito: c.conceito,
        periodo_inicio: c.periodo_inicio,
        periodo_fim: c.periodo_fim,
        tema_visual: txt(id.tema_visual, 600) || null,
        elementos: txt(id.elementos, 400) || null,
        tom: txt(id.tom, 200) || txt(b.tom, 200) || null,
        tipografia: txt(id.tipografia, 200) || null,
        paleta_apoio: (Array.isArray(id.paleta_apoio) ? id.paleta_apoio : []).map((p: any) => ({ nome: txt(p?.nome, 40) || null, hex: txt(p?.hex, 7) })),
        selo_descricao: txt(id.selo?.descricao, 400) || null,
        oferta: txt(b.oferta, 300) || null,
        publico: txt(b.publico, 300) || txt(contexto.publico, 300) || null,
        mensagem_central: txt(b.mensagem_central, 300) || null,
      },
      marca: {
        nome: marca ? marca.nome : null,
        paleta,
        fontes,
        estilo: txt(kit?.estilo, 400) || null,
        tom: txt(contexto.tom_de_voz, 200) || null,
        regras: txt(kit?.regras, 400) || null,
      },
      referencias: o.refs.map((r) => ({ papel: r.papel, nota: r.nota ?? null, descricao: r.descricao ?? null })),
      evitar: regras.filter((r) => r.categoria === "evitar").map((r) => r.texto).slice(0, 8),
      preferir: regras.filter((r) => r.categoria === "preferencia").map((r) => r.texto).slice(0, 6),
      pedido: o.pedido || null,
      fundoTransparente: o.transparente,
      melhorar: o.melhorar ?? null,
    };
    const resumo = {
      marca: marca ? marca.nome : null,
      tipo: ctx.campanha.tipoRotulo,
      cores: paleta.length,
      fontes: fontes.map((f) => f.nome).slice(0, 3),
      referencias: o.refs.length,
      regras_do_dono: ctx.evitar.length + ctx.preferir.length,
      publico: !!ctx.campanha.publico,
      conceito: !!ctx.campanha.conceito,
    };
    return { ctx, resumo };
  }

  /** As referências do selo (até 4) já reduzidas. A que não abre fica de fora com aviso. */
  async function imagensDasReferencias(servico: SupabaseClient, refs: ReferenciaDoSelo[], avisos: string[]): Promise<{ usadas: ReferenciaDoSelo[]; imagens: ImagemEntrada[] }> {
    const usadas: ReferenciaDoSelo[] = [];
    const imagens: ImagemEntrada[] = [];
    for (const r of refs.slice(0, MAX_REFERENCIAS_DO_SELO)) {
      try {
        const img = await reduzida(servico, "mesa", r.caminho, 768);
        imagens.push({ ...img, nome: `referencia-${imagens.length + 1}.${img.mime.split("/")[1] || "png"}` });
        usadas.push(r);
      } catch (e) {
        avisos.push(`Uma referência do selo não abriu (${registrarFalha("selo: referência não abriu", e, { caminho: r.caminho })}) e ficou de fora.`);
      }
    }
    return { usadas, imagens };
  }

  /** Lê o texto do selo (visão barata) para conferir. Falha: null (vira aviso, nunca some calada). */
  async function lerTextoDoSelo(c: CampanhaDoSelo, png: Uint8Array, userId: string): Promise<{ lido: string | null; custo: number }> {
    try {
      const leitor = (await modeloPadrao("leitura")) ?? (await modeloPadrao("estrategista"));
      if (!leitor) return { lido: null, custo: 0 };
      const r = await chamarTexto({
        clientId: c.client_id,
        tarefa: "verificacao",
        agente: "leitor",
        modeloId: leitor.id,
        sistema: "Você lê selos (emblemas) de campanha. Transcreva TODO o texto visível no selo, exatamente como está desenhado, com a grafia, os acentos e os números que aparecem, inclusive erros. Não corrija nada. Sem travessão.",
        mensagens: [{ papel: "usuario", conteudo: "Leia o texto deste selo.", imagens: [{ bytes: png, mime: "image/png", nome: "selo.png" }] }],
        esquemaJson: { nome: "leitura_do_selo", schema: { type: "object", additionalProperties: false, required: ["texto_lido"], properties: { texto_lido: { type: "string" } } } },
        maxTokensSaida: 800,
        referencia: { tipo: REF, id: c.id },
        criadoPor: userId,
      });
      const lido = (r.json as { texto_lido?: unknown } | undefined)?.texto_lido;
      return { lido: typeof lido === "string" ? lido.slice(0, 300) : null, custo: r.custoUsd };
    } catch (e) {
      if (e instanceof IaMotorErro && e.codigo === "saldo_insuficiente") return { lido: null, custo: 0 };
      registrarFalha("selo: leitura do texto falhou", e, { campanha_id: c.id });
      return { lido: null, custo: 0 };
    }
  }

  // ---------------------------------------------------------------- gerar e melhorar

  type Desenho = { versao: VersaoDoSelo; conferencia: ConferenciaDoTexto; custo: number; saldo: number; reserva: string | null; avisos: string[]; direcao: Record<string, unknown> };

  async function desenhar(
    servico: SupabaseClient,
    c: CampanhaDoSelo,
    corpo: Record<string, unknown>,
    userId: string,
    o: { base?: VersaoDoSelo | null; pedidoDeMelhora?: string | null; refsExtras?: ReferenciaDoSelo[] },
  ): Promise<Desenho> {
    const modelo = await modeloDeImagem(corpo.modelo_id);
    const qualidade = qualidadeValida(corpo.qualidade);
    const tipo = tipoDaCampanha(c.identidade);
    const base = o.base ?? null;
    const estilo = estiloValido(corpo.estilo) ?? estiloValido(base?.estilo) ?? planoDasOpcoes("automatico", tipo, 1)[0].estilo;
    const variacao = Math.max(0, Math.min(3, Math.round(Number(corpo.variacao) || 0)));
    const texto = textoDoSelo(c, txt(corpo.texto, 60) || base?.texto || null);
    const avisos = avisosDoTexto(texto, tipo);
    const refs = referenciasDoSelo(c.selo_referencias).concat(o.refsExtras ?? []).slice(0, MAX_REFERENCIAS_DO_SELO);
    const { usadas, imagens } = await imagensDasReferencias(servico, refs, avisos);
    const transparente = aceitaFundoTransparente(modelo);
    const { ctx, resumo } = await montarContexto(servico, c, corpo, {
      estilo,
      variacao: base ? undefined : variacao,
      texto,
      pedido: txt(corpo.pedido, 400) || null,
      refs: usadas,
      transparente,
      melhorar: base && o.pedidoDeMelhora ? { pedido: o.pedidoDeMelhora } : null,
    });
    const editar = base ? { bytes: (await reduzida(servico, "mesa", base.caminho, 1024)).bytes } : undefined;
    const img = await chamarImagem({
      clientId: c.client_id,
      modeloId: modelo.id,
      prompt: direcaoDoSelo(ctx),
      referencias: imagens,
      qualidade,
      tamanho: "1024x1024",
      tamanhoFixo: true,
      ...(editar ? { editar } : {}),
      ...(transparente ? { fundo: "transparente" as const } : {}),
      referencia: { tipo: REF, id: c.id },
      criadoPor: userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    let limpo: { png: Uint8Array; transparente: boolean };
    try {
      limpo = await seloLimpo(img.png, true);
    } catch (e) {
      registrarFalha("selo: limpeza do fundo falhou (vai como veio)", e, { campanha_id: c.id });
      limpo = { png: img.png, transparente: false };
      avisos.push("O fundo do selo não foi limpo: confira antes de usar.");
    }
    if (!limpo.transparente) avisos.push(avisoDoFundo);
    const leitura = await lerTextoDoSelo(c, limpo.png, userId);
    const conferencia = conferirTextoDoSelo(texto, leitura.lido);
    if (conferencia.aviso) avisos.push(conferencia.aviso);
    const custo = arred(img.custoUsd + leitura.custo);
    const versao = await gravarVersaoDoSelo(servico, c, {
      png: limpo.png,
      origem: base ? "melhorado" : "gerado",
      estilo,
      texto,
      conferencia,
      pedido: base ? o.pedidoDeMelhora ?? null : txt(corpo.pedido, 400) || null,
      anterior_id: base ? base.id : null,
      lote_id: typeof corpo.lote_id === "string" ? corpo.lote_id : null,
      fonte: usadas.length ? { referencias: usadas.map((r) => ({ caminho: r.caminho, papel: r.papel })) } : null,
      modelo_id: modelo.id,
      custo_usd: custo,
      userId,
    });
    await deps.somarCusto(servico, c.id, c.client_id, custo);
    return { versao, conferencia, custo, saldo: img.saldoUsd, reserva: img.reservaUsada ?? null, avisos, direcao: { ...resumo, estilo, modelo: modelo.rotulo || modelo.id, transparente } };
  }

  /** Estimativa do Melhorar (o cartão do agente mostra antes do Confirmar). */
  async function estimarDesenho(corpo: Record<string, unknown>): Promise<number> {
    const modelo = await modeloDeImagem(corpo.modelo_id);
    return arred(estimarComModelo(modelo, { imagens: 1, qualidade: qualidadeValida(corpo.qualidade), tokensEntrada: 6000 }) + 0.002);
  }

  // ---------------------------------------------------------------- referências

  /** Imagem de um link público (https, só imagem, até 8 MB) guardada na pasta da campanha. */
  async function guardarLink(servico: SupabaseClient, c: CampanhaDoSelo, link: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw deps.erro(400, "link_invalido", "O link da referência não é um endereço válido.");
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || host === "localhost" || /^[\d.]+$/.test(host) || host.indexOf(":") >= 0 || host.endsWith(".local") || host.endsWith(".internal")) {
      throw deps.erro(400, "link_invalido", "Use um link https de uma imagem pública.");
    }
    let r: Response;
    try {
      r = await fetch(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw deps.erro(502, "link_indisponivel", `O link não abriu (${registrarFalha("selo: link da referência não abriu", e, { host })}).`);
    }
    const tipo = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[tipo];
    if (!r.ok || !ext) {
      await r.body?.cancel().catch(() => undefined);
      throw deps.erro(422, "link_nao_e_imagem", "O link precisa abrir direto uma imagem PNG, JPG ou WebP (não a página).");
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) throw deps.erro(413, "link_grande_demais", "A imagem do link passa de 8 MB.");
    const caminho = `${c.client_id}/campanhas/${c.id}/referencia-${Date.now()}.${ext}`;
    const { error } = await servico.storage.from("mesa").upload(caminho, new Blob([bytes], { type: tipo }), { contentType: tipo });
    if (error) throw deps.erro(503, "referencia_nao_guardada", "A imagem do link não foi guardada. Tente de novo.");
    return caminho;
  }

  /**
   * Papel de cada referência nova: o leitor descreve a imagem (visão) e o Jev
   * (Choice) decide o papel pela nota da equipe e pela descrição. Sem o Jev
   * ou com pouca confiança: só inspiração (o uso mais seguro), com aviso.
   */
  async function classificarReferencia(c: CampanhaDoSelo, img: ImagemEntrada, nota: string, pedido: string, userId: string, avisos: string[]): Promise<{ papel: ReferenciaDoSelo["papel"]; confianca: number | null; descricao: string | null; custo: number }> {
    let descricao: string | null = null;
    let custo = 0;
    try {
      const leitor = (await modeloPadrao("leitura")) ?? (await modeloPadrao("estrategista"));
      if (leitor) {
        const r = await chamarTexto({
          clientId: c.client_id,
          tarefa: "leitura_referencia",
          agente: "leitor",
          modeloId: leitor.id,
          sistema: "Descreva em até 3 frases curtas esta imagem de referência de selo: a forma (contorno), o traço e o acabamento, as cores (hex aproximado) e o texto que aparece. Sem travessão.",
          mensagens: [{ papel: "usuario", conteudo: "Descreva esta referência.", imagens: [img] }],
          esquemaJson: { nome: "descricao_da_referencia", schema: { type: "object", additionalProperties: false, required: ["descricao"], properties: { descricao: { type: "string" } } } },
          maxTokensSaida: 600,
          referencia: { tipo: REF, id: c.id },
          criadoPor: userId,
        });
        custo += r.custoUsd;
        const d = (r.json as { descricao?: unknown } | undefined)?.descricao;
        descricao = typeof d === "string" ? d.slice(0, 600) : null;
      }
    } catch (e) {
      avisos.push(`A referência não foi descrita (${registrarFalha("selo: descrição da referência falhou", e, { campanha_id: c.id })}).`);
    }
    try {
      const j = await jevPerguntar({ state: { pedido, nota, descricao: descricao || "(sem descrição)" }, questions: { papel: perguntaDoPapelDaReferencia() as unknown as PerguntaJev } });
      const cobrado = await cobrarJev(j, { clientId: c.client_id, tarefa: "calendario", referencia: { tipo: REF, id: c.id }, criadoPor: userId }).catch((e) => (registrarFalha("selo: jev não cobrado", e), null));
      if (cobrado) custo += cobrado.custoUsd;
      const p = papelPelaResposta(j.answers.papel);
      if (p.papel === "inspiracao" && (p.confianca ?? 0) < 0.5) avisos.push("Não deu para saber o que seguir numa referência: ela entra como só inspiração. Troque o papel se quiser.");
      return { papel: p.papel, confianca: p.confianca, descricao, custo };
    } catch (e) {
      avisos.push(`O papel de uma referência não foi decidido (${registrarFalha("selo: jev do papel falhou", e, { campanha_id: c.id })}): ela entra como só inspiração.`);
      return { papel: "inspiracao", confianca: null, descricao, custo };
    }
  }

  async function gravarReferencias(servico: SupabaseClient, c: CampanhaDoSelo, lista: ReferenciaDoSelo[]): Promise<CampanhaDoSelo> {
    const { data, error } = await servico.from("mesa_campanhas").update({ selo_referencias: lista }).eq("id", c.id).eq("client_id", c.client_id).select("*").single();
    if (error || !data) throw falhaDoBanco(error, "referencias_nao_salvas", "As referências do selo não foram salvas.");
    return data as CampanhaDoSelo;
  }

  /** Caminho do cliente no bucket mesa (sem ".."), ou null. */
  const caminhoDoCliente = (c: CampanhaDoSelo, v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.startsWith(`${c.client_id}/`) && s.indexOf("..") < 0 ? s : null;
  };

  // ---------------------------------------------------------------- selo pronto

  /** Onde está a logo da marca da campanha (bucket mesa ou arquivo do kit). */
  async function ondeEstaALogo(servico: SupabaseClient, clientId: string, kit: Kit | null): Promise<{ bucket: string; caminho: string } | null> {
    const noMesa = kit?.logo_path;
    if (typeof noMesa === "string" && noMesa.startsWith(`${clientId}/`) && noMesa.indexOf("..") < 0) return { bucket: "mesa", caminho: noMesa };
    const arquivo = kit?.logo_file_id;
    if (!arquivo) return null;
    const { data } = await servico.from("files").select("client_id, file_url, storage_bucket, storage_path").eq("id", arquivo).maybeSingle();
    const f = data as { client_id: string; file_url: string | null; storage_bucket: string | null; storage_path: string | null } | null;
    if (!f || f.client_id !== clientId) return null;
    if (f.storage_bucket && f.storage_path) return { bucket: f.storage_bucket, caminho: f.storage_path };
    if (f.file_url && f.file_url.startsWith("files://")) return { bucket: "files", caminho: f.file_url.slice("files://".length) };
    return null;
  }

  /** Selo pronto (sem gerador): prepara o arquivo, grava a versão e, por padrão, escolhe. Sem custo. */
  async function usarPronto(
    servico: SupabaseClient,
    c: CampanhaDoSelo,
    corpo: Record<string, unknown>,
    userId: string,
  ): Promise<{ versao: VersaoDoSelo; campanha: CampanhaDoSelo; anterior: { selo_id: string | null; selo_path: string | null } | null; avisos: string[] }> {
    const origem = String(corpo.origem || "") as OrigemDoSelo;
    if ((ORIGENS_DO_SELO as readonly string[]).indexOf(origem) < 0 || origem === "gerado" || origem === "melhorado") {
      throw deps.erro(400, "origem_invalida", "Escolha: do acervo, selo antigo, enviado ou logo da marca.");
    }
    const removerFundo = corpo.remover_fundo !== false;
    const avisos: string[] = [];
    let bucket = "mesa";
    let caminho = "";
    let fonte: Record<string, unknown> = { tipo: origem };
    let nome = "";
    if (origem === "arquivo") {
      // Selo antigo de outra campanha do mesmo cliente: o mesmo arquivo, sem copiar.
      const v = await lerVersao(servico, c, corpo.selo_id);
      const nova = await gravarVersaoDoSelo(servico, c, { png: new Uint8Array(), origem, caminho: v.caminho, texto: v.texto, estilo: v.estilo, fonte: { tipo: "selo", id: v.id, campanha_id: v.campanha_id }, userId });
      if (corpo.escolher === false) return { versao: nova, campanha: c, anterior: null, avisos };
      const e = await escolherSelo(servico, c, nova, userId);
      return { versao: nova, campanha: e.campanha, anterior: e.anterior, avisos };
    }
    if (origem === "acervo") {
      const id = String(corpo.imagem_id ?? "");
      if (!UUID.test(id)) throw deps.erro(400, "imagem_invalida", "Escolha uma imagem do acervo.");
      const { data } = await servico.from("cliente_imagens").select("id, client_id, storage_bucket, storage_path, nome, ativa, tags").eq("id", id).eq("client_id", c.client_id).maybeSingle();
      const img = data as { id: string; storage_bucket: string | null; storage_path: string; nome: string; ativa: boolean } | null;
      if (!img || !img.ativa) throw deps.erro(404, "imagem_inexistente", "Esta imagem não está no acervo do cliente.");
      bucket = img.storage_bucket || "mesa";
      caminho = img.storage_path;
      nome = img.nome;
      fonte = { tipo: "cliente_imagens", id: img.id, nome: img.nome };
    } else if (origem === "enviado") {
      const c2 = caminhoDoCliente(c, corpo.caminho);
      if (!c2) throw deps.erro(400, "arquivo_invalido", "O arquivo enviado não é deste cliente.");
      caminho = c2;
      nome = txt(corpo.nome, 120) || c2.split("/").pop() || "enviado";
      fonte = { tipo: "envio", nome };
    } else if (origem === "logo") {
      const marca = await marcaDaCampanha(servico, c, corpo);
      const kit = await lerKit(servico, c.client_id, marca);
      const onde = await ondeEstaALogo(servico, c.client_id, kit);
      if (!onde) throw deps.erro(409, "marca_sem_logo", `${marca ? `A marca ${marca.nome}` : "O cliente"} não tem logo no kit. Cadastre a logo no Contexto (Kit da marca).`);
      bucket = onde.bucket;
      caminho = onde.caminho;
      nome = "logo";
      fonte = { tipo: "marca", marca_id: marca ? marca.id : null, marca: marca ? marca.nome : null };
    }
    const bruta = await reduzida(servico, bucket, caminho, LADO_DO_SELO);
    const limpo = await seloLimpo(bruta.bytes, removerFundo);
    if (!limpo.transparente) avisos.push(avisoDoFundo);
    const versao = await gravarVersaoDoSelo(servico, c, { png: limpo.png, origem, texto: null, fonte: { ...fonte, fundo_tirado: removerFundo }, userId });
    if (corpo.escolher === false) return { versao, campanha: c, anterior: null, avisos };
    const e = await escolherSelo(servico, c, versao, userId);
    return { versao, campanha: e.campanha, anterior: e.anterior, avisos };
  }

  // ---------------------------------------------------------------- ações

  async function seloEstado(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const [versoes, impacto, antigos] = await Promise.all([
      lerVersoes(servico, c),
      lerImpacto(servico, c, c.selo_path),
      // Selos de outras campanhas do cliente (escolher pronto: "selos antigos").
      servico.from("mesa_campanha_selos").select("id, campanha_id, caminho, origem, texto, criado_em").eq("client_id", c.client_id).neq("campanha_id", c.id).is("arquivado_em", null).not("escolhido_em", "is", null).order("criado_em", { ascending: false }).limit(24),
    ]);
    const tipo = tipoDaCampanha(c.identidade);
    const texto = textoDoSelo(c);
    return deps.json({
      campanha: { id: c.id, selo_id: c.selo_id ?? null, selo_path: c.selo_path },
      versoes,
      antigos: antigos.error ? [] : antigos.data ?? [],
      referencias: referenciasDoSelo(c.selo_referencias),
      texto,
      avisos_do_texto: avisosDoTexto(texto, tipo),
      impacto,
      custo_usd: 0,
    });
  }

  async function seloGerar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const d = await desenhar(servico, c, corpo, ch.userId, {});
    return deps.json({ versao: d.versao, conferencia: d.conferencia, avisos: d.avisos, direcao: d.direcao, custo_usd: d.custo, saldo_usd: d.saldo, reserva_usada: d.reserva });
  }

  async function seloMelhorar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const pedido = txt(corpo.pedido, 600);
    if (!pedido) throw deps.erro(400, "pedido_vazio", "Escreva o que melhorar no selo.");
    const base = await lerVersao(servico, c, corpo.selo_id ?? c.selo_id);
    const extras: ReferenciaDoSelo[] = [];
    const caminhos = (Array.isArray(corpo.referencias) ? corpo.referencias : []).map((x) => caminhoDoCliente(c, x)).filter((x): x is string => !!x).slice(0, 3);
    if (typeof corpo.link === "string" && corpo.link.trim()) caminhos.push(await guardarLink(servico, c, corpo.link.trim()));
    // A referência do Melhorar vale pelo que o pedido diz dela: vai como estilo (o papel mais pedido).
    for (const caminho of caminhos) extras.push({ caminho, papel: "estilo", nota: pedido.slice(0, 200) });
    const d = await desenhar(servico, c, corpo, ch.userId, { base, pedidoDeMelhora: pedido, refsExtras: extras });
    return deps.json({ versao: d.versao, anterior: base, conferencia: d.conferencia, avisos: d.avisos, direcao: d.direcao, custo_usd: d.custo, saldo_usd: d.saldo, reserva_usada: d.reserva });
  }

  async function seloEscolher(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const v = corpo.selo_id === null ? null : await lerVersao(servico, c, corpo.selo_id);
    // Selo de outra campanha entra como "Selo antigo" (selo_usar, origem arquivo), com versão própria aqui.
    if (v && v.campanha_id !== c.id) throw deps.erro(409, "selo_de_outra_campanha", "Este selo é de outra campanha: use Escolher pronto, Selos antigos.");
    const e = await escolherSelo(servico, c, v, ch.userId);
    const impacto = await lerImpacto(servico, c, e.campanha.selo_path);
    return deps.json({ campanha: e.campanha, anterior: e.anterior, impacto, custo_usd: 0 });
  }

  async function seloUsar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const r = await usarPronto(servico, c, corpo, ch.userId);
    const impacto = r.anterior ? await lerImpacto(servico, c, r.campanha.selo_path) : null;
    return deps.json({ campanha: r.campanha, versao: r.versao, anterior: r.anterior, avisos: r.avisos, impacto, custo_usd: 0 });
  }

  async function seloReferencias(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    let c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const avisos: string[] = [];
    const tirar = new Set((Array.isArray(corpo.tirar) ? corpo.tirar : []).map((x) => String(x)));
    let lista = referenciasDoSelo(c.selo_referencias).filter((r) => !tirar.has(r.caminho));
    // Troca de papel na tela (sem custo).
    const trocas = Array.isArray(corpo.papeis) ? (corpo.papeis as Record<string, unknown>[]) : [];
    for (const t of trocas) {
      const alvo = lista.find((r) => r.caminho === t.caminho);
      const papel = typeof t.papel === "string" ? referenciasDoSelo([{ caminho: "x", papel: t.papel }])[0].papel : null;
      if (alvo && papel) {
        alvo.papel = papel;
        alvo.confianca = null;
      }
    }
    let custo = 0;
    const novas = (Array.isArray(corpo.adicionar) ? corpo.adicionar : []).slice(0, MAX_REFERENCIAS_DO_SELO) as Record<string, unknown>[];
    const pedido = txt(corpo.pedido, 400);
    for (const n of novas) {
      if (lista.length >= MAX_REFERENCIAS_DO_SELO) {
        avisos.push(`O selo aceita até ${MAX_REFERENCIAS_DO_SELO} referências: as demais ficaram de fora.`);
        break;
      }
      const caminho = typeof n.link === "string" && n.link.trim() ? await guardarLink(servico, c, n.link.trim()) : caminhoDoCliente(c, n.caminho);
      if (!caminho || lista.some((r) => r.caminho === caminho)) continue;
      const img = await reduzida(servico, "mesa", caminho, 768);
      const nota = txt(n.nota, 300);
      const k = await classificarReferencia(c, img, nota, pedido, ch.userId, avisos);
      custo += k.custo;
      lista = lista.concat([{ caminho, papel: k.papel, confianca: k.confianca, nota: nota || null, descricao: k.descricao }]);
    }
    c = await gravarReferencias(servico, c, lista);
    if (custo > 0) await deps.somarCusto(servico, c.id, c.client_id, arred(custo));
    return deps.json({ campanha: { id: c.id, selo_referencias: c.selo_referencias }, referencias: referenciasDoSelo(c.selo_referencias), avisos, custo_usd: arred(custo) });
  }

  async function seloArquivar(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const v = await lerVersao(servico, c, corpo.selo_id);
    if (v.id === c.selo_id) throw deps.erro(409, "selo_em_uso", "Este é o selo da campanha. Escolha outro antes de arquivar.");
    const volta = corpo.desfazer === true;
    const { error } = await servico.from("mesa_campanha_selos").update({ arquivado_em: volta ? null : new Date().toISOString() }).eq("id", v.id).eq("client_id", c.client_id);
    if (error) throw falhaDoBanco(error, "selo_nao_arquivado", "Não foi possível arquivar o selo.");
    return deps.json({ selo_id: v.id, arquivado: !volta, custo_usd: 0 });
  }

  /** Contrato antigo (campanha_selo): uma opção gerada e já escolhida. */
  async function campanhaSeloAntigo(servico: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) {
    const c = await campanhaComAcesso(servico, ch, corpo.campanha_id);
    const d = await desenhar(servico, c, corpo, ch.userId, {});
    const e = await escolherSelo(servico, c, d.versao, ch.userId);
    return deps.json({ campanha: e.campanha, selo_path: d.versao.caminho, versao: d.versao, avisos: d.avisos, custo_usd: d.custo, saldo_usd: d.saldo });
  }

  // ---------------------------------------------------------------- agente da campanha

  /**
   * O que a mensagem pede sobre o selo (Choice do Jev), só quando o filtro
   * barato achou "selo"/"logo". Falha do Jev: nenhuma (o estrategista segue).
   */
  async function intencaoDoSelo(c: CampanhaDoSelo, mensagem: string, anexos: number, userId: string): Promise<IntencaoDoSelo> {
    try {
      const j = await jevPerguntar({ state: { mensagem, imagens_anexadas: anexos, tem_selo: !!c.selo_path }, questions: { selo: perguntaDoPedidoDoSelo() as unknown as PerguntaJev } });
      await cobrarJev(j, { clientId: c.client_id, tarefa: "calendario", referencia: { tipo: REF, id: c.id }, criadoPor: userId }).catch((e) => registrarFalha("selo: jev da intenção não cobrado", e));
      return intencaoPelaResposta(j.answers.selo, anexos);
    } catch (e) {
      registrarFalha("selo: jev da intenção falhou (segue o estrategista)", e, { campanha_id: c.id });
      return "nenhuma";
    }
  }

  return {
    acoes: {
      selo_estado: seloEstado,
      selo_gerar: seloGerar,
      selo_melhorar: seloMelhorar,
      selo_escolher: seloEscolher,
      selo_usar: seloUsar,
      selo_referencias: seloReferencias,
      selo_arquivar: seloArquivar,
      campanha_selo: campanhaSeloAntigo,
    } as Record<string, (s: SupabaseClient, ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    longas: ["selo_gerar", "selo_melhorar", "selo_referencias", "selo_usar", "campanha_selo"],
    // Para o agente da campanha (index.ts: campanhaConversar, executar e desfazer).
    intencaoDoSelo,
    usarPronto,
    desenhar,
    estimarDesenho,
    escolherSelo,
    lerVersao,
  };
}
