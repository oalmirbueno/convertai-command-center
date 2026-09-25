/**
 * Mesa Foto, área "Modelos": personas sintéticas hiper-realistas
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 4, 5 e 8.2). As regras puras
 * ficam em personas.ts; aqui ficam banco, armazenamento e IA.
 *
 * Ações (POST { acao, ... } na função mesa-foto):
 * - modelo_sugerir { client_id, pedido?, campanha_id? } -> { sugestao: { nome, ficha, invariantes, porque }, avisos, campanha_mesa }
 *     (texto, 300 s; preenche a ficha pelo contexto do cliente que a Mesa usa; não grava)
 * - modelos_listar { client_id, incluir_arquivadas? } -> { modelos }
 * - modelo_ler { modelo_id } -> { modelo, imagens, folha, custo_usd_total, rodada_padrao }
 * - modelo_criar { client_id, nome, ficha, descricao?, invariantes?, referencias?|referencias_ids?, uso_referencias?, escopo, etica_confirmada: true }
 *     -> { modelo, rodada_padrao, estimativa_rodada_usd }
 * - modelo_editar { modelo_id, nome?, ficha?, descricao?, invariantes?, referencias?, escopo?, client_id?, arquivar? } -> { modelo, avisos }
 * - motores_imagem {} -> { motores } (geradores ativos com capacidades e preço por resolução)
 * - modelo_candidata_gerar { modelo_id, modelo_imagem_id, qualidade?, resolucao?, seed?, rodada_id?, pedido?, client_id? }
 *     -> { imagem, url, modelo, custo_usd, saldo_usd, reserva_usada, avisos } (UMA candidata por chamada)
 * - modelo_ancora_escolher { modelo_id, imagem_id } -> { modelo, imagem, folha }
 * - modelo_vista_gerar { modelo_id, vista, qualidade?, resolucao?, seed?, client_id? } -> { imagem, url, modelo, folha, custo_usd, ... }
 * - modelo_imagem_decidir { imagem_id, decisao: 'aprovar'|'rejeitar', motivo? } -> { imagem, modelo, folha }
 * - modelo_detalhar { modelo_id?, imagem_id, alvo: 'pessoa'|'produto', modelo_imagem_id?, client_id? }
 *     -> { imagem, url, antes, depois, origem, custo_usd, ... } (geração nova em 4K, derivada; nunca sobrescreve)
 * - modelo_conferir { modelo_id, imagem_id } -> { imagem_id, conferencia, custo_usd, saldo_usd } (visão descreve; Jev só aviso)
 *
 * Quem paga: persona do cliente paga na carteira do cliente; persona da
 * agência paga na carteira do client_id da chamada (com acesso) ou, sem ele,
 * na do cliente onde ela nasceu (client_origem_id).
 */

import {
  aceitaResolucao,
  capacidadesDoModelo,
  carregarModelo,
  chamarImagem,
  chamarTexto,
  cobrarJev,
  estimarComModelo,
  IaMotorErro,
  type ImagemEntrada,
  lerResolucao,
  limiteDeReferencias,
  type ModeloIa,
  precoPorImagem,
  type Qualidade,
  type Resolucao,
  type SaidaImagem,
} from "../_shared/ia-motor.ts";
import { resolucaoParaModelo } from "../_shared/capacidades-imagem.ts";
import { JevErro, jevPerguntar, notaScore, probabilidadeNoul } from "../_shared/jev.ts";
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, limpo, limpoOuNulo, mimeDe, nomeSeguro, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa, ImagemDoAcervoLida } from "./ferramentas.ts";
import {
  type AlvoDoDetalhe,
  alertasDoRealismo,
  candidatosAo4K,
  fichaSugerida,
  DESCRICAO_DA_VISTA,
  type FichaDaPersona,
  garantirPermitido,
  identidadesDaVista,
  idsValidos,
  invariantesDaFicha,
  lerAlvoDoDetalhe,
  lerEscopo,
  lerSemente,
  lerUsoDeReferencia,
  lerVista,
  NIVEIS_ANATOMIA,
  NIVEIS_LUZ,
  NIVEIS_PELE,
  normalizarFicha,
  normalizarLeituraDaPersona,
  normalizarNomeDaPersona,
  type NotasDoJev,
  padraoDoMotor,
  personaUsavel,
  promptDaCandidata,
  promptDaVista,
  promptDoDetalhe,
  resumoDaFolha,
  RODADA_PADRAO,
  statusDaPersona,
  type UsoDeReferencia,
  VISTAS_DA_PERSONA,
} from "./personas.ts";

export const REF_MODELO = "foto_modelo";
/** referencia_tipo de ia_usos da sugestão pelo brief (o id é o do cliente: a persona ainda não existe). */
const REF_SUGESTAO = "foto_modelo_sugestao";
const TAMANHO_DA_PERSONA = "1088x1360";
const LADO_REFERENCIA = 1280;
const LADO_ORIGEM_DETALHE = 2048;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];

export type LinhaPersona = {
  id: string;
  client_id: string | null;
  client_origem_id: string | null;
  nome: string;
  descricao: string | null;
  ficha: FichaDaPersona;
  invariantes: string[];
  referencias: { imagem_id: string; client_id: string; uso: UsoDeReferencia }[];
  status: string;
  ancora_imagem_id: string | null;
  motor_preferido_id: string | null;
  versao: number;
  etica: Record<string, unknown>;
  /** 'sintetica' ou 'clone_de_foto_real' (migration 04; sem a coluna, é sintética). */
  origem?: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Clone de pessoa real (aba Clones, clones.ts): as ações de persona sintética não servem para ele. */
const ORIGEM_CLONE = "clone_de_foto_real";
function recusarClone(p: LinhaPersona) {
  if (p.origem === ORIGEM_CLONE) {
    throw new ErroDeRegra(409, "e_um_clone", "Este é um clone de pessoa real: gere a folha e as variações na aba Clones (o texto de persona sintética não vale para ele).");
  }
}

export type LinhaImagemPersona = {
  id: string;
  modelo_id: string;
  rodada_id: string | null;
  papel: "candidata" | "vista" | "detalhe";
  vista: string | null;
  storage_bucket: string;
  storage_path: string;
  mime: string | null;
  largura: number | null;
  altura: number | null;
  sha256: string | null;
  motor_id: string | null;
  qualidade: string | null;
  resolucao: string | null;
  seed: number | null;
  prompt: string | null;
  fontes: unknown[];
  derivada_de: string | null;
  alvo: string | null;
  conferencia: Record<string, unknown> | null;
  aprovada: boolean | null;
  motivo: string | null;
  versao_modelo: number;
  gerada: boolean;
  custo_usd: number | string;
  uso_id: string | null;
  reserva_usada: string | null;
  avisos: string[] | null;
  criado_por: string | null;
  criado_em: string;
};

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDeRegra(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
const idOuNulo = (v: unknown): string | null => (UUID.test(String(v ?? "").trim()) ? String(v).trim() : null);
const lerQualidade = (v: unknown, padrao: Qualidade): Qualidade => (QUALIDADES.includes(v as Qualidade) ? (v as Qualidade) : padrao);

/** Estimativa de UMA imagem num gerador (resolução ajustada ao que ele aceita). */
export function estimativaDeUmaImagem(m: ModeloIa, qualidade: Qualidade, resolucao: Resolucao | null, referencias: number, caracteresDoPrompt = 3500): number {
  const enviadas = Math.min(referencias, limiteDeReferencias(m));
  const r = resolucaoParaModelo(capacidadesDoModelo(m), resolucao).resolucao;
  return estimarComModelo(m, {
    imagens: 1,
    qualidade,
    tokensEntrada: Math.ceil(caracteresDoPrompt / 3.5) + enviadas * 1_600,
    resolucao: r,
    imagensEntrada: enviadas,
    tamanho: TAMANHO_DA_PERSONA,
  });
}

export function acoesDeModelos(f: FerramentasDaMesa) {
  const db = () => f.servico();

  // ---------------------------------------------------------------- leituras

  async function lerPersona(id: string): Promise<LinhaPersona> {
    const { data, error } = await db().from("foto_modelos").select("*").eq("id", id).maybeSingle();
    if (error) throw new ErroDeRegra(503, "modelos_indisponivel", "Não foi possível ler a persona (a migration 03 foi aplicada?).");
    if (!data) throw new ErroDeRegra(404, "modelo_inexistente", "Persona não encontrada.");
    const p = data as LinhaPersona;
    p.invariantes = p.invariantes ?? [];
    p.referencias = Array.isArray(p.referencias) ? p.referencias : [];
    return p;
  }

  /** Persona do cliente: só quem acessa o cliente. Persona da agência: toda a equipe. */
  async function personaComAcesso(ch: Chamador, id: string): Promise<LinhaPersona> {
    const p = await lerPersona(id);
    if (p.client_id) await f.garantirAcesso(ch, p.client_id);
    return p;
  }

  /** Carteira que paga a chamada. */
  async function clienteQuePaga(ch: Chamador, p: LinhaPersona, pedido: unknown): Promise<string> {
    const doPedido = idOuNulo(pedido);
    if (p.client_id && doPedido && doPedido !== p.client_id) {
      throw new ErroDeRegra(409, "persona_de_outro_cliente", "Esta persona é de outro cliente.");
    }
    const alvo = p.client_id ?? doPedido ?? p.client_origem_id;
    if (!alvo) throw new ErroDeRegra(400, "client_id_obrigatorio", "Persona da agência: diga em qual cliente cobrar (client_id).");
    await f.garantirAcesso(ch, alvo);
    return alvo;
  }

  async function imagensDaPersona(modeloId: string): Promise<LinhaImagemPersona[]> {
    const { data, error } = await db().from("foto_modelo_imagens").select("*").eq("modelo_id", modeloId).order("criado_em", { ascending: true }).limit(500);
    if (error) throw new ErroDeRegra(503, "modelos_indisponivel", "Não foi possível ler as imagens da persona.");
    return (data as LinhaImagemPersona[] | null) ?? [];
  }

  async function imagemDaPersona(modeloId: string, imagemId: string): Promise<LinhaImagemPersona> {
    const { data, error } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).eq("modelo_id", modeloId).maybeSingle();
    if (error) throw new ErroDeRegra(503, "modelos_indisponivel", "Não foi possível ler a imagem da persona.");
    if (!data) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é desta persona.");
    return data as LinhaImagemPersona;
  }

  const comUrl = async (i: LinhaImagemPersona) => ({ ...i, url: await f.urlAssinada(i.storage_bucket, i.storage_path) });

  const caminhoDaPersona = (p: LinhaPersona, arquivo: string) =>
    p.client_id ? `${p.client_id}/foto/modelos/${p.id}/${arquivo}` : `agencia/modelos/${p.id}/${arquivo}`;

  /** Recalcula o status pelo que existe e grava quando mudou. */
  async function atualizarStatus(p: LinhaPersona, imagens?: LinhaImagemPersona[]): Promise<LinhaPersona> {
    const lista = imagens ?? (await imagensDaPersona(p.id));
    const novo = statusDaPersona(p, lista);
    if (novo === p.status) return p;
    const { data } = await db().from("foto_modelos").update({ status: novo }).eq("id", p.id).select("*").maybeSingle();
    return (data as LinhaPersona | null) ?? { ...p, status: novo };
  }

  /** Referências do dono (estilo, pose, luz, roupa), baixadas do acervo do cliente de cada uma. */
  async function referenciasDoDono(p: LinhaPersona, limite: number): Promise<{ imagens: ImagemEntrada[]; usos: UsoDeReferencia[]; ids: string[] }> {
    const lista = p.referencias.slice(0, Math.max(0, limite));
    const porCliente = new Map<string, string[]>();
    for (const r of lista) porCliente.set(r.client_id, [...(porCliente.get(r.client_id) ?? []), r.imagem_id]);
    const achadas: ImagemDoAcervoLida[] = [];
    for (const [cliente, ids] of porCliente) achadas.push(...(await f.lerImagens(cliente, ids)));
    const validas = lista.filter((r) => achadas.some((a) => a.id === r.imagem_id));
    const imagens = await f.emParalelo(validas, 3, (r) => {
      const a = achadas.find((x) => x.id === r.imagem_id)!;
      return f.baixarReduzida(a.storage_bucket, a.storage_path, 1024, `referencia-${r.uso}-${a.nome}`);
    });
    return { imagens, usos: validas.map((r) => r.uso), ids: validas.map((r) => r.imagem_id) };
  }

  /** Referências da tela: [{ imagem_id, uso }] ou referencias_ids com um uso só; todas do acervo do cliente. */
  async function lerReferenciasDoPedido(clientId: string, corpo: Record<string, unknown>): Promise<LinhaPersona["referencias"]> {
    const pares: { imagem_id: string; uso: UsoDeReferencia }[] = Array.isArray(corpo.referencias)
      ? (corpo.referencias as unknown[]).map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}))
        .filter((x) => UUID.test(String(x.imagem_id ?? "")))
        .map((x) => ({ imagem_id: String(x.imagem_id), uso: lerUsoDeReferencia(x.uso) }))
      : idsValidos(corpo.referencias_ids, 6).map((id) => ({ imagem_id: id, uso: lerUsoDeReferencia(corpo.uso_referencias) }));
    const unicos = pares.filter((p, i) => pares.findIndex((q) => q.imagem_id === p.imagem_id) === i).slice(0, 6);
    if (!unicos.length) return [];
    const achadas = await f.lerImagens(clientId, unicos.map((p) => p.imagem_id));
    const faltando = unicos.filter((p) => !achadas.some((a) => a.id === p.imagem_id)).map((p) => p.imagem_id);
    if (faltando.length) throw new ErroDeRegra(404, "imagem_fora_do_cliente", "Há referência que não está no acervo deste cliente.", { imagem_ids: faltando });
    return unicos.map((p) => ({ imagem_id: p.imagem_id, client_id: clientId, uso: p.uso }));
  }

  /** Geradores da rodada lado a lado com disponibilidade, capacidades e estimativa por gerador. */
  async function rodadaPadrao(referencias: number) {
    return await Promise.all(RODADA_PADRAO.map(async (r) => {
      try {
        const m = await carregarModelo(r.modelo_imagem_id, "imagem");
        const caps = capacidadesDoModelo(m);
        const ajuste = resolucaoParaModelo(caps, r.resolucao);
        return {
          ...r,
          rotulo: m.rotulo || r.rotulo,
          disponivel: true,
          ligado: r.padrao,
          resolucao: ajuste.resolucao,
          refs_max: caps.refs_max ?? null,
          resolucoes: caps.resolucoes ?? [],
          estimativa_usd: estimativaDeUmaImagem(m, r.qualidade, r.resolucao, referencias),
          motivo: null as string | null,
        };
      } catch (e) {
        return { ...r, disponivel: false, ligado: false, refs_max: null, resolucoes: [] as string[], estimativa_usd: 0, motivo: e instanceof IaMotorErro ? e.codigo : "indisponivel" };
      }
    }));
  }

  /** Gera UMA imagem da persona, grava os bytes como vieram e a linha em foto_modelo_imagens. */
  async function gerarImagemDaPersona(d: {
    ch: Chamador;
    p: LinhaPersona;
    pagador: string;
    m: ModeloIa;
    qualidade: Qualidade;
    resolucao: Resolucao | null;
    seed: number | null;
    prompt: string;
    referencias: ImagemEntrada[];
    fontes: { tipo: string; id: string }[];
    papel: "candidata" | "vista" | "detalhe";
    vista?: string | null;
    derivadaDe?: string | null;
    alvo?: AlvoDoDetalhe | null;
    rodadaId?: string | null;
  }): Promise<{ linha: LinhaImagemPersona; saida: SaidaImagem }> {
    const saida = await chamarImagem({
      clientId: d.pagador,
      modeloId: d.m.id,
      prompt: d.prompt,
      referencias: d.referencias,
      qualidade: d.qualidade,
      tamanho: TAMANHO_DA_PERSONA,
      resolucao: d.resolucao,
      seed: d.seed,
      referencia: { tipo: REF_MODELO, id: d.p.id },
      criadoPor: d.ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    // Bytes como o provedor mandou (procedência preservada; 4K não é re-codificado aqui).
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const sha = await sha256Hex(saida.png);
    const arquivo = `${d.papel}${d.vista ? `-${d.vista}` : ""}-${nomeSeguro(saida.modeloId.split("/").pop() ?? "motor")}-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(mime)}`;
    const caminho = caminhoDaPersona(d.p, arquivo);
    await f.salvarNoMesa(caminho, saida.png, mime);
    const { data, error } = await db().from("foto_modelo_imagens").insert({
      modelo_id: d.p.id,
      rodada_id: d.rodadaId ?? null,
      papel: d.papel,
      vista: d.vista ?? null,
      storage_bucket: "mesa",
      storage_path: caminho,
      mime,
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      sha256: sha,
      motor_id: saida.modeloId,
      qualidade: d.qualidade,
      resolucao: saida.resolucao ?? null,
      seed: d.seed,
      prompt: d.prompt,
      fontes: d.fontes,
      derivada_de: d.derivadaDe ?? null,
      alvo: d.alvo ?? null,
      conferencia: null,
      aprovada: null,
      versao_modelo: d.p.versao,
      gerada: true,
      custo_usd: arred6(saida.custoUsd),
      uso_id: saida.usoId || null,
      reserva_usada: saida.reservaUsada ?? null,
      avisos: saida.avisos ?? [],
      criado_por: d.ch.userId,
    }).select("*").single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw new ErroDeRegra(503, "gravacao_falhou", "A imagem foi gerada e cobrada, mas não foi possível registrá-la. Avise o admin.", { uso_id: saida.usoId, custo_usd: saida.custoUsd });
    }
    return { linha: data as LinhaImagemPersona, saida };
  }

  const respostaDaGeracao = (saida: SaidaImagem) => ({
    custo_usd: saida.custoUsd,
    saldo_usd: saida.saldoUsd,
    reserva_usada: saida.reservaUsada ?? null,
    avisos: saida.avisos ?? [],
  });

  // ---------------------------------------------------------------- ações

  async function modelosListar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    let q = db().from("foto_modelos").select("*").or(`client_id.eq.${clientId},client_id.is.null`).order("atualizado_em", { ascending: false }).limit(200);
    if (corpo.incluir_arquivadas !== true) q = q.neq("status", "arquivada");
    const { data, error } = await q;
    if (error) throw new ErroDeRegra(503, "modelos_indisponivel", "Não foi possível ler as personas (a migration 03 foi aplicada?).");
    // Clones de pessoa real têm aba própria (Clones): a galeria de Modelos é só de personas sintéticas.
    const lista = ((data as LinhaPersona[] | null) ?? []).filter((p) => p.origem !== ORIGEM_CLONE);
    const ancoras = lista.map((p) => p.ancora_imagem_id).filter((x): x is string => !!x);
    const { data: imgs } = ancoras.length ? await db().from("foto_modelo_imagens").select("*").in("id", ancoras) : { data: [] };
    const porId = new Map(((imgs as LinhaImagemPersona[] | null) ?? []).map((i) => [i.id, i]));
    const modelos = await f.emParalelo(lista, 6, async (p) => {
      const a = p.ancora_imagem_id ? porId.get(p.ancora_imagem_id) : null;
      return { ...p, escopo: p.client_id ? "cliente" : "agencia", ancora_url: a ? await f.urlAssinada(a.storage_bucket, a.storage_path) : null, usavel_no_canvas: personaUsavel(p.status).ok };
    });
    return f.json({ modelos, custo_usd: 0 });
  }

  async function modeloLer(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const imagens = await imagensDaPersona(p.id);
    const custo = imagens.reduce((s, i) => s + Number(i.custo_usd || 0), 0);
    return f.json({
      modelo: { ...p, escopo: p.client_id ? "cliente" : "agencia" },
      imagens: await f.emParalelo(imagens, 6, comUrl),
      folha: resumoDaFolha(imagens),
      custo_usd_total: arred6(custo),
      rodada_padrao: await rodadaPadrao(p.referencias.length),
      custo_usd: 0,
    });
  }

  /** Biblioteca da agência (persona sem cliente): só admin cria, move ou edita. A tela já escondia; o servidor agora recusa. */
  async function garantirAdminDaAgencia(ch: Chamador) {
    const { data, error } = await db().rpc("has_role", { _user_id: ch.userId, _role: "admin" });
    if (error) throw new ErroDeRegra(503, "autorizacao_indisponivel", "Não foi possível conferir a permissão agora.");
    if (data !== true) throw new ErroDeRegra(403, "somente_admin", "Só admin mexe nas personas da biblioteca da agência.");
  }

  async function modeloCriar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    if (corpo.etica_confirmada !== true) {
      throw new ErroDeRegra(400, "etica_obrigatoria", "Confirme que a persona é sintética, adulta e sem semelhança com pessoa real (etica_confirmada: true).");
    }
    const nome = normalizarNomeDaPersona(corpo.nome);
    const descricao = limpoOuNulo(corpo.descricao, 1500);
    garantirPermitido(descricao ?? "");
    const ficha = normalizarFicha(corpo.ficha, descricao);
    const invariantes = invariantesDaFicha(ficha, corpo.invariantes);
    const escopo = lerEscopo(corpo.escopo);
    if (escopo === "agencia") await garantirAdminDaAgencia(ch);
    const referencias = await lerReferenciasDoPedido(clientId, corpo);
    const { data, error } = await db().from("foto_modelos").insert({
      client_id: escopo === "agencia" ? null : clientId,
      client_origem_id: clientId,
      nome,
      descricao,
      ficha,
      invariantes,
      referencias,
      status: "rascunho",
      versao: 1,
      etica: { sintetica: true, adulta: true, sem_semelhanca: true, marcado_por: ch.userId, marcado_em: new Date().toISOString() },
      criado_por: ch.userId,
    }).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível criar a persona (a migration 03 foi aplicada?).");
    const rodada = await rodadaPadrao(referencias.length);
    return f.json({
      modelo: { ...(data as LinhaPersona), escopo },
      rodada_padrao: rodada,
      estimativa_rodada_usd: arred6(rodada.filter((r) => r.ligado).reduce((s, r) => s + r.estimativa_usd, 0)),
      custo_usd: 0,
    });
  }

  async function modeloEditar(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    recusarClone(p);
    if (!p.client_id || corpo.escopo === "agencia") await garantirAdminDaAgencia(ch);
    const patch: Record<string, unknown> = {};
    const avisos: string[] = [];
    if (corpo.nome !== undefined) patch.nome = normalizarNomeDaPersona(corpo.nome);
    if (corpo.descricao !== undefined) {
      patch.descricao = limpoOuNulo(corpo.descricao, 1500);
      garantirPermitido(String(patch.descricao ?? ""));
    }
    if (corpo.ficha !== undefined || corpo.invariantes !== undefined) {
      const ficha = corpo.ficha !== undefined ? normalizarFicha(corpo.ficha, patch.descricao ?? p.descricao) : p.ficha;
      patch.ficha = ficha;
      patch.invariantes = invariantesDaFicha(ficha, corpo.invariantes !== undefined ? corpo.invariantes : p.invariantes);
      if (p.ancora_imagem_id) {
        patch.versao = p.versao + 1;
        avisos.push("A ficha mudou depois da âncora: as próximas imagens seguem a ficha nova; confira se a âncora ainda representa a persona.");
      }
    }
    const clienteDasReferencias = p.client_id ?? p.client_origem_id;
    if (corpo.referencias !== undefined || corpo.referencias_ids !== undefined) {
      if (!clienteDasReferencias) throw new ErroDeRegra(409, "sem_cliente_de_referencia", "Esta persona não tem cliente para buscar referências.");
      patch.referencias = await lerReferenciasDoPedido(clienteDasReferencias, corpo);
    }
    if (corpo.escopo === "agencia" && p.client_id) {
      patch.client_id = null;
      avisos.push("Persona salva na biblioteca da agência: qualquer cliente pode usar.");
    }
    if (corpo.escopo === "cliente" && !p.client_id) {
      const cliente = idDe(corpo.client_id, "client_id");
      await f.garantirAcesso(ch, cliente);
      patch.client_id = cliente;
    }
    if (corpo.arquivar === true) patch.status = "arquivada";
    if (corpo.arquivar === false && p.status === "arquivada") patch.status = statusDaPersona({ ...p, status: "rascunho" }, await imagensDaPersona(p.id));
    if (!Object.keys(patch).length) return f.json({ modelo: p, avisos, custo_usd: 0 });
    const { data, error } = await db().from("foto_modelos").update(patch).eq("id", p.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar a persona.");
    const nova = data as LinhaPersona;
    return f.json({ modelo: { ...nova, escopo: nova.client_id ? "cliente" : "agencia" }, avisos, custo_usd: 0 });
  }

  async function motoresImagem(_ch: Chamador, _corpo: Record<string, unknown>) {
    const { data, error } = await db().from("ia_modelos").select("*").eq("tipo", "imagem").eq("ativo", true).neq("disponivel", false).order("rotulo");
    if (error) throw new ErroDeRegra(503, "catalogo_indisponivel", "Não foi possível ler o catálogo de modelos.");
    const motores = ((data as ModeloIa[] | null) ?? []).map((m) => {
      const caps = capacidadesDoModelo(m);
      const precos: Record<string, number> = {};
      for (const r of ["1K", "2K", "4K"] as Resolucao[]) if (aceitaResolucao(caps, r)) precos[r] = precoPorImagem(m, "alta", r);
      const daRodada = RODADA_PADRAO.find((x) => x.modelo_imagem_id === m.id) ?? null;
      return {
        id: m.id,
        rotulo: m.rotulo,
        provedor: m.provedor,
        modelo_api: m.modelo_api,
        capacidades: caps,
        preco_por_resolucao: precos,
        preco_padrao_usd: precoPorImagem(m, "alta", daRodada?.resolucao ?? null),
        na_rodada: daRodada ? { padrao: daRodada.padrao, qualidade: daRodada.qualidade, resolucao: daRodada.resolucao } : null,
        faz_4k: aceitaResolucao(caps, "4K"),
      };
    });
    return f.json({ motores, rodada_padrao: RODADA_PADRAO, custo_usd: 0 });
  }

  async function modeloCandidataGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    recusarClone(p);
    if (p.status === "arquivada") throw new ErroDeRegra(409, "modelo_arquivado", "A persona está arquivada.");
    const pagador = await clienteQuePaga(ch, p, corpo.client_id);
    const motorId = limpo(corpo.modelo_imagem_id, 160);
    if (!motorId) throw new ErroDeRegra(400, "modelo_imagem_obrigatorio", "Diga o gerador desta candidata (modelo_imagem_id).");
    const m = await carregarModelo(motorId, "imagem");
    const padrao = padraoDoMotor(m.id);
    const qualidade = lerQualidade(corpo.qualidade, padrao.qualidade);
    const resolucao = lerResolucao(corpo.resolucao) ?? padrao.resolucao;
    const pedido = limpoOuNulo(corpo.pedido, 600);
    garantirPermitido(pedido ?? "");
    // As legendas do prompt precisam bater com o que vai: corta no limite do gerador antes.
    const refs = await referenciasDoDono(p, limiteDeReferencias(m));
    const prompt = promptDaCandidata({ nome: p.nome, ficha: p.ficha, invariantes: p.invariantes, usos: refs.usos, pedido });
    const { linha, saida } = await gerarImagemDaPersona({
      ch, p, pagador, m, qualidade, resolucao,
      seed: lerSemente(corpo.seed),
      prompt,
      referencias: refs.imagens,
      fontes: refs.ids.map((id, i) => ({ tipo: `referencia_${refs.usos[i]}`, id })),
      papel: "candidata",
      rodadaId: idOuNulo(corpo.rodada_id),
    });
    const atual = await atualizarStatus(await lerPersona(p.id));
    return f.json({ imagem: await comUrl(linha), url: await f.urlAssinada(linha.storage_bucket, linha.storage_path), modelo: atual, ...respostaDaGeracao(saida) });
  }

  async function modeloAncoraEscolher(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    if (p.status === "arquivada") throw new ErroDeRegra(409, "modelo_arquivado", "A persona está arquivada.");
    const img = await imagemDaPersona(p.id, idDe(corpo.imagem_id, "imagem_id"));
    if (img.papel === "detalhe") throw new ErroDeRegra(409, "ancora_invalida", "A âncora sai de uma candidata ou de uma vista, não de um detalhe 4K.");
    const trocou = p.ancora_imagem_id !== img.id;
    const { error: e1 } = await db().from("foto_modelo_imagens").update({ aprovada: true, motivo: null }).eq("id", img.id);
    if (e1) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível marcar a âncora.");
    const { data, error } = await db().from("foto_modelos").update({
      ancora_imagem_id: img.id,
      motor_preferido_id: img.motor_id,
      versao: trocou ? p.versao + 1 : p.versao,
    }).eq("id", p.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar a âncora.");
    const imagens = await imagensDaPersona(p.id);
    const atual = await atualizarStatus(data as LinhaPersona, imagens);
    return f.json({
      modelo: atual,
      imagem: await comUrl({ ...img, aprovada: true }),
      folha: resumoDaFolha(imagens),
      aviso: "A folha e as próximas fotos desta persona ficam presas ao gerador da âncora (trocar de gerador aumenta a deriva do rosto).",
      custo_usd: 0,
    });
  }

  async function modeloVistaGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    recusarClone(p);
    if (p.status === "arquivada") throw new ErroDeRegra(409, "modelo_arquivado", "A persona está arquivada.");
    const vista = lerVista(corpo.vista);
    if (!vista) throw new ErroDeRegra(400, "vista_invalida", `Vista inválida. Use: ${VISTAS_DA_PERSONA.join(", ")}.`);
    if (!p.ancora_imagem_id || !p.motor_preferido_id) throw new ErroDeRegra(409, "sem_ancora", "Escolha a âncora entre as candidatas antes de gerar a folha.");
    const pedido = limpo(corpo.modelo_imagem_id, 160);
    if (pedido && pedido !== p.motor_preferido_id) {
      throw new ErroDeRegra(409, "motor_da_ancora", "A folha usa o mesmo gerador da âncora (trocar de gerador aumenta a deriva do rosto).", { motor_da_ancora: p.motor_preferido_id });
    }
    const pagador = await clienteQuePaga(ch, p, corpo.client_id);
    const m = await carregarModelo(p.motor_preferido_id, "imagem");
    const imagens = await imagensDaPersona(p.id);
    const ancora = imagens.find((i) => i.id === p.ancora_imagem_id);
    if (!ancora) throw new ErroDeRegra(409, "sem_ancora", "A âncora desta persona sumiu. Escolha outra.");
    const identidades = identidadesDaVista(ancora, imagens, vista, limiteDeReferencias(m));
    const baixadas = await f.emParalelo(identidades, 3, (i) => f.baixarReduzida(i.storage_bucket, i.storage_path, LADO_REFERENCIA, `persona-${i.vista ?? i.papel}`));
    const legendas = identidades.map((i) => (i.id === ancora.id ? "âncora da persona (retrato aprovado)" : `vista aprovada: ${DESCRICAO_DA_VISTA[lerVista(i.vista) ?? "frente"]}`));
    const qualidade = lerQualidade(corpo.qualidade, lerQualidade(ancora.qualidade, padraoDoMotor(m.id).qualidade));
    const resolucao = lerResolucao(corpo.resolucao) ?? lerResolucao(ancora.resolucao) ?? padraoDoMotor(m.id).resolucao;
    const prompt = promptDaVista({ nome: p.nome, ficha: p.ficha, invariantes: p.invariantes, vista, identidades: legendas });
    const { linha, saida } = await gerarImagemDaPersona({
      ch, p, pagador, m, qualidade, resolucao,
      seed: lerSemente(corpo.seed),
      prompt,
      referencias: baixadas,
      fontes: identidades.map((i) => ({ tipo: i.id === ancora.id ? "ancora" : "vista", id: i.id })),
      papel: "vista",
      vista,
    });
    const todas = [...imagens, linha];
    const atual = await atualizarStatus(await lerPersona(p.id), todas);
    return f.json({
      imagem: await comUrl(linha),
      url: await f.urlAssinada(linha.storage_bucket, linha.storage_path),
      modelo: atual,
      folha: resumoDaFolha(todas),
      ...respostaDaGeracao(saida),
    });
  }

  async function modeloImagemDecidir(ch: Chamador, corpo: Record<string, unknown>) {
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    const { data: achada, error: e0 } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).maybeSingle();
    if (e0) throw new ErroDeRegra(503, "modelos_indisponivel", "Não foi possível ler a imagem.");
    if (!achada) throw new ErroDeRegra(404, "imagem_inexistente", "Imagem da persona não encontrada.");
    const img = achada as LinhaImagemPersona;
    const p = await personaComAcesso(ch, img.modelo_id);
    const decisao = String(corpo.decisao ?? "");
    if (decisao !== "aprovar" && decisao !== "rejeitar") throw new ErroDeRegra(400, "decisao_invalida", "decisao: aprovar ou rejeitar.");
    if (decisao === "rejeitar" && p.ancora_imagem_id === img.id) {
      throw new ErroDeRegra(409, "ancora_nao_rejeita", "Esta é a âncora da persona: escolha outra âncora antes de rejeitá-la.");
    }
    const { data, error } = await db().from("foto_modelo_imagens").update({ aprovada: decisao === "aprovar", motivo: limpoOuNulo(corpo.motivo, 500) })
      .eq("id", img.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar a decisão.");
    const imagens = await imagensDaPersona(p.id);
    const atual = await atualizarStatus(p, imagens);
    return f.json({ imagem: await comUrl(data as LinhaImagemPersona), modelo: atual, folha: resumoDaFolha(imagens), custo_usd: 0 });
  }

  /** Âncora e até 2 vistas aprovadas (identidade da pessoa no detalhe). */
  async function identidadesParaDetalhe(p: LinhaPersona, excluir: string, max: number): Promise<{ imagens: ImagemEntrada[]; ids: string[] }> {
    if (!p.ancora_imagem_id || max <= 0) return { imagens: [], ids: [] };
    const todas = await imagensDaPersona(p.id);
    const ancora = todas.find((i) => i.id === p.ancora_imagem_id);
    if (!ancora) return { imagens: [], ids: [] };
    const lista = identidadesDaVista(ancora, todas, "frente", Math.min(3, max)).filter((i) => i.id !== excluir);
    const imagens = await f.emParalelo(lista, 3, (i) => f.baixarReduzida(i.storage_bucket, i.storage_path, 1024, `identidade-${i.vista ?? i.papel}`));
    return { imagens, ids: lista.map((i) => i.id) };
  }

  /**
   * Gerador do 4K: o primeiro ativo, na ordem de candidatosAo4K (pedido da
   * tela, padrão do alvo, reservas conferidas), cuja capacidade inclua 4K.
   * Nunca manda 4K a quem não aceita (erro do OpenRouter de 26/09/2026 com o
   * gemini-3-pro-image normal). Pedido sem 4K troca pela reserva, com aviso.
   */
  async function geradorDo4K(alvo: AlvoDoDetalhe, pedidoBruto: unknown): Promise<{ m: ModeloIa; aviso: string | null }> {
    const pedido = limpo(pedidoBruto, 160) || null;
    const testados: { id: string; resolucoes: string[] }[] = [];
    for (const id of candidatosAo4K(alvo, pedido)) {
      let m: ModeloIa;
      try {
        m = await carregarModelo(id, "imagem");
      } catch {
        continue;
      }
      const caps = capacidadesDoModelo(m);
      if (aceitaResolucao(caps, "4K")) {
        const trocou = !!pedido && m.id !== pedido;
        return { m, aviso: trocou ? `O gerador escolhido não gera em 4K: o detalhe saiu no ${m.rotulo || m.id}.` : null };
      }
      testados.push({ id: m.id, resolucoes: caps.resolucoes ?? [] });
    }
    throw new ErroDeRegra(409, "resolucao_nao_suportada", "Nenhum gerador ativo no catálogo faz 4K. Ative o google/gemini-3-pro-image-preview (pessoa) ou o Seedream 4.5 (produto).", { testados });
  }

  async function modeloDetalhar(ch: Chamador, corpo: Record<string, unknown>) {
    const alvo = lerAlvoDoDetalhe(corpo.alvo);
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    // Detalhar é 4K de verdade: sempre num gerador cuja capacidade inclui 4K (sem cair calado para 2K).
    const { m, aviso: avisoDoGerador } = await geradorDo4K(alvo, corpo.modelo_imagem_id);
    const qualidade = lerQualidade(corpo.qualidade, "alta");
    const limite = limiteDeReferencias(m);

    if (corpo.modelo_id != null && String(corpo.modelo_id).trim()) {
      // Imagem da persona: vira imagem nova da persona (papel detalhe, derivada da origem).
      const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
      recusarClone(p);
      if (p.status === "arquivada") throw new ErroDeRegra(409, "modelo_arquivado", "A persona está arquivada.");
      const origem = await imagemDaPersona(p.id, imagemId);
      const pagador = await clienteQuePaga(ch, p, corpo.client_id);
      const base = await f.baixarReduzida(origem.storage_bucket, origem.storage_path, LADO_ORIGEM_DETALHE, "origem");
      const ident = alvo === "pessoa" ? await identidadesParaDetalhe(p, origem.id, limite - 1) : { imagens: [], ids: [] };
      const prompt = promptDoDetalhe({ alvo, nome: p.nome, ficha: p.ficha, invariantes: p.invariantes, comIdentidade: ident.imagens.length });
      const { linha, saida } = await gerarImagemDaPersona({
        ch, p, pagador, m, qualidade, resolucao: "4K",
        seed: lerSemente(corpo.seed),
        prompt,
        referencias: [base, ...ident.imagens],
        fontes: [{ tipo: "origem", id: origem.id }, ...ident.ids.map((id) => ({ tipo: "identidade", id }))],
        papel: "detalhe",
        vista: origem.vista,
        derivadaDe: origem.id,
        alvo,
      });
      return f.json({
        origem: "modelo",
        imagem: await comUrl(linha),
        url: await f.urlAssinada(linha.storage_bucket, linha.storage_path),
        antes: { imagem_id: origem.id, url: await f.urlAssinada(origem.storage_bucket, origem.storage_path) },
        depois: { imagem_id: linha.id, url: await f.urlAssinada(linha.storage_bucket, linha.storage_path) },
        aviso: `${avisoDoGerador ? `${avisoDoGerador} ` : ""}Geração nova em 4K (não é ampliação fiel): compare rosto e detalhes com a cortina antes de usar.`,
        modelo_imagem_id: m.id,
        ...respostaDaGeracao(saida),
      });
    }

    // Imagem do acervo (resultado do Canvas, foto aprovada): derivada nova no acervo, modo detalhe.
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    const [origem] = await f.lerImagens(clientId, [imagemId]);
    if (!origem) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não está no acervo do cliente.");
    const base = await f.baixarReduzida(origem.storage_bucket, origem.storage_path, LADO_ORIGEM_DETALHE, origem.nome);
    // Persona marcada na imagem (tags persona:<id>): a identidade vai junto quando o alvo é pessoa.
    const personaId = (origem.tags ?? []).map((t) => t.match(/^persona:([0-9a-f-]{36})$/i)?.[1]).find(Boolean) ?? null;
    let persona: LinhaPersona | null = null;
    if (alvo === "pessoa" && personaId) persona = await lerPersona(personaId).catch(() => null);
    if (persona?.client_id && persona.client_id !== clientId) persona = null;
    const ident = persona ? await identidadesParaDetalhe(persona, "", limite - 1) : { imagens: [], ids: [] };
    const prompt = promptDoDetalhe({ alvo, nome: persona?.nome ?? null, ficha: persona?.ficha ?? null, invariantes: persona?.invariantes ?? [], comIdentidade: ident.imagens.length });
    const saida = await chamarImagem({
      clientId,
      modeloId: m.id,
      prompt,
      referencias: [base, ...ident.imagens],
      qualidade,
      tamanho: origem.largura && origem.altura ? `${origem.largura}x${origem.altura}` : TAMANHO_DA_PERSONA,
      resolucao: "4K",
      seed: lerSemente(corpo.seed),
      referencia: { tipo: "cliente_imagem", id: origem.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const sha = await sha256Hex(saida.png);
    const caminho = `${clientId}/foto/detalhes/${origem.id}-4k-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(mime)}`;
    await f.salvarNoMesa(caminho, saida.png, mime);
    const tags = Array.from(new Set([...(origem.tags ?? []).filter((t) => /^persona:|^kit:|^canvas/.test(t)), "mesa_foto", "detalhe_4k", "gerada", ...(persona ? ["pessoa_sintetica"] : [])])).slice(0, 30);
    const { data, error } = await db().from("cliente_imagens").insert({
      client_id: clientId,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: `${origem.nome} (detalhe 4K)`.slice(0, 160),
      pasta: "Mesa Foto / Detalhes",
      categoria: origem.categoria,
      tags,
      descricao: `Detalhe em 4K gerado por IA a partir de ${origem.nome} (geração nova, não ampliação fiel). Motor ${saida.modeloId}.`.slice(0, 1000),
      derivada_de: origem.id,
      gerada: true,
      modo: "detalhe",
      kit_id: origem.kit_id,
      sha256: sha,
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      aprovada: false,
    }).select(f.camposImagem).single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw new ErroDeRegra(503, "gravacao_falhou", "O detalhe foi gerado e cobrado, mas não entrou no acervo (a migration 03 aceita o modo detalhe?).", { uso_id: saida.usoId, custo_usd: saida.custoUsd });
    }
    const nova = data as unknown as ImagemDoAcervoLida;
    const url = await f.urlAssinada("mesa", caminho);
    return f.json({
      origem: "acervo",
      imagem: { ...nova, url },
      url,
      antes: { imagem_id: origem.id, url: await f.urlAssinada(origem.storage_bucket, origem.storage_path) },
      depois: { imagem_id: nova.id, url },
      aviso: `${avisoDoGerador ? `${avisoDoGerador} ` : ""}Geração nova em 4K (não é ampliação fiel): compare com a cortina antes de aprovar.`,
      modelo_imagem_id: m.id,
      ...respostaDaGeracao(saida),
    });
  }

  const ESQUEMA_LEITURA_PERSONA = {
    nome: "leitura_da_persona",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pele", "olhos", "maos", "cabelo", "dentes", "luz", "fundo", "artefatos", "idade_aparente_estimada", "lembra_alguem", "consistencia_com_ancora", "resumo"],
      properties: {
        pele: { type: "string" },
        olhos: { type: "string" },
        maos: { type: "string" },
        cabelo: { type: "string" },
        dentes: { type: "string" },
        luz: { type: "string" },
        fundo: { type: "string" },
        artefatos: { type: "array", items: { type: "string" } },
        idade_aparente_estimada: { type: ["number", "null"] },
        lembra_alguem: { type: "string" },
        consistencia_com_ancora: { type: ["string", "null"] },
        resumo: { type: "string" },
      },
    },
  };

  const SISTEMA_LEITURA_PERSONA = `Você é o conferente de retratos de pessoas sintéticas do estúdio da agência Aceleriq. A PRIMEIRA imagem é a foto gerada. Se houver uma SEGUNDA imagem, ela é a âncora aprovada da mesma persona.
Descreva só o que se vê, em frases curtas e concretas:
- pele: poros, penugem, variação de tom, brilho, se parece plástico, porcelana ou filtro de beleza;
- olhos (alinhamento, reflexo, íris), maos (quantos dedos, articulações, unhas; "fora do quadro" se não aparecem), cabelo (fios soltos, textura), dentes ("não aparecem" se for o caso);
- luz: direção, se a sombra da pessoa bate com o fundo; fundo: o que é;
- artefatos: deformações, borrões, texto ou marca d'água, bordas estranhas;
- idade_aparente_estimada: número;
- lembra_alguem: se o rosto lembra alguma pessoa pública conhecida (diga quem só se a semelhança for forte; senão "não");
- consistencia_com_ancora: com a segunda imagem, compare rosto, formato do rosto, olhos, nariz, lábios, tom de pele e cabelo (null sem âncora);
- resumo: uma frase.
Não julgue beleza. Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  async function modeloConferir(ch: Chamador, corpo: Record<string, unknown>) {
    const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const img = await imagemDaPersona(p.id, idDe(corpo.imagem_id, "imagem_id"));
    const pagador = await clienteQuePaga(ch, p, corpo.client_id);
    let ancora: LinhaImagemPersona | null = null;
    if (p.ancora_imagem_id && p.ancora_imagem_id !== img.id) ancora = await imagemDaPersona(p.id, p.ancora_imagem_id).catch(() => null);
    const [gerada, ...outras] = await Promise.all([
      f.baixarReduzida(img.storage_bucket, img.storage_path, 1280, "gerada"),
      ...(ancora ? [f.baixarReduzida(ancora.storage_bucket, ancora.storage_path, 1024, "ancora")] : []),
    ]);
    const leitor = await f.modeloDeTexto("leitura", corpo.modelo_id_leitura);
    const lido = await chamarTexto({
      clientId: pagador,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_LEITURA_PERSONA,
      mensagens: [{
        papel: "usuario",
        conteudo: `Persona "${p.nome}", pessoa sintética adulta. Ficha: idade aparente ${p.ficha.idade_aparente} anos; invariantes: ${p.invariantes.join("; ")}.\nImagem 1 = foto gerada (${img.papel}${img.vista ? `, vista ${img.vista}` : ""}).${ancora ? " Imagem 2 = âncora aprovada." : ""}`,
        imagens: [gerada, ...outras],
      }],
      esquemaJson: ESQUEMA_LEITURA_PERSONA,
      maxTokensSaida: 3_000,
      timeoutMs: f.timeoutTextoMs,
      referencia: { tipo: REF_MODELO, id: p.id },
      criadoPor: ch.userId,
    });
    const leitura = normalizarLeituraDaPersona(lido.json);
    let custo = lido.custoUsd;
    // Jev só como aviso (composite scoring): notas por dimensão; o código monta os alertas; a equipe decide.
    let notas: NotasDoJev = { realismo_pele: null, anatomia: null, luz: null, lembra_pessoa_publica: null, identidade_diferente: null };
    let erroJev: string | null = null;
    try {
      const perguntas: Record<string, Parameters<typeof jevPerguntar>[0]["questions"][string]> = {
        realismo_pele: { type: "score", instructions: "Pela descrição em `leitura.pele` e `leitura.artefatos`, quão fotográfica e natural é a pele da pessoa na foto gerada?", criteria: NIVEIS_PELE },
        anatomia: { type: "score", instructions: "Pela descrição em `leitura.olhos`, `leitura.maos`, `leitura.dentes` e `leitura.artefatos`, quão correta é a anatomia da pessoa na foto gerada?", criteria: NIVEIS_ANATOMIA },
        luz: { type: "score", instructions: "Pela descrição em `leitura.luz` e `leitura.fundo`, quão coerente é a luz entre a pessoa e o fundo?", criteria: NIVEIS_LUZ },
        lembra_pessoa_publica: {
          type: "noul",
          instructions: "A descrição em `leitura.lembra_alguem` diz que o rosto lembra fortemente uma pessoa pública real e conhecida?",
          criteria: { true: "Sim: a leitura aponta semelhança forte com alguém conhecido.", false: "Não: a leitura não aponta semelhança forte com ninguém conhecido." },
        },
      };
      if (ancora && leitura.consistencia_com_ancora) {
        perguntas.identidade_diferente = {
          type: "noul",
          instructions: "A comparação em `leitura.consistencia_com_ancora` mostra que o rosto da foto gerada é de outra pessoa em relação à âncora (formato do rosto, olhos, nariz, lábios, tom de pele ou cabelo claramente diferentes)?",
          criteria: { true: "Sim: parece outra pessoa.", false: "Não: parece a mesma pessoa, com diferenças pequenas de ângulo ou luz." },
        };
      }
      const res = await jevPerguntar({ state: { persona: { nome: p.nome, idade_aparente: p.ficha.idade_aparente, invariantes: p.invariantes }, leitura }, questions: perguntas });
      const cobrado = await cobrarJev(res, { clientId: pagador, tarefa: "verificacao", referencia: { tipo: REF_MODELO, id: p.id }, criadoPor: ch.userId });
      if (cobrado) custo += cobrado.custoUsd;
      notas = {
        realismo_pele: notaScore(res.answers.realismo_pele),
        anatomia: notaScore(res.answers.anatomia),
        luz: notaScore(res.answers.luz),
        lembra_pessoa_publica: probabilidadeNoul(res.answers.lembra_pessoa_publica),
        identidade_diferente: perguntas.identidade_diferente ? probabilidadeNoul(res.answers.identidade_diferente) : null,
      };
    } catch (e) {
      erroJev = e instanceof JevErro ? e.codigo : "jev_indisponivel";
    }
    const composto = alertasDoRealismo(notas, leitura);
    const conferencia = {
      leitura,
      notas_jev: notas,
      nota_realismo: composto.nota_realismo,
      alertas: composto.alertas,
      jev_erro: erroJev,
      comparada_com_ancora: !!ancora,
      modelo_id: lido.modeloId,
      conferida_em: new Date().toISOString(),
      custo_usd: arred6(custo),
      aviso: "Só aviso: a equipe decide (sem refazer automático).",
    };
    await db().from("foto_modelo_imagens").update({ conferencia }).eq("id", img.id);
    return f.json({ imagem_id: img.id, conferencia, custo_usd: arred6(custo), saldo_usd: lido.saldoUsd });
  }

  // ---------------------------------------------------------------- estimativa

  /** estimar { acao_alvo: modelo_candidata | modelo_rodada | modelo_vista | modelo_detalhar, ... } */
  async function estimarModelos(ch: Chamador, corpo: Record<string, unknown>, alvo: string): Promise<Response> {
    if (alvo === "modelo_rodada") {
      let refs = 0;
      if (UUID.test(String(corpo.modelo_id ?? ""))) refs = (await personaComAcesso(ch, String(corpo.modelo_id))).referencias.length;
      const pedidos = Array.isArray(corpo.motores) ? (corpo.motores as unknown[]) : null;
      const rodada = await rodadaPadrao(refs);
      const por_motor = pedidos
        ? await Promise.all(pedidos.map(async (x) => {
          const o = (x && typeof x === "object" ? x : { modelo_imagem_id: x }) as Record<string, unknown>;
          const id = limpo(o.modelo_imagem_id, 160);
          try {
            const m = await carregarModelo(id, "imagem");
            const padrao = padraoDoMotor(m.id);
            const q = lerQualidade(o.qualidade, padrao.qualidade);
            const r = lerResolucao(o.resolucao) ?? padrao.resolucao;
            return { modelo_imagem_id: m.id, qualidade: q, resolucao: resolucaoParaModelo(capacidadesDoModelo(m), r).resolucao, estimativa_usd: estimativaDeUmaImagem(m, q, r, refs), disponivel: true, motivo: null };
          } catch (e) {
            return { modelo_imagem_id: id, qualidade: null, resolucao: null, estimativa_usd: 0, disponivel: false, motivo: e instanceof IaMotorErro ? e.codigo : "indisponivel" };
          }
        }))
        : rodada.filter((r) => r.ligado).map((r) => ({ modelo_imagem_id: r.modelo_imagem_id, qualidade: r.qualidade, resolucao: r.resolucao, estimativa_usd: r.estimativa_usd, disponivel: true, motivo: null }));
      return f.json({ estimativa_usd: arred6(por_motor.reduce((s, x) => s + x.estimativa_usd, 0)), por_motor, rodada_padrao: rodada, custo_usd: 0 });
    }
    if (alvo === "modelo_candidata") {
      const m = await carregarModelo(limpo(corpo.modelo_imagem_id, 160) || RODADA_PADRAO[0].modelo_imagem_id, "imagem");
      const padrao = padraoDoMotor(m.id);
      const refs = UUID.test(String(corpo.modelo_id ?? "")) ? (await personaComAcesso(ch, String(corpo.modelo_id))).referencias.length : 0;
      const r = lerResolucao(corpo.resolucao) ?? padrao.resolucao;
      return f.json({ estimativa_usd: estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, padrao.qualidade), r, refs), modelo_imagem_id: m.id, resolucao: resolucaoParaModelo(capacidadesDoModelo(m), r).resolucao, custo_usd: 0 });
    }
    if (alvo === "modelo_vista") {
      const p = await personaComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
      if (!p.motor_preferido_id) throw new ErroDeRegra(409, "sem_ancora", "Escolha a âncora antes de estimar a folha.");
      const m = await carregarModelo(p.motor_preferido_id, "imagem");
      const padrao = padraoDoMotor(m.id);
      const r = lerResolucao(corpo.resolucao) ?? padrao.resolucao;
      const uma = estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, padrao.qualidade), r, 4);
      const quantas = Math.max(1, Math.min(8, Math.floor(Number(corpo.quantidade) || 1)));
      return f.json({ estimativa_usd: arred6(uma * quantas), por_vista_usd: uma, quantidade: quantas, modelo_imagem_id: m.id, custo_usd: 0 });
    }
    if (alvo === "modelo_detalhar") {
      const a = lerAlvoDoDetalhe(corpo.alvo);
      // Mesmo gerador que o detalhe vai usar (o primeiro com 4K de verdade).
      const { m, aviso } = await geradorDo4K(a, corpo.modelo_imagem_id);
      return f.json({ estimativa_usd: estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, "alta"), "4K", a === "pessoa" ? 4 : 1), faz_4k: true, modelo_imagem_id: m.id, aviso, custo_usd: 0 });
    }
    throw new ErroDeRegra(400, "alvo_invalido", "acao_alvo desconhecida para Modelos.");
  }

  // ---------------------------------------------------------------- sugerir pelo brief

  const ESQUEMA_SUGESTAO_PERSONA = {
    nome: "persona_sugerida",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["nome", "ficha", "invariantes", "porque"],
      properties: {
        nome: { type: "string" },
        ficha: {
          type: "object",
          additionalProperties: false,
          required: ["idade_aparente", "genero_apresentado", "tom_de_pele", "rosto", "olhos", "cabelo", "marcas", "corpo", "estilo", "notas"],
          properties: {
            idade_aparente: { type: "number" },
            genero_apresentado: { type: "string" },
            tom_de_pele: { type: "string" },
            rosto: { type: "string" },
            olhos: { type: "string" },
            cabelo: {
              type: "object",
              additionalProperties: false,
              required: ["cor", "comprimento", "textura"],
              properties: { cor: { type: "string" }, comprimento: { type: "string" }, textura: { type: "string" } },
            },
            marcas: { type: "array", items: { type: "string" } },
            corpo: { type: "string" },
            estilo: { type: "string" },
            notas: { type: "string" },
          },
        },
        invariantes: { type: "array", items: { type: "string" } },
        porque: { type: "string" },
      },
    },
  };

  const SISTEMA_SUGESTAO_PERSONA = `Você é o diretor de casting da agência Aceleriq. Recebe o contexto real do cliente que a Mesa usa (brief, marca, história, porquê, público, oferta e a campanha escolhida ou a do mês) e sugere UMA pessoa sintética para as fotos de campanha desse cliente.
Regras:
- A pessoa não existe: nunca parecida com alguém real ou conhecido, sem citar nomes de pessoas, sem "parecida com".
- Adulta, com idade aparente de 21 anos ou mais; sem sexualização.
- Escolha pelo público do cliente e pelo que a marca vende: quem compra ou usa o produto, no estilo da marca.
- Ficha em traços concretos e fotográficos (tom de pele com subtom, formato do rosto, olhos, cabelo com cor, comprimento e textura, marcas naturais pequenas, corpo, estilo de roupa), sem adjetivo de perfeição.
- Nome fictício curto e comum no Brasil.
- invariantes: de 3 a 6 traços que nunca mudam entre as fotos.
- porque: uma ou duas frases dizendo por que esta pessoa conversa com o público e a campanha.
- Se a equipe mandou um pedido, ele vale sobre a sua escolha (menos quando fere as regras).
Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  /**
   * modelo_sugerir { client_id, pedido?, campanha_id?, modelo_id? }
   * -> { sugestao: { nome, ficha, invariantes, porque }, avisos, campanha_mesa, custo_usd, saldo_usd }
   * Preenche a ficha pelo contexto do cliente que a Mesa usa. Não grava: a
   * equipe confere, ajusta e cria (modelo_criar valida de novo).
   */
  async function modeloSugerir(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idOuNulo(corpo.client_id);
    if (!clientId) throw new ErroDeRegra(400, "client_id_obrigatorio", "Diga o cliente (client_id) para ler o brief.");
    await f.garantirAcesso(ch, clientId);
    const pedido = limpo(corpo.pedido, 1000);
    garantirPermitido(pedido);
    if (!f.contextoDoCliente) throw new ErroDeRegra(503, "contexto_indisponivel", "O contexto do cliente não está disponível nesta função.");
    const [contexto, diretor] = await Promise.all([f.contextoDoCliente(clientId, corpo.campanha_id, corpo.marca_id), f.modeloDeTexto("diretor_arte", corpo.modelo_id)]);
    const saida = await chamarTexto({
      clientId,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: diretor.id,
      sistema: SISTEMA_SUGESTAO_PERSONA,
      mensagens: [{
        papel: "usuario",
        conteudo: `Sugira a persona com os dados reais do cliente:
${JSON.stringify({ cliente: contexto.dados, pedido_da_equipe: pedido || null })}`,
      }],
      esquemaJson: ESQUEMA_SUGESTAO_PERSONA,
      maxTokensSaida: 3_000,
      timeoutMs: 300_000,
      referencia: { tipo: REF_SUGESTAO, id: clientId },
      criadoPor: ch.userId,
    });
    const s = fichaSugerida(saida.json ?? {});
    return f.json({
      sugestao: { nome: s.nome, ficha: s.ficha, invariantes: s.invariantes, porque: s.porque },
      avisos: s.avisos,
      campanha_mesa: contexto.campanha,
      custo_usd: saida.custoUsd,
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
    });
  }

  return {
    acoes: {
      modelo_sugerir: modeloSugerir,
      modelos_listar: modelosListar,
      modelo_ler: modeloLer,
      modelo_criar: modeloCriar,
      modelo_editar: modeloEditar,
      motores_imagem: motoresImagem,
      modelo_candidata_gerar: modeloCandidataGerar,
      modelo_ancora_escolher: modeloAncoraEscolher,
      modelo_vista_gerar: modeloVistaGerar,
      modelo_imagem_decidir: modeloImagemDecidir,
      modelo_detalhar: modeloDetalhar,
      modelo_conferir: modeloConferir,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    estimar: estimarModelos,
    lerPersona,
    imagensDaPersona,
  };
}

/** Ações de Modelos que chamam IA ou baixam imagens (respondem com fôlego). */
export const ACOES_LONGAS_DE_MODELOS = [
  "modelo_sugerir", "modelo_candidata_gerar", "modelo_vista_gerar", "modelo_detalhar", "modelo_conferir", "modelo_ler", "modelos_listar", "modelo_criar",
];

/** Alvos que a ação estimar repassa para Modelos. */
export const ALVOS_DE_ESTIMATIVA_DE_MODELOS = ["modelo_candidata", "modelo_rodada", "modelo_vista", "modelo_detalhar"];
