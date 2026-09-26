/**
 * Mesa Foto, área "Clones" (pedido do dono, 25/09; pesquisa e formato para
 * vídeo em docs/mesa-foto/CLONES.md). As regras puras ficam em
 * clones-regras.ts; aqui ficam banco, armazenamento e IA.
 *
 * Um clone é uma pessoa REAL do cliente, a partir de 1 a 4 fotos reais do
 * acervo, com a autorização de uso de imagem registrada. Mora em foto_modelos
 * (origem 'clone_de_foto_real', migration 04). A folha de identidade (frente,
 * 3/4, perfil, meio corpo, corpo inteiro) fica em foto_modelo_imagens (papel
 * vista); as variações (roupa, cenário, pose, expressão) vão para o acervo do
 * cliente (cliente_imagens, modo 'clone', gerada) e seguem o mesmo caminho de
 * aprovar e usar das outras fotos.
 *
 * Ações (POST { acao, ... } na função mesa-foto):
 * - clones_listar { client_id } -> { clones }
 * - clone_criar { client_id, nome, imagem_ids[1..4], principal_id?, autorizacao, invariantes?, descricao?, idade_aparente?, kit_id? }
 *     -> { clone, estimativa_folha_usd, estimativa_variacao_usd } (sem IA, sem custo)
 * - clone_ler { modelo_id } -> { clone, reais, imagens, folha, variacoes, motores, presets, autorizacao_valida }
 * - clone_editar { modelo_id, nome?, invariantes?, autorizacao?, revogar_autorizacao?, arquivar? } -> { clone, avisos }
 * - clone_folha_gerar { modelo_id, vista, modelo_imagem_id?, qualidade?, resolucao?, seed? } -> { imagem, url, clone, folha, custo_usd, saldo_usd, avisos }
 * - clone_imagem_decidir { imagem_id, decisao: 'aprovar'|'rejeitar', motivo? } -> { imagem, clone, folha }
 * - clone_variacao_gerar { modelo_id, pedido: { preset?, roupa?, cenario?, pose?, expressao?, luz?, enquadramento?, livre? }, formato?, modelo_imagem_id?, qualidade?, resolucao?, seed? }
 *     -> { imagem (cliente_imagens), url, custo_usd, saldo_usd, avisos } (UMA foto por chamada)
 * - clone_conferir { modelo_id, imagem_id, origem?: 'folha'|'acervo' } -> { conferencia, custo_usd } (visão + Jev só como aviso)
 * - clone_pacote { modelo_id } -> { pacote } (formato para a futura mesa de vídeo; sem IA)
 * 26/09 (pedido do dono):
 * - clone_variacao_gerar usa TODAS as vistas aprovadas da folha como identidade (na ordem da folha) e repete os
 *   traços lidos nas fotos reais; preset "uniforme_marca" (ou aplicar_logo: true) anexa a logo oficial do kit da marca.
 * - clone_variacoes_sugerir { modelo_id, quantidade?, pedido?, campanha_id?, marca_id? } -> { sugestoes, negocio, custo_usd }
 *   (variações coerentes com o negócio do cliente, pelo contexto consolidado; não gera imagem)
 * - clone_transferir { modelo_id, client_id_destino } -> { clone, resumo, avisos } (só quem acessa os dois clientes;
 *   move clone, folha e fotos do acervo ligadas, com os arquivos; custo e uso já cobrados ficam no cliente antigo)
 * - clone_imagem_decidir ficou leve (sem assinar URL de novo; a tela já tem a imagem e aprova na hora).
 * - estimar aceita acao_alvo clone_folha, clone_variacao, clone_conferir e clone_sugerir.
 * 25/09 à noite (pedido do dono: mudar, tirar e trocar fotos depois de criado, apagar e clonar; regras em clones-edicao.ts):
 * - clone_fotos_editar { modelo_id, imagem_ids[1..4], principal_id? } -> { clone, mudanca, desatualizadas, folha }
 *   (mesmo limite e qualidade da criação; a folha fica guardada, marcada "feita com as fotos antigas")
 * - clone_folha_gerar e clone_variacao_gerar aceitam fotos_reais_ids (quais fotos de origem vão nesta geração)
 * - clone_variacao_refazer { modelo_id, imagem_id, fotos_reais_ids?, qualidade? } -> como clone_variacao_gerar (o mesmo pedido)
 * - clone_imagem_arquivar { modelo_id, imagem_id, origem: 'folha'|'acervo', restaurar? } -> { imagem, clone, folha } (apagar com desfazer)
 * - clone_duplicar { modelo_id, nome?, levar_folha? } -> { clone, copiadas, avisos } (mesmas fotos de origem e a MESMA autorização, conferida de novo)
 * - clones_listar { arquivados: true } lista só os arquivados (para restaurar com clone_editar { arquivar: false }).
 */

import {
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
  type Qualidade,
  type Resolucao,
  type SaidaImagem,
} from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, probabilidadeNoul, type PerguntaJev } from "../_shared/jev.ts";
import { kitComMarca, marcaDoPedido } from "../_shared/marca.ts";
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, limpo, limpoOuNulo, listaDeTextos, mimeDe, nomeSeguro, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa, ImagemDoAcervoLida } from "./ferramentas.ts";
import { estimativaDeUmaImagem, type LinhaImagemPersona } from "./modelos.ts";
import { lerSemente, lerVista, type VistaDaPersona } from "./personas.ts";
import {
  alertasDoClone,
  autorizacaoValida,
  caminhoNoDestino,
  identidadesDaVariacao,
  MAX_IDENTIDADES_NA_VARIACAO,
  normalizarSugestoesDeVariacao,
  planoDaTransferencia,
  tracosDasConferencias,
  usaLogoDaMarca,
  type AutorizacaoDoClone,
  FOLHA_DO_CLONE,
  type FonteDeIdentidade,
  FORMATOS_DA_VARIACAO,
  garantirPermitidoNoClone,
  IDADE_MINIMA_CLONE,
  identidadesDoClone,
  lerAutorizacaoDoClone,
  lerFormatoDaVariacao,
  lerFotosReais,
  lerPedidoDeVariacao,
  type LeituraDoClone,
  MAX_IDENTIDADES_NO_GERADOR,
  MOTOR_PADRAO_DO_CLONE,
  motorDoClone,
  MOTORES_DO_CLONE,
  normalizarLeituraDoClone,
  type NotaDoTraco,
  OPCOES_DO_TRACO,
  ORIGEM_CLONE,
  PRESETS_DE_VARIACAO,
  promptDaFolhaDoClone,
  promptDaVariacaoDoClone,
  resumoDaFolhaDoClone,
  ROTULO_DO_TRACO,
  statusDoClone,
  tamanhoDaVista,
  TRACOS_DO_ROSTO,
} from "./clones-regras.ts";
import {
  autorizacaoDaCopia,
  avisosArquivados,
  avisosRestaurados,
  caminhoDoPedido,
  colunaQueFalta,
  type EntradaReal,
  formatoPelaMedida,
  fotosEscolhidasParaGerar,
  nomeDaCopia,
  novaIdentidadeReal,
  pedidoDaDescricao,
  validarFotosDeOrigem,
  vistaArquivada,
  vistaDesatualizada,
} from "./clones-edicao.ts";

const REF_CLONE = "foto_clone";
const LADO_IDENTIDADE = 1280;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
const MIGRATION = "a migration 04 (docs/mesa-foto/migrations/04_clones.sql) foi aplicada?";

type IdentidadeReal = EntradaReal;
/** Vista da folha com as colunas novas (opcionais: sem o SQL Z, a marca fica em avisos). */
type VistaLida = LinhaImagemPersona & { arquivada_em?: string | null };

export type LinhaClone = {
  id: string;
  client_id: string;
  client_origem_id: string | null;
  nome: string;
  descricao: string | null;
  ficha: Record<string, unknown> & { idade_aparente: number };
  invariantes: string[];
  status: string;
  ancora_imagem_id: string | null;
  motor_preferido_id: string | null;
  versao: number;
  etica: Record<string, unknown>;
  origem: string;
  autorizacao: AutorizacaoDoClone | null;
  identidade_real: IdentidadeReal[];
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDeRegra(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
const lerQualidade = (v: unknown, padrao: Qualidade): Qualidade => (QUALIDADES.includes(v as Qualidade) ? (v as Qualidade) : padrao);

export function acoesDeClones(f: FerramentasDaMesa) {
  const db = () => f.servico();

  // ---------------------------------------------------------------- leituras

  async function lerClone(id: string): Promise<LinhaClone> {
    const { data, error } = await db().from("foto_modelos").select("*").eq("id", id).maybeSingle();
    if (error) throw new ErroDeRegra(503, "clones_indisponivel", `Não foi possível ler o clone (${MIGRATION}).`);
    if (!data) throw new ErroDeRegra(404, "clone_inexistente", "Clone não encontrado.");
    const c = data as LinhaClone;
    if (c.origem !== ORIGEM_CLONE) throw new ErroDeRegra(409, "nao_e_clone", "Esta é uma persona sintética, não um clone. Use a aba Modelos.");
    c.invariantes = c.invariantes ?? [];
    c.identidade_real = Array.isArray(c.identidade_real) ? c.identidade_real : [];
    return c;
  }

  async function cloneComAcesso(ch: Chamador, id: string): Promise<LinhaClone> {
    const c = await lerClone(id);
    await f.garantirAcesso(ch, c.client_id);
    return c;
  }

  /** Nada novo sai de um clone arquivado ou com a autorização revogada ou vencida. */
  function garantirGeravel(c: LinhaClone) {
    if (c.status === "arquivada") throw new ErroDeRegra(409, "clone_arquivado", "O clone está arquivado.");
    const v = autorizacaoValida(c.autorizacao);
    if (!v.ok) throw new ErroDeRegra(422, "autorizacao_invalida", v.motivo ?? "Autorização inválida.");
  }

  /** Todas as imagens da folha, inclusive as apagadas (arquivadas): a transferência leva tudo. */
  async function imagensDaFolha(id: string): Promise<VistaLida[]> {
    const { data, error } = await db().from("foto_modelo_imagens").select("*").eq("modelo_id", id).order("criado_em", { ascending: true }).limit(300);
    if (error) throw new ErroDeRegra(503, "clones_indisponivel", "Não foi possível ler a folha do clone.");
    return (data as VistaLida[] | null) ?? [];
  }

  /** A folha que conta (status, identidade, pacote): sem as vistas apagadas. */
  const ativasDa = (folha: VistaLida[]) => folha.filter((i) => !vistaArquivada(i));

  /** A vista como a tela recebe: com "feita com as fotos antigas" e "apagada". */
  const comMarcas = (c: LinhaClone) => (i: VistaLida) => ({ ...i, desatualizada: i.papel === "vista" && vistaDesatualizada(i, c.identidade_real), arquivada: vistaArquivada(i) });

  async function fotosReais(c: LinhaClone): Promise<(ImagemDoAcervoLida & { principal: boolean })[]> {
    const lidas = await f.lerImagens(c.client_id, c.identidade_real.map((r) => r.imagem_id));
    return c.identidade_real
      .map((r) => {
        const l = lidas.find((x) => x.id === r.imagem_id);
        return l ? { ...l, principal: r.principal } : null;
      })
      .filter((x): x is ImagemDoAcervoLida & { principal: boolean } => !!x);
  }

  async function variacoesDoClone(c: LinhaClone): Promise<ImagemDoAcervoLida[]> {
    const { data } = await db().from("cliente_imagens").select(f.camposImagem).eq("client_id", c.client_id).contains("tags", [`clone:${c.id}`])
      .order("criado_em", { ascending: false }).limit(200);
    return ((data as unknown as ImagemDoAcervoLida[] | null) ?? []).filter((i) => i.ativa !== false);
  }

  /** Variações apagadas (inativas no acervo): ficam para restaurar. */
  async function variacoesApagadas(c: LinhaClone): Promise<ImagemDoAcervoLida[]> {
    const { data } = await db().from("cliente_imagens").select(f.camposImagem).eq("client_id", c.client_id).contains("tags", [`clone:${c.id}`]).eq("ativa", false)
      .order("atualizado_em", { ascending: false }).limit(24);
    return (data as unknown as ImagemDoAcervoLida[] | null) ?? [];
  }

  const comUrl = async <T extends { storage_bucket: string; storage_path: string }>(i: T) => ({ ...i, url: await f.urlAssinada(i.storage_bucket, i.storage_path) });

  async function atualizarStatus(c: LinhaClone, imagens?: VistaLida[]): Promise<LinhaClone> {
    const lista = ativasDa(imagens ?? (await imagensDaFolha(c.id)));
    const novo = statusDoClone(c.status, lista);
    const frente = lista.find((i) => i.papel === "vista" && i.vista === "frente" && i.aprovada === true) ?? null;
    const ancora = frente?.id ?? null;
    if (novo === c.status && ancora === c.ancora_imagem_id) return c;
    const { data } = await db().from("foto_modelos").update({ status: novo, ancora_imagem_id: ancora }).eq("id", c.id).select("*").maybeSingle();
    return (data as LinhaClone | null) ?? { ...c, status: novo, ancora_imagem_id: ancora };
  }

  /** Motor do clone: o preferido (preso ao primeiro que gerou) ou o pedido/padrão. */
  async function motorDaChamada(c: LinhaClone, pedido: unknown): Promise<ModeloIa> {
    const pedidoId = limpo(pedido, 160);
    if (c.motor_preferido_id && pedidoId && pedidoId !== c.motor_preferido_id) {
      throw new ErroDeRegra(409, "motor_do_clone", "Este clone já usa outro gerador (trocar de gerador aumenta a deriva do rosto).", { motor_do_clone: c.motor_preferido_id });
    }
    return await carregarModelo(c.motor_preferido_id || pedidoId || MOTOR_PADRAO_DO_CLONE.modelo_imagem_id, "imagem");
  }

  const padraoDo = (m: ModeloIa) => motorDoClone(m.id) ?? { qualidade: "alta" as Qualidade, resolucao: null as Resolucao | null };

  /**
   * Fotos reais e vistas aprovadas que vão ao gerador, já baixadas, com a
   * legenda de cada uma. Na folha: reais primeiro e até 2 vistas perto do
   * ângulo (até 5). Na variação: a real principal e TODAS as vistas
   * aprovadas, na ordem da folha (até 8, menos as vagas reservadas para
   * logo e referência de estilo). Devolve também os traços já lidos pela
   * conferência das vistas aprovadas (para repetir no prompt, sem custo).
   */
  async function identidadesBaixadas(c: LinhaClone, vista: VistaDaPersona | null, m: ModeloIa, modo: "folha" | "variacao" = "folha", vagasReservadas = 0, soReais: string[] | null = null): Promise<{ fontes: FonteDeIdentidade[]; imagens: ImagemEntrada[]; tracos: string[]; puladas: number }> {
    const [todasReais, folha] = await Promise.all([fotosReais(c), imagensDaFolha(c.id)]);
    // Quando a equipe escolhe as fotos de origem desta geração, vão só elas (a principal, se escolhida, na frente).
    const reais = soReais ? todasReais.filter((r) => soReais.indexOf(r.id) >= 0) : todasReais;
    if (!reais.length) throw new ErroDeRegra(409, "sem_fotos_reais", "As fotos reais deste clone saíram do acervo. Escolha as fotos de novo.");
    // Vista apagada não conta; vista feita com as fotos antigas continua guardada mas não vai ao gerador como identidade.
    const aprovadasTodas = ativasDa(folha).filter((i) => i.papel === "vista" && i.aprovada === true);
    const aprovadas = aprovadasTodas.filter((i) => !vistaDesatualizada(i, c.identidade_real));
    const puladas = aprovadasTodas.length - aprovadas.length;
    const reaisFontes = reais.map((r) => ({ id: r.id, tipo: "real" as const, vista: null, principal: r.principal }));
    const folhaFontes = aprovadas.map((a) => ({ id: a.id, tipo: "folha" as const, vista: a.vista }));
    const doGerador = limiteDeReferencias(m) || MAX_IDENTIDADES_NO_GERADOR;
    const fontes = modo === "variacao"
      ? identidadesDaVariacao(reaisFontes, folhaFontes, Math.max(1, Math.min(doGerador, MAX_IDENTIDADES_NA_VARIACAO) - vagasReservadas))
      : identidadesDoClone(reaisFontes, folhaFontes, vista, Math.min(doGerador, MAX_IDENTIDADES_NO_GERADOR));
    const tracos = modo === "variacao" ? tracosDasConferencias(aprovadas.map((a) => a.conferencia).filter(Boolean)) : [];
    const imagens = await f.emParalelo(fontes, 3, (fo) => {
      if (fo.tipo === "real") {
        const r = reais.find((x) => x.id === fo.id)!;
        return f.baixarReduzida(r.storage_bucket, r.storage_path, LADO_IDENTIDADE, `real-${r.nome}`);
      }
      const a = aprovadas.find((x) => x.id === fo.id)!;
      return f.baixarReduzida(a.storage_bucket, a.storage_path, LADO_IDENTIDADE, `folha-${a.vista ?? "vista"}`);
    });
    return { fontes, imagens, tracos, puladas };
  }

  /**
   * Logo oficial do kit da marca (a marca do pedido por cima do cliente; a
   * CME sem logo sai sem logo, nunca a da Acerbi) e a paleta em texto. Sem
   * logo: null (a variação de uniforme recusa com a frase certa).
   */
  async function logoDaMarca(clientId: string, corpo: Record<string, unknown>): Promise<{ imagem: ImagemEntrada; paleta: string | null } | null> {
    const [kitLido, marca] = await Promise.all([
      db().from("cliente_kit_marca").select("paleta, logo_file_id, logo_path").eq("client_id", clientId).maybeSingle().then((r) => r.data as Record<string, unknown> | null, () => null),
      marcaDoPedido(db(), clientId, corpo).catch(() => null),
    ]);
    const kit = kitComMarca(kitLido ?? null, marca) as { paleta?: unknown; logo_path?: string | null; logo_file_id?: string | null } | null;
    let imagem: ImagemEntrada | null = null;
    if (kit?.logo_path && String(kit.logo_path).indexOf(`${clientId}/`) === 0) {
      imagem = await f.baixarReduzida("mesa", String(kit.logo_path), 1024, "logo-oficial").catch(() => null);
    }
    if (!imagem && kit?.logo_file_id) {
      const { data } = await db().from("files").select("client_id, file_url, storage_bucket, storage_path").eq("id", kit.logo_file_id).maybeSingle();
      const a = data as { client_id: string; file_url: string | null; storage_bucket: string | null; storage_path: string | null } | null;
      if (a && a.client_id === clientId) {
        let bucket = a.storage_bucket;
        let caminho = a.storage_path;
        if (!caminho && a.file_url && a.file_url.indexOf("files://") === 0) {
          bucket = "files";
          caminho = a.file_url.slice("files://".length);
        }
        if (bucket && caminho) imagem = await f.baixarReduzida(bucket, caminho, 1024, "logo-oficial").catch(() => null);
      }
    }
    if (!imagem) return null;
    const cores = Array.isArray(kit?.paleta)
      ? (kit!.paleta as Record<string, unknown>[]).map((x) => [limpo(x?.nome, 30), limpo(x?.hex, 12)].filter(Boolean).join(" ")).filter(Boolean).slice(0, 5)
      : [];
    return { imagem, paleta: cores.length ? cores.join(", ") : null };
  }

  /** Grava o gerador como preferido do clone na primeira geração. */
  async function prenderMotor(c: LinhaClone, motorId: string): Promise<LinhaClone> {
    if (c.motor_preferido_id) return c;
    const { data } = await db().from("foto_modelos").update({ motor_preferido_id: motorId }).eq("id", c.id).select("*").maybeSingle();
    return (data as LinhaClone | null) ?? { ...c, motor_preferido_id: motorId };
  }

  const respostaDaGeracao = (s: SaidaImagem) => ({ custo_usd: s.custoUsd, saldo_usd: s.saldoUsd, reserva_usada: s.reservaUsada ?? null, avisos: s.avisos ?? [] });

  // ---------------------------------------------------------------- ações

  async function clonesListar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    let q = db().from("foto_modelos").select("*").eq("client_id", clientId).eq("origem", ORIGEM_CLONE).order("atualizado_em", { ascending: false }).limit(100);
    // Arquivado some das listas e dos seletores das mesas; a seção "Arquivados" pede só eles para restaurar.
    if (corpo.arquivados === true) q = q.eq("status", "arquivada");
    else if (corpo.incluir_arquivados !== true) q = q.neq("status", "arquivada");
    const { data, error } = await q;
    if (error) throw new ErroDeRegra(503, "clones_indisponivel", `Não foi possível ler os clones (${MIGRATION}).`);
    const lista = ((data as LinhaClone[] | null) ?? []).map((c) => ({ ...c, identidade_real: Array.isArray(c.identidade_real) ? c.identidade_real : [] }));
    const principais = lista.map((c) => (c.identidade_real.find((r) => r.principal) ?? c.identidade_real[0])?.imagem_id).filter((x): x is string => !!x);
    const ancoras = lista.map((c) => c.ancora_imagem_id).filter((x): x is string => !!x);
    const [reais, folha] = await Promise.all([
      f.lerImagens(clientId, principais),
      ancoras.length ? db().from("foto_modelo_imagens").select("*").in("id", ancoras).then((r) => (r.data as LinhaImagemPersona[] | null) ?? []) : Promise.resolve([] as LinhaImagemPersona[]),
    ]);
    const clones = await f.emParalelo(lista, 6, async (c) => {
      const a = c.ancora_imagem_id ? folha.find((i) => i.id === c.ancora_imagem_id) : null;
      const pid = (c.identidade_real.find((r) => r.principal) ?? c.identidade_real[0])?.imagem_id;
      const r = pid ? reais.find((i) => i.id === pid) : null;
      const capa = a ?? r ?? null;
      return {
        ...c,
        capa_url: capa ? await f.urlAssinada(capa.storage_bucket, capa.storage_path) : null,
        capa_e_real: !a && !!r,
        autorizacao_valida: autorizacaoValida(c.autorizacao),
      };
    });
    return f.json({ clones, custo_usd: 0 });
  }

  async function estimativasDoClone(motorId: string | null, refs: number) {
    try {
      const m = await carregarModelo(motorId || MOTOR_PADRAO_DO_CLONE.modelo_imagem_id, "imagem");
      const p = padraoDo(m);
      return { modelo_imagem_id: m.id, por_imagem_usd: estimativaDeUmaImagem(m, p.qualidade, p.resolucao, refs) };
    } catch {
      return { modelo_imagem_id: motorId, por_imagem_usd: null };
    }
  }

  async function cloneCriar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    const nome = limpo(corpo.nome, 80);
    if (!nome) throw new ErroDeRegra(400, "nome_obrigatorio", "Dê o nome da pessoa (como a equipe a chama).");
    const descricao = limpoOuNulo(corpo.descricao, 1000);
    const invariantes = listaDeTextos(corpo.invariantes, 12, 200);
    garantirPermitidoNoClone(nome, descricao ?? "", ...invariantes);
    // Mesma regra da edição (clone_fotos_editar): 1 a 4, do acervo, reais, ativas e com tamanho mínimo.
    const ids = validarFotosDeOrigem(corpo.imagem_ids, await f.lerImagens(clientId, lerFotosReais(corpo.imagem_ids)));
    // Autorização: a do kit de pessoa (quando veio de um) preenche o que a equipe não mandou.
    let base: Record<string, unknown> = {};
    if (corpo.kit_id != null && corpo.kit_id !== "") {
      const { kit } = await f.lerKitComRefs(ch, idDe(corpo.kit_id, "kit_id"));
      if (kit.client_id !== clientId) throw new ErroDeRegra(409, "kit_de_outro_cliente", "Este kit pertence a outro cliente.");
      if (kit.tipo === "pessoa" && kit.autorizacao?.confirmada) {
        base = { confirmada: true, quem: kit.autorizacao.quem, data: kit.autorizacao.data, finalidade: kit.autorizacao.finalidade, escopo: kit.autorizacao.escopo, validade: kit.autorizacao.validade, observacao: kit.autorizacao.observacao };
      }
    }
    const pedidoAut = corpo.autorizacao && typeof corpo.autorizacao === "object" ? corpo.autorizacao as Record<string, unknown> : {};
    const mesclada: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(pedidoAut)) if (v !== undefined && v !== null && v !== "") mesclada[k] = v;
    const autorizacao: AutorizacaoDoClone = { ...lerAutorizacaoDoClone(mesclada), registrada_por: ch.userId, registrada_em: new Date().toISOString() };
    const idade = corpo.idade_aparente == null || corpo.idade_aparente === "" ? null : Math.round(Number(corpo.idade_aparente));
    if (idade != null && (!Number.isFinite(idade) || idade < IDADE_MINIMA_CLONE || idade > 95)) {
      throw new ErroDeRegra(422, "idade_minima", `Clone só de pessoa adulta (${IDADE_MINIMA_CLONE} anos ou mais).`);
    }
    const principalPedido = UUID.test(String(corpo.principal_id ?? "")) && ids.includes(String(corpo.principal_id)) ? String(corpo.principal_id) : ids[0];
    const { data, error } = await db().from("foto_modelos").insert({
      client_id: clientId,
      client_origem_id: clientId,
      nome,
      descricao,
      ficha: {
        idade_aparente: idade ?? 30,
        genero_apresentado: "", tom_de_pele: "", rosto: "", olhos: "", sobrancelhas: "", nariz: "", labios: "",
        cabelo: { cor: "", comprimento: "", textura: "" }, marcas: [], corpo: "", altura: "", estilo: "",
        notas: idade == null ? "Pessoa real: a identidade vem das fotos reais (idade não informada)." : "Pessoa real: a identidade vem das fotos reais.",
      },
      invariantes,
      referencias: [],
      status: "rascunho",
      versao: 1,
      origem: ORIGEM_CLONE,
      autorizacao,
      identidade_real: novaIdentidadeReal([], ids, principalPedido, clientId, new Date().toISOString()).identidade,
      etica: { clone_de_pessoa_real: true, autorizada: true, adulta: true, sintetica: false, sem_semelhanca: false, marcado_por: ch.userId, marcado_em: new Date().toISOString() },
      criado_por: ch.userId,
    }).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", `Não foi possível criar o clone (${MIGRATION}).`);
    const est = await estimativasDoClone(null, Math.min(ids.length + 2, MAX_IDENTIDADES_NO_GERADOR));
    return f.json({
      clone: data,
      estimativa_folha_usd: est.por_imagem_usd != null ? arred6(est.por_imagem_usd * FOLHA_DO_CLONE.length) : null,
      estimativa_variacao_usd: est.por_imagem_usd,
      modelo_imagem_id: est.modelo_imagem_id,
      custo_usd: 0,
    });
  }

  async function cloneLer(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const [reais, todas, variacoes, apagadas] = await Promise.all([fotosReais(c), imagensDaFolha(c.id), variacoesDoClone(c), variacoesApagadas(c)]);
    const folha = ativasDa(todas);
    const arquivadas = todas.filter((i) => vistaArquivada(i)).slice(-24);
    const refs = Math.min(reais.length + folha.filter((i) => i.aprovada === true).length, MAX_IDENTIDADES_NO_GERADOR);
    const motores = await Promise.all(MOTORES_DO_CLONE.map(async (mo) => {
      try {
        const m = await carregarModelo(mo.modelo_imagem_id, "imagem");
        return { ...mo, disponivel: true, estimativa_usd: estimativaDeUmaImagem(m, mo.qualidade, mo.resolucao, Math.max(1, refs)), motivo: null as string | null };
      } catch (e) {
        return { ...mo, disponivel: false, estimativa_usd: 0, motivo: e instanceof IaMotorErro ? e.codigo : "indisponivel" };
      }
    }));
    return f.json({
      clone: c,
      reais: await f.emParalelo(reais, 4, comUrl),
      imagens: await f.emParalelo(folha.map(comMarcas(c)), 6, comUrl),
      // Apagadas (arquivadas) ficam guardadas para restaurar; nada é excluído de vez.
      arquivadas: await f.emParalelo(arquivadas.map(comMarcas(c)), 6, comUrl),
      folha: resumoDaFolhaDoClone(folha),
      variacoes: await f.emParalelo(variacoes.slice(0, 60), 6, comUrl),
      variacoes_arquivadas: await f.emParalelo(apagadas.slice(0, 24), 6, comUrl),
      motores,
      presets: PRESETS_DE_VARIACAO.map((p) => ({ id: p.id, rotulo: p.rotulo, ...p.pedido })),
      formatos: Object.keys(FORMATOS_DA_VARIACAO),
      autorizacao_valida: autorizacaoValida(c.autorizacao),
      custo_usd: 0,
    });
  }

  async function cloneEditar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const patch: Record<string, unknown> = {};
    const avisos: string[] = [];
    if (corpo.nome !== undefined) {
      const nome = limpo(corpo.nome, 80);
      if (!nome) throw new ErroDeRegra(400, "nome_obrigatorio", "O nome não pode ficar vazio.");
      garantirPermitidoNoClone(nome);
      patch.nome = nome;
    }
    if (corpo.invariantes !== undefined) {
      const inv = listaDeTextos(corpo.invariantes, 12, 200);
      garantirPermitidoNoClone(...inv);
      patch.invariantes = inv;
      if (c.ancora_imagem_id) patch.versao = c.versao + 1;
    }
    if (corpo.autorizacao !== undefined && corpo.autorizacao !== null) {
      patch.autorizacao = { ...lerAutorizacaoDoClone(corpo.autorizacao), registrada_por: ch.userId, registrada_em: new Date().toISOString() };
      avisos.push("Autorização renovada.");
    }
    if (corpo.revogar_autorizacao === true) {
      patch.autorizacao = { ...(c.autorizacao ?? {}), revogada_em: new Date().toISOString(), revogada_por: ch.userId };
      patch.status = "arquivada";
      avisos.push("Autorização revogada: o clone foi arquivado e nada novo pode ser gerado. As fotos já feitas continuam no acervo marcadas; tire de circulação o que já foi publicado.");
    }
    if (corpo.arquivar === true) patch.status = "arquivada";
    if (corpo.arquivar === false && c.status === "arquivada" && corpo.revogar_autorizacao !== true) {
      if (!autorizacaoValida((patch.autorizacao as AutorizacaoDoClone | undefined) ?? c.autorizacao).ok) {
        throw new ErroDeRegra(422, "autorizacao_invalida", "Para reabrir o clone, registre uma autorização válida.");
      }
      patch.status = statusDoClone("rascunho", ativasDa(await imagensDaFolha(c.id)));
    }
    if (!Object.keys(patch).length) return f.json({ clone: c, avisos, custo_usd: 0 });
    // Quando e quem arquivou (colunas do SQL Z; sem elas, só o status muda).
    const extras: Record<string, unknown> = {};
    if (patch.status === "arquivada" && c.status !== "arquivada") Object.assign(extras, { arquivado_em: new Date().toISOString(), arquivado_por: ch.userId });
    if (c.status === "arquivada" && patch.status && patch.status !== "arquivada") Object.assign(extras, { arquivado_em: null, arquivado_por: null });
    const data = await atualizarComColunasNovas("foto_modelos", c.id, patch, extras);
    if (!data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar o clone.");
    return f.json({ clone: data, avisos, custo_usd: 0 });
  }

  /** Update tentando as colunas novas do SQL Z; se ainda não existem, grava só o resto (degradado). */
  async function atualizarComColunasNovas(tabela: string, id: string, patch: Record<string, unknown>, extras: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (Object.keys(extras).length) {
      const r = await db().from(tabela).update({ ...patch, ...extras }).eq("id", id).select("*").maybeSingle();
      if (!r.error) return (r.data as Record<string, unknown> | null) ?? null;
      if (!colunaQueFalta(r.error)) return null;
    }
    if (!Object.keys(patch).length) {
      const r = await db().from(tabela).select("*").eq("id", id).maybeSingle();
      return (r.data as Record<string, unknown> | null) ?? null;
    }
    const r = await db().from(tabela).update(patch).eq("id", id).select("*").maybeSingle();
    return r.error ? null : ((r.data as Record<string, unknown> | null) ?? null);
  }

  async function cloneFolhaGerar(ch: Chamador, corpo: Record<string, unknown>) {
    let c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    const vista = lerVista(corpo.vista);
    if (!vista || !FOLHA_DO_CLONE.includes(vista)) throw new ErroDeRegra(400, "vista_invalida", `Vista inválida. Use: ${FOLHA_DO_CLONE.join(", ")}.`);
    const soReais = fotosEscolhidasParaGerar(corpo.fotos_reais_ids, c.identidade_real);
    const m = await motorDaChamada(c, corpo.modelo_imagem_id);
    const p = padraoDo(m);
    const { fontes, imagens } = await identidadesBaixadas(c, vista, m, "folha", 0, soReais);
    const prompt = promptDaFolhaDoClone({ nome: c.nome, vista, fontes, invariantes: c.invariantes });
    const qualidade = lerQualidade(corpo.qualidade, p.qualidade);
    const resolucao = lerResolucao(corpo.resolucao) ?? p.resolucao;
    const seed = lerSemente(corpo.seed);
    const saida = await chamarImagem({
      clientId: c.client_id,
      modeloId: m.id,
      prompt,
      referencias: imagens,
      qualidade,
      tamanho: tamanhoDaVista(vista),
      resolucao,
      seed,
      mesmoModelo: true,
      referencia: { tipo: REF_CLONE, id: c.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const caminho = `${c.client_id}/foto/clones/${c.id}/folha-${vista}-${nomeSeguro(saida.modeloId.split("/").pop() ?? "motor")}-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(mime)}`;
    await f.salvarNoMesa(caminho, saida.png, mime);
    const { data, error } = await db().from("foto_modelo_imagens").insert({
      modelo_id: c.id,
      papel: "vista",
      vista,
      storage_bucket: "mesa",
      storage_path: caminho,
      mime,
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      sha256: await sha256Hex(saida.png),
      motor_id: saida.modeloId,
      qualidade,
      resolucao: saida.resolucao ?? null,
      seed,
      prompt,
      fontes: fontes.map((fo) => ({ tipo: fo.tipo === "real" ? "foto_real" : "vista", id: fo.id })),
      aprovada: null,
      versao_modelo: c.versao,
      gerada: true,
      custo_usd: arred6(saida.custoUsd),
      uso_id: saida.usoId || null,
      reserva_usada: saida.reservaUsada ?? null,
      avisos: saida.avisos ?? [],
      criado_por: ch.userId,
    }).select("*").single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw new ErroDeRegra(503, "gravacao_falhou", "A vista foi gerada e cobrada, mas não foi possível registrá-la. Avise o admin.", { uso_id: saida.usoId, custo_usd: saida.custoUsd });
    }
    c = await prenderMotor(c, saida.modeloId);
    const todas = await imagensDaFolha(c.id);
    c = await atualizarStatus(c, todas);
    const linha = data as VistaLida;
    return f.json({ imagem: await comUrl(comMarcas(c)(linha)), url: await f.urlAssinada(linha.storage_bucket, linha.storage_path), clone: c, folha: resumoDaFolhaDoClone(ativasDa(todas)), ...respostaDaGeracao(saida) });
  }

  async function cloneImagemDecidir(ch: Chamador, corpo: Record<string, unknown>) {
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    const { data: achada, error: e0 } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).maybeSingle();
    if (e0) throw new ErroDeRegra(503, "clones_indisponivel", "Não foi possível ler a imagem.");
    if (!achada) throw new ErroDeRegra(404, "imagem_inexistente", "Imagem do clone não encontrada.");
    const img = achada as VistaLida;
    const c = await cloneComAcesso(ch, img.modelo_id);
    const decisao = String(corpo.decisao ?? "");
    if (decisao !== "aprovar" && decisao !== "rejeitar") throw new ErroDeRegra(400, "decisao_invalida", "decisao: aprovar ou rejeitar.");
    if (decisao === "aprovar" && vistaArquivada(img)) throw new ErroDeRegra(409, "vista_apagada", "Esta vista foi apagada. Restaure antes de aprovar.");
    // Uma vista aprovada por posição: aprovar outra da mesma vista tira a aprovação da anterior.
    if (decisao === "aprovar" && img.vista) {
      await db().from("foto_modelo_imagens").update({ aprovada: null }).eq("modelo_id", c.id).eq("papel", "vista").eq("vista", img.vista).eq("aprovada", true).neq("id", img.id);
    }
    const { data, error } = await db().from("foto_modelo_imagens").update({ aprovada: decisao === "aprovar", motivo: limpoOuNulo(corpo.motivo, 500) }).eq("id", img.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar a decisão.");
    // Leve (pedido do dono, 26/09: "aprovar demora"): sem assinar URL de novo (a tela já tem a imagem e
    // aprova na hora); uma leitura da folha só para o status. Nada de visão nem Jev no aprovar.
    const todas = await imagensDaFolha(c.id);
    const atual = await atualizarStatus(c, todas);
    return f.json({ imagem: data, clone: atual, folha: resumoDaFolhaDoClone(ativasDa(todas)), custo_usd: 0 });
  }

  type ExtrasDaVariacao = {
    /** Referências SÓ de estilo (Book): vão depois da identidade e da logo, com legenda. */
    estilo?: { imagens: ImagemEntrada[]; legendas: string[] } | null;
    tags?: string[];
    pasta?: string;
    nome?: string;
    referencia?: { tipo: string; id: string };
  };

  /**
   * Uma variação do clone (UMA foto por chamada), usada pela aba Clones e
   * pelo Book: identidade com todas as vistas aprovadas, traços repetidos,
   * logo oficial no uniforme e, no Book, as referências de estilo. A foto vai
   * para o acervo do cliente marcada como gerada e com a pessoa real indicada.
   */
  async function gerarVariacao(ch: Chamador, cloneLido: LinhaClone, corpo: Record<string, unknown>, extras: ExtrasDaVariacao = {}) {
    let c = cloneLido;
    garantirGeravel(c);
    const pedido = lerPedidoDeVariacao(corpo.pedido ?? corpo);
    const formato = lerFormatoDaVariacao(corpo.formato);
    const m = await motorDaChamada(c, corpo.modelo_imagem_id);
    const p = padraoDo(m);
    const avisos: string[] = [];
    const comLogo = usaLogoDaMarca(pedido, corpo.aplicar_logo);
    const logo = comLogo ? await logoDaMarca(c.client_id, corpo) : null;
    if (comLogo && !logo) {
      throw new ErroDeRegra(409, "sem_logo_da_marca", "O kit da marca não tem a logo oficial em imagem. Defina a logo no Contexto do cliente (ou da marca) antes do uniforme.");
    }
    const estilo = extras.estilo && extras.estilo.imagens.length ? extras.estilo : null;
    const vagas = (logo ? 1 : 0) + (estilo ? estilo.imagens.length : 0);
    const vistaMaisPerto: VistaDaPersona = pedido.enquadramento === "corpo_inteiro" ? "corpo_inteiro" : pedido.enquadramento === "meio_corpo" ? "meio_corpo" : "frente";
    const soReais = fotosEscolhidasParaGerar(corpo.fotos_reais_ids, c.identidade_real);
    const { fontes, imagens, tracos, puladas } = await identidadesBaixadas(c, vistaMaisPerto, m, "variacao", vagas, soReais);
    if (puladas) avisos.push(`${puladas} ${puladas === 1 ? "vista aprovada foi feita" : "vistas aprovadas foram feitas"} com as fotos antigas e não entrou como identidade. Gere a folha de novo com as fotos novas.`);
    const referencias = [...imagens, ...(estilo ? estilo.imagens : []), ...(logo ? [logo.imagem] : [])];
    const prompt = promptDaVariacaoDoClone({
      nome: c.nome,
      fontes,
      invariantes: c.invariantes,
      pedido,
      formato,
      tracos,
      estilo: estilo ? { inicio: fontes.length + 1, legendas: estilo.legendas } : null,
      logo: logo ? { indice: referencias.length, paleta: logo.paleta } : null,
    });
    if (logo) avisos.push("Uniforme com a logo oficial: confira a logo na roupa (letras, cores e proporção) antes de aprovar.");
    const qualidade = lerQualidade(corpo.qualidade, p.qualidade);
    const resolucao = lerResolucao(corpo.resolucao) ?? p.resolucao;
    const saida = await chamarImagem({
      clientId: c.client_id,
      modeloId: m.id,
      prompt,
      referencias,
      qualidade,
      tamanho: FORMATOS_DA_VARIACAO[formato],
      resolucao,
      seed: lerSemente(corpo.seed),
      mesmoModelo: true,
      referencia: extras.referencia ?? { tipo: REF_CLONE, id: c.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const mime = mimeDe(saida.png) ?? (saida.mime || "image/png");
    const dim = dimensoesDaImagem(saida.png);
    const caminho = `${c.client_id}/foto/clones/${c.id}/variacao-${pedido.preset ?? "livre"}-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(mime)}`;
    await f.salvarNoMesa(caminho, saida.png, mime);
    const principal = c.identidade_real.find((r) => r.principal) ?? c.identidade_real[0] ?? null;
    const oQueMudou = [pedido.roupa, pedido.cenario, pedido.pose, pedido.expressao].filter(Boolean).join("; ");
    const rotuloDoPreset = pedido.preset ? PRESETS_DE_VARIACAO.find((x) => x.id === pedido.preset)?.rotulo ?? pedido.preset : null;
    const { data, error } = await db().from("cliente_imagens").insert({
      client_id: c.client_id,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: (extras.nome ?? `${c.nome} (variação${rotuloDoPreset ? `: ${rotuloDoPreset}` : ""})`).slice(0, 160),
      pasta: extras.pasta ?? "Mesa Foto / Clones",
      categoria: "pessoa",
      tags: Array.from(new Set(["mesa_foto", "gerada", "pessoa_real_autorizada", "clone_variacao", `clone:${c.id}`, "tipo:pessoa", ...(logo ? ["uniforme_da_marca"] : []), ...(extras.tags ?? [])])).slice(0, 30),
      descricao: `Pessoa real (${c.nome}) recriada por IA a partir de fotos reais${fontes.some((x) => x.tipo === "folha") ? " e da folha de identidade aprovada" : ""}, com autorização de uso de imagem de ${c.autorizacao?.data ?? "data registrada"} (${c.autorizacao?.finalidade ?? ""}). ${oQueMudou ? `Mudou: ${oQueMudou}. ` : ""}${logo ? "Uniforme com a logo oficial da marca. " : ""}Motor ${saida.modeloId}. Ao publicar, ligue o rótulo de IA.`.slice(0, 1000),
      derivada_de: principal?.imagem_id ?? null,
      gerada: true,
      modo: "clone",
      kit_id: null,
      sha256: await sha256Hex(saida.png),
      largura: dim?.largura ?? null,
      altura: dim?.altura ?? null,
      aprovada: false,
    }).select(f.camposImagem).single();
    if (error || !data) {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw new ErroDeRegra(503, "gravacao_falhou", `A variação foi gerada e cobrada, mas não entrou no acervo (${MIGRATION}).`, { uso_id: saida.usoId, custo_usd: saida.custoUsd });
    }
    c = await prenderMotor(c, saida.modeloId);
    const nova = data as unknown as ImagemDoAcervoLida;
    // O pedido ao lado do arquivo, para "Gerar de novo" repetir a mesma foto (se falhar, a descrição serve de reserva).
    const doPedido = JSON.stringify({ pedido, formato, qualidade, com_logo: !!logo, com_estilo: !!estilo, fotos_reais_ids: soReais, gerado_em: new Date().toISOString() });
    await db().storage.from("mesa").upload(caminhoDoPedido(caminho), new Blob([doPedido], { type: "application/json" }), { contentType: "application/json", upsert: true }).catch(() => null);
    const url = await f.urlAssinada("mesa", caminho);
    return {
      imagem: { ...nova, url },
      url,
      clone: c,
      pedido,
      identidade: fontes.map((x) => ({ tipo: x.tipo === "real" ? "foto_real" : "vista_aprovada", id: x.id, vista: x.vista })),
      saida,
      avisos,
    };
  }

  async function cloneVariacaoGerar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const r = await gerarVariacao(ch, c, corpo);
    const resposta = respostaDaGeracao(r.saida);
    return f.json({ imagem: r.imagem, url: r.url, clone: r.clone, pedido: r.pedido, identidade: r.identidade, ...resposta, avisos: [...r.avisos, ...resposta.avisos] });
  }

  // ---------------------------------------------------------------- editar depois de criado (25/09 à noite)

  /**
   * clone_fotos_editar: tirar, pôr, trocar e marcar a principal nas fotos de
   * origem a qualquer momento, com o mesmo limite e a mesma qualidade da
   * criação. A folha fica guardada; as vistas feitas com as fotos antigas
   * voltam marcadas (desatualizadas) e não vão mais ao gerador como identidade.
   * Nada é gerado aqui (sem custo, sem laço de correção).
   */
  async function cloneFotosEditar(ch: Chamador, corpo: Record<string, unknown>) {
    let c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    const ids = validarFotosDeOrigem(corpo.imagem_ids, await f.lerImagens(c.client_id, lerFotosReais(corpo.imagem_ids)));
    const agora = new Date().toISOString();
    const mudanca = novaIdentidadeReal(c.identidade_real, ids, corpo.principal_id, c.client_id, agora);
    const resumo = { entraram: mudanca.entraram, sairam: mudanca.sairam, principal_mudou: mudanca.principal_mudou };
    if (!mudanca.igual) {
      const etica = c.etica ?? {};
      const log = Array.isArray((etica as Record<string, unknown>).fotos_de_origem) ? (etica as { fotos_de_origem: unknown[] }).fotos_de_origem : [];
      const { data, error } = await db().from("foto_modelos").update({
        identidade_real: mudanca.identidade,
        etica: { ...etica, fotos_de_origem: [...log, { em: agora, por: ch.userId, ...resumo }].slice(-10) },
      }).eq("id", c.id).select("*").single();
      if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", `Não foi possível gravar as fotos de origem (${MIGRATION}).`);
      c = { ...(data as LinhaClone), identidade_real: mudanca.identidade, invariantes: (data as LinhaClone).invariantes ?? [] };
    }
    const folha = ativasDa(await imagensDaFolha(c.id));
    const desatualizadas = folha.filter((i) => i.papel === "vista" && vistaDesatualizada(i, c.identidade_real)).map((i) => i.id);
    const avisos: string[] = [];
    if (desatualizadas.length) avisos.push(`${desatualizadas.length} ${desatualizadas.length === 1 ? "vista foi feita" : "vistas foram feitas"} com as fotos antigas. Continuam guardadas; gere de novo com as fotos novas quando quiser.`);
    return f.json({ clone: c, mudanca: resumo, desatualizadas, folha: resumoDaFolhaDoClone(folha), avisos, custo_usd: 0 });
  }

  /**
   * clone_imagem_arquivar: "apagar" uma vista da folha ou uma variação, com
   * desfazer (restaurar: true). Vista: marcada como arquivada (fora do status
   * e da identidade); variação: inativa no acervo. O arquivo fica no Storage.
   */
  async function cloneImagemArquivar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    const restaurar = corpo.restaurar === true;
    const agora = new Date().toISOString();
    if (String(corpo.origem ?? "folha") === "acervo") {
      const [a] = await f.lerImagens(c.client_id, [imagemId]);
      if (!a || !(a.tags ?? []).includes(`clone:${c.id}`)) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é uma variação deste clone.");
      const { data, error } = await db().from("cliente_imagens").update({ ativa: restaurar }).eq("id", a.id).eq("client_id", c.client_id).select(f.camposImagem).single();
      if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível apagar a variação.");
      return f.json({ imagem: await comUrl(data as unknown as ImagemDoAcervoLida), origem: "acervo", arquivada: !restaurar, custo_usd: 0 });
    }
    const { data: achada, error: e0 } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).eq("modelo_id", c.id).maybeSingle();
    if (e0) throw new ErroDeRegra(503, "clones_indisponivel", "Não foi possível ler a vista.");
    if (!achada) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é da folha deste clone.");
    const img = achada as VistaLida;
    const patch: Record<string, unknown> = { avisos: restaurar ? avisosRestaurados(img.avisos) : avisosArquivados(img.avisos, agora) };
    // Restaurar não deixa duas aprovadas na mesma vista: se outra já foi aprovada, a restaurada volta sem aprovação.
    if (restaurar && img.aprovada === true && img.vista) {
      const outra = ativasDa(await imagensDaFolha(c.id)).some((i) => i.id !== img.id && i.papel === "vista" && i.vista === img.vista && i.aprovada === true);
      if (outra) patch.aprovada = null;
    }
    const salva = await atualizarComColunasNovas("foto_modelo_imagens", img.id, patch, { arquivada_em: restaurar ? null : agora });
    if (!salva) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível apagar a vista.");
    const todas = await imagensDaFolha(c.id);
    const atual = await atualizarStatus(c, todas);
    return f.json({ imagem: await comUrl(comMarcas(atual)(salva as unknown as VistaLida)), origem: "folha", arquivada: !restaurar, clone: atual, folha: resumoDaFolhaDoClone(ativasDa(todas)), custo_usd: 0 });
  }

  /**
   * clone_variacao_refazer: a mesma variação de novo (o pedido guardado ao
   * lado do arquivo; sem ele, o que a descrição guardou), com a opção de
   * escolher as fotos de origem. UMA foto nova; a antiga fica (apagar é à parte).
   */
  async function cloneVariacaoRefazer(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    const [antiga] = await f.lerImagens(c.client_id, [idDe(corpo.imagem_id, "imagem_id")]);
    if (!antiga || !(antiga.tags ?? []).includes(`clone:${c.id}`)) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é uma variação deste clone.");
    let salvo: Record<string, unknown> | null = null;
    try {
      const { data } = await db().storage.from(antiga.storage_bucket || "mesa").download(caminhoDoPedido(antiga.storage_path));
      if (data) salvo = JSON.parse(await data.text()) as Record<string, unknown>;
    } catch {
      salvo = null;
    }
    const avisos: string[] = [];
    let pedido = salvo && salvo.pedido && typeof salvo.pedido === "object" ? (salvo.pedido as Record<string, unknown>) : null;
    if (!pedido) {
      pedido = pedidoDaDescricao(antiga.descricao, antiga.nome, PRESETS_DE_VARIACAO);
      if (!pedido) throw new ErroDeRegra(409, "pedido_desconhecido", "Não achei o pedido desta foto. Monte a variação de novo em \"O que muda\".");
      avisos.push("Esta foto é de antes do registro do pedido: usei o que a descrição guardou.");
    }
    if (salvo && salvo.com_estilo === true) avisos.push("A foto original veio do Book com referência de estilo; esta sai só com o pedido.");
    const formato = corpo.formato ?? (salvo ? salvo.formato : null) ?? formatoPelaMedida(antiga.largura, antiga.altura);
    const r = await gerarVariacao(ch, c, {
      pedido,
      formato,
      qualidade: corpo.qualidade ?? (salvo ? salvo.qualidade : undefined),
      fotos_reais_ids: corpo.fotos_reais_ids,
      aplicar_logo: (salvo && salvo.com_logo === true) || (antiga.tags ?? []).includes("uniforme_da_marca") ? true : undefined,
      marca_id: corpo.marca_id,
    }, { tags: [`refeita_de:${antiga.id}`] });
    const resposta = respostaDaGeracao(r.saida);
    return f.json({ imagem: r.imagem, url: r.url, clone: r.clone, pedido: r.pedido, identidade: r.identidade, substitui: antiga.id, ...resposta, avisos: [...avisos, ...r.avisos, ...resposta.avisos] });
  }

  /**
   * clone_duplicar: um clone novo da MESMA pessoa (ex.: outro visual), com as
   * mesmas fotos de origem e a MESMA autorização, conferida de novo (revogada
   * ou vencida recusa: nenhum clone nasce sem autorização válida). Leva as
   * vistas aprovadas e atuais da folha como cópia (arquivos copiados, sem
   * custo); as variações ficam no clone original.
   */
  async function cloneDuplicar(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const autorizacao = autorizacaoDaCopia(c.autorizacao, c.id);
    const nome = nomeDaCopia(c.nome, corpo.nome);
    garantirPermitidoNoClone(nome);
    const idsAtuais = c.identidade_real.map((r) => r.imagem_id);
    validarFotosDeOrigem(idsAtuais, await f.lerImagens(c.client_id, idsAtuais));
    const agora = new Date().toISOString();
    const { transferencias: _t, fotos_de_origem: _f, ...eticaBase } = (c.etica ?? {}) as Record<string, unknown>;
    const { data, error } = await db().from("foto_modelos").insert({
      client_id: c.client_id,
      client_origem_id: c.client_id,
      nome,
      descricao: c.descricao,
      ficha: c.ficha,
      invariantes: c.invariantes,
      referencias: [],
      status: "rascunho",
      versao: 1,
      origem: ORIGEM_CLONE,
      autorizacao,
      identidade_real: c.identidade_real.map((r) => ({ ...r, client_id: c.client_id })),
      etica: { ...eticaBase, clone_de_pessoa_real: true, autorizada: true, adulta: true, sintetica: false, duplicado_de: c.id, duplicado_por: ch.userId, duplicado_em: agora },
      motor_preferido_id: c.motor_preferido_id,
      criado_por: ch.userId,
    }).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", `Não foi possível duplicar o clone (${MIGRATION}).`);
    let novo = { ...(data as LinhaClone), identidade_real: Array.isArray((data as LinhaClone).identidade_real) ? (data as LinhaClone).identidade_real : [], invariantes: (data as LinhaClone).invariantes ?? [] };
    const avisos: string[] = [];
    let copiadas = 0;
    if (corpo.levar_folha !== false) {
      const aprovadas = ativasDa(await imagensDaFolha(c.id)).filter((i) => i.papel === "vista" && i.aprovada === true && !vistaDesatualizada(i, c.identidade_real));
      for (const a of aprovadas) {
        const bucket = a.storage_bucket || "mesa";
        const ext = (a.storage_path.split(".").pop() || "png").slice(0, 5);
        const para = `${novo.client_id}/foto/clones/${novo.id}/folha-${a.vista ?? "vista"}-copia-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const copia = await db().storage.from(bucket).copy(a.storage_path, para);
        if (copia.error) continue;
        const { error: e2 } = await db().from("foto_modelo_imagens").insert({
          modelo_id: novo.id,
          papel: "vista",
          vista: a.vista,
          storage_bucket: bucket,
          storage_path: para,
          mime: a.mime,
          largura: a.largura,
          altura: a.altura,
          sha256: a.sha256,
          motor_id: a.motor_id,
          qualidade: a.qualidade,
          resolucao: a.resolucao,
          seed: a.seed,
          prompt: a.prompt,
          fontes: Array.isArray(a.fontes) ? a.fontes : [],
          derivada_de: a.id,
          conferencia: a.conferencia,
          aprovada: true,
          versao_modelo: 1,
          gerada: true,
          custo_usd: 0,
          avisos: avisosRestaurados(a.avisos),
          criado_por: ch.userId,
        });
        if (e2) {
          await db().storage.from(bucket).remove([para]).catch(() => null);
          continue;
        }
        copiadas++;
      }
      if (aprovadas.length > copiadas) avisos.push(`${aprovadas.length - copiadas} ${aprovadas.length - copiadas === 1 ? "vista não foi copiada" : "vistas não foram copiadas"}; gere de novo no clone novo.`);
      if (copiadas) novo = await atualizarStatus(novo);
    }
    avisos.push(`Mesmas fotos de origem e a mesma autorização de ${autorizacao.quem} (${autorizacao.data}).`);
    return f.json({ clone: { ...novo, autorizacao_valida: autorizacaoValida(novo.autorizacao) }, copiadas, avisos, custo_usd: 0 });
  }

  // ---------------------------------------------------------------- variações pelo contexto do cliente

  const ESQUEMA_SUGESTOES = {
    nome: "variacoes_do_clone",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["negocio", "sugestoes"],
      properties: {
        negocio: { type: "string" },
        sugestoes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rotulo", "roupa", "cenario", "pose", "expressao", "luz", "enquadramento", "porque"],
            properties: {
              rotulo: { type: "string" },
              roupa: { type: "string" },
              cenario: { type: "string" },
              pose: { type: "string" },
              expressao: { type: "string" },
              luz: { type: "string" },
              enquadramento: { type: "string", enum: ["close", "meio_corpo", "corpo_inteiro"] },
              porque: { type: "string" },
            },
          },
        },
      },
    },
  };

  const SISTEMA_SUGESTOES = `Você é o diretor de fotografia da agência Aceleriq. A equipe tem o CLONE de uma pessoa real do cliente (com autorização de uso de imagem) e quer novas fotos dela coerentes com o NEGÓCIO do cliente.
Leia o contexto do cliente (o que ele faz, serviços, público, tom, marca, campanha) e entenda o papel da pessoa no negócio (ex.: jardineiro de uma empresa de paisagismo, dentista de uma clínica, dona de uma confeitaria).
Sugira variações de foto que contem esse trabalho de forma real e atual: a pessoa trabalhando, atendendo, com as ferramentas certas, no ambiente certo, em momentos de marca.
- negocio: uma frase com o que o cliente faz e o papel da pessoa.
- Cada sugestão: rotulo curto (2 a 4 palavras), roupa, cenario, pose, expressao, luz, enquadramento (close, meio_corpo ou corpo_inteiro) e porque (uma frase: para que post ou anúncio serve).
- Variações diferentes de verdade entre si (cenário, ação, enquadramento e luz).
- Roupa de trabalho real e profissional; sem logotipo de terceiros; sem texto.
- NUNCA mude rosto, idade, corpo, tom de pele ou cabelo da pessoa; sem sensualidade; sem parecer celebridade.
- Estética atual: luz natural com direção, ambientes reais e bonitos, nada de banco de imagem.
Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  async function cloneVariacoesSugerir(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    if (!f.contextoDoCliente) throw new ErroDeRegra(503, "contexto_indisponivel", "O contexto do cliente não está disponível nesta função.");
    const quantidade = Math.max(2, Math.min(8, Math.floor(Number(corpo.quantidade) || 6)));
    const pedido = limpo(corpo.pedido, 600);
    if (pedido) garantirPermitidoNoClone(pedido);
    const [contexto, diretor] = await Promise.all([f.contextoDoCliente(c.client_id, corpo.campanha_id, corpo.marca_id), f.modeloDeTexto("diretor_arte", corpo.modelo_id_texto)]);
    const saida = await chamarTexto({
      clientId: c.client_id,
      tarefa: "estudio",
      agente: "diretor_arte",
      modeloId: diretor.id,
      sistema: SISTEMA_SUGESTOES,
      mensagens: [{
        papel: "usuario",
        conteudo: `Sugira ${quantidade} variações de foto para a pessoa "${c.nome}".${c.invariantes.length ? ` Traços que não mudam: ${c.invariantes.join("; ")}.` : ""}
${JSON.stringify({ cliente: contexto.dados, campanha: contexto.campanha, pedido_da_equipe: pedido || null })}`,
      }],
      esquemaJson: ESQUEMA_SUGESTOES,
      maxTokensSaida: 3_000,
      timeoutMs: 300_000,
      referencia: { tipo: REF_CLONE, id: c.id },
      criadoPor: ch.userId,
    });
    const bruto = (saida.json ?? {}) as Record<string, unknown>;
    const { sugestoes, descartadas } = normalizarSugestoesDeVariacao(bruto, quantidade);
    return f.json({
      negocio: limpo(bruto.negocio, 300),
      sugestoes,
      avisos: descartadas ? [`${descartadas} ${descartadas === 1 ? "sugestão saiu" : "sugestões saíram"} por mudar a identidade ou fugir das regras do clone.`] : [],
      campanha_mesa: contexto.campanha,
      custo_usd: saida.custoUsd,
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
    });
  }

  // ---------------------------------------------------------------- transferir para outro cliente

  /**
   * clone_transferir { modelo_id, client_id_destino }: o clone foi criado no
   * cliente errado (pedido do dono, 26/09: "criei na Stop Informática por
   * engano, era da Verzelo"). Move a persona, a folha (arquivos), as fotos
   * reais e as variações do acervo, com os arquivos no Storage para a pasta
   * do cliente novo; atualiza client_id em tudo e registra no clone. Foto
   * que outra coisa do cliente antigo usa (derivada que fica, kit, Canvas,
   * outro clone) vira CÓPIA no destino (a antiga fica). Custo e uso já
   * cobrados ficam no cliente antigo. Só quem acessa os dois clientes.
   * Arquivos: copia primeiro, grava o banco e só então apaga os antigos; se
   * o banco falhar no meio, desfaz o que deu (sem apagar nada do antigo).
   */
  async function cloneTransferir(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const destino = idDe(corpo.client_id_destino, "client_id_destino");
    const origem = c.client_id;
    if (destino === origem) throw new ErroDeRegra(409, "mesmo_cliente", "O clone já é deste cliente.");
    await f.garantirAcesso(ch, destino);

    // 1) O que vai junto: fotos reais, variações (ativas ou não) e a folha.
    const [reais, folha, variacoesLidas] = await Promise.all([
      f.lerImagens(origem, c.identidade_real.map((r) => r.imagem_id)),
      imagensDaFolha(c.id),
      db().from("cliente_imagens").select(f.camposImagem).eq("client_id", origem).contains("tags", [`clone:${c.id}`]).limit(1000)
        .then((r) => (r.data as unknown as ImagemDoAcervoLida[] | null) ?? []),
    ]);
    const acervo: ImagemDoAcervoLida[] = [];
    for (const i of [...reais, ...variacoesLidas]) if (!acervo.some((x) => x.id === i.id)) acervo.push(i);
    const ids = acervo.map((i) => i.id);

    // 2) O que prende uma foto no cliente antigo (vira cópia).
    const presas = new Set<string>();
    if (ids.length) {
      const [filhas, refs, kits, canvas, outrosClones] = await Promise.all([
        db().from("cliente_imagens").select("id, derivada_de").eq("client_id", origem).in("derivada_de", ids).then((r) => (r.data as { id: string; derivada_de: string }[] | null) ?? []),
        db().from("foto_kit_refs").select("imagem_id").eq("client_id", origem).in("imagem_id", ids).then((r) => (r.data as { imagem_id: string }[] | null) ?? []),
        db().from("foto_kits").select("frente_imagem_id").eq("client_id", origem).in("frente_imagem_id", ids).then((r) => (r.data as { frente_imagem_id: string }[] | null) ?? []),
        db().from("foto_canvas_geracoes").select("imagem_id").eq("client_id", origem).in("imagem_id", ids).then((r) => (r.data as { imagem_id: string }[] | null) ?? [], () => []),
        db().from("foto_modelos").select("id, identidade_real").eq("client_id", origem).eq("origem", ORIGEM_CLONE).neq("id", c.id).then((r) => (r.data as { id: string; identidade_real: IdentidadeReal[] | null }[] | null) ?? []),
      ]);
      filhas.filter((x) => ids.indexOf(x.id) < 0).forEach((x) => presas.add(x.derivada_de));
      refs.forEach((x) => presas.add(x.imagem_id));
      kits.forEach((x) => presas.add(x.frente_imagem_id));
      canvas.forEach((x) => presas.add(x.imagem_id));
      outrosClones.forEach((o) => (Array.isArray(o.identidade_real) ? o.identidade_real : []).forEach((r) => presas.add(r.imagem_id)));
    }

    // 3) A mesma foto já no destino (sha256 único por cliente): não duplica.
    const shas = acervo.map((i) => i.sha256).filter((x): x is string => !!x);
    const noDestino: Record<string, string> = {};
    if (shas.length) {
      const { data } = await db().from("cliente_imagens").select("id, sha256").eq("client_id", destino).in("sha256", shas);
      ((data as { id: string; sha256: string }[] | null) ?? []).forEach((x) => (noDestino[x.sha256] = x.id));
    }
    const plano = planoDaTransferencia({
      origem,
      destino,
      imagens: acervo.map((i) => ({ id: i.id, storage_path: i.storage_path, sha256: i.sha256, derivada_de: i.derivada_de })),
      presas: Array.from(presas),
      noDestino,
    });
    const bucketDe = (id: string) => acervo.find((i) => i.id === id)?.storage_bucket || "mesa";

    // 4) Arquivos: copia tudo para a pasta do destino (os antigos ficam até o banco gravar).
    type Copia = { bucket: string; de: string; para: string };
    const arquivos: Copia[] = [
      ...plano.mover.map((m) => ({ bucket: bucketDe(m.id), de: m.de, para: m.para })),
      ...plano.copiar.map((m) => ({ bucket: bucketDe(m.id), de: m.de, para: m.para })),
      ...folha.map((i) => ({ bucket: i.storage_bucket || "mesa", de: i.storage_path, para: caminhoNoDestino(i.storage_path, origem, destino) })),
    ].filter((a) => a.de !== a.para);
    const copiados: Copia[] = [];
    const apagarCopias = () => Promise.all(copiados.map((a) => db().storage.from(a.bucket).remove([a.para]).catch(() => null)));
    for (const a of arquivos) {
      const { error } = await db().storage.from(a.bucket).copy(a.de, a.para);
      if (error && !/exist/i.test(String(error.message || ""))) {
        await apagarCopias();
        throw new ErroDeRegra(503, "transferencia_falhou", "Não foi possível copiar os arquivos para o cliente novo. Nada mudou; tente de novo.", { arquivo: a.de });
      }
      if (!error) copiados.push(a);
    }
    // O pedido de cada variação vai junto (sem ele, "Gerar de novo" usa a descrição); falha aqui não para a transferência.
    const pedidosAntigos = [...plano.mover, ...plano.copiar]
      .filter((m) => m.de !== m.para && m.de.indexOf("/foto/clones/") >= 0)
      .map((m) => ({ bucket: bucketDe(m.id), de: caminhoDoPedido(m.de), para: caminhoDoPedido(m.para), moveu: plano.mover.some((x) => x.id === m.id) }));
    for (const a of pedidosAntigos) {
      const { error } = await db().storage.from(a.bucket).copy(a.de, a.para);
      if (!error) copiados.push(a);
    }

    // 5) Banco (com desfazer se algo falhar no meio).
    const desfazer: (() => Promise<unknown>)[] = [];
    const falhou = async (etapa: string, erro: unknown) => {
      for (const d of desfazer.reverse()) await d().catch(() => null);
      await apagarCopias();
      throw new ErroDeRegra(503, "transferencia_falhou", `A transferência parou em ${etapa} e foi desfeita. Nada mudou no cliente antigo.`, { detalhe: String((erro as { message?: string })?.message ?? erro ?? "") });
    };
    const idDaCopia: Record<string, string> = {};
    try {
      // 5a) Cópias (a linha antiga fica no cliente antigo).
      for (const cp of plano.copiar) {
        const i = acervo.find((x) => x.id === cp.id)!;
        const { data, error } = await db().from("cliente_imagens").insert({
          client_id: destino,
          origem: i.origem,
          storage_bucket: i.storage_bucket,
          storage_path: cp.para,
          nome: i.nome,
          pasta: i.pasta,
          categoria: i.categoria,
          tags: Array.from(new Set([...(i.tags ?? []), `transferida_de:${origem}`])).slice(0, 30),
          descricao: i.descricao,
          derivada_de: null,
          gerada: i.gerada === true,
          modo: i.modo,
          kit_id: null,
          sha256: i.sha256,
          largura: i.largura,
          altura: i.altura,
          aprovada: i.aprovada === true,
        }).select("id").single();
        if (error || !data) throw error ?? new Error("cópia não gravada");
        const novoId = (data as { id: string }).id;
        idDaCopia[cp.id] = novoId;
        desfazer.push(async () => await db().from("cliente_imagens").delete().eq("id", novoId).eq("client_id", destino));
      }
      // 5b) Quem muda: linhagem solta, troca de cliente numa instrução só, depois caminho e linhagem no destino.
      const moverIds = plano.mover.map((m) => m.id);
      if (moverIds.length) {
        const antes = acervo.filter((i) => moverIds.indexOf(i.id) >= 0).map((i) => ({ id: i.id, derivada_de: i.derivada_de, storage_path: i.storage_path, kit_id: i.kit_id }));
        let r = await db().from("cliente_imagens").update({ derivada_de: null }).eq("client_id", origem).in("id", moverIds);
        if (r.error) throw r.error;
        desfazer.push(async () => {
          for (const a of antes) await db().from("cliente_imagens").update({ derivada_de: a.derivada_de }).eq("id", a.id);
        });
        r = await db().from("cliente_imagens").update({ client_id: destino, kit_id: null }).eq("client_id", origem).in("id", moverIds);
        if (r.error) throw r.error;
        desfazer.push(async () => {
          await db().from("cliente_imagens").update({ derivada_de: null }).in("id", moverIds);
          await db().from("cliente_imagens").update({ client_id: origem }).in("id", moverIds);
          for (const a of antes) await db().from("cliente_imagens").update({ storage_path: a.storage_path, kit_id: a.kit_id }).eq("id", a.id);
        });
        for (const m of plano.mover) {
          const alvo = m.derivada_de && m.derivada_de.indexOf("copia:") === 0 ? idDaCopia[m.derivada_de.slice(6)] ?? null : m.derivada_de;
          const u = await db().from("cliente_imagens").update({ storage_path: m.para, derivada_de: alvo }).eq("id", m.id).eq("client_id", destino);
          if (u.error) throw u.error;
        }
      }
      // 5c) Folha: só o caminho (a imagem é do clone, não do cliente).
      for (const i of folha) {
        const para = caminhoNoDestino(i.storage_path, origem, destino);
        if (para === i.storage_path) continue;
        const u = await db().from("foto_modelo_imagens").update({ storage_path: para }).eq("id", i.id);
        if (u.error) throw u.error;
        desfazer.push(async () => await db().from("foto_modelo_imagens").update({ storage_path: i.storage_path }).eq("id", i.id));
      }
    } catch (e) {
      await falhou("as fotos", e);
    }

    // 5d) O clone: cliente novo, identidade apontando para as fotos no destino e o registro da transferência.
    const novoIdDe = (id: string) => idDaCopia[id] ?? plano.reaproveitar.find((x) => x.id === id)?.destino_id ?? id;
    const registro = {
      de: origem,
      para: destino,
      por: ch.userId,
      em: new Date().toISOString(),
      movidas: plano.mover.length,
      copiadas: plano.copiar.length,
      reaproveitadas: plano.reaproveitar.length,
      folha: folha.length,
      custo_fica_no_cliente_antigo: true,
    };
    const etica = { ...(c.etica ?? {}), transferencias: [...(Array.isArray((c.etica ?? {} as Record<string, unknown>).transferencias) ? (c.etica as { transferencias: unknown[] }).transferencias : []), registro].slice(-10) };
    const { data: cloneNovo, error: erroClone } = await db().from("foto_modelos").update({
      client_id: destino,
      client_origem_id: destino,
      identidade_real: c.identidade_real.map((r) => ({ ...r, imagem_id: novoIdDe(r.imagem_id), client_id: destino, principal: r.principal })),
      etica,
    }).eq("id", c.id).select("*").single();
    if (erroClone || !cloneNovo) await falhou("o clone", erroClone);

    // 6) Só agora sai do cliente antigo: os arquivos antigos de quem mudou (as cópias deixam o original lá).
    const antigos = [
      ...plano.mover.filter((m) => m.de !== m.para).map((m) => ({ bucket: bucketDe(m.id), caminho: m.de })),
      ...folha.filter((i) => caminhoNoDestino(i.storage_path, origem, destino) !== i.storage_path).map((i) => ({ bucket: i.storage_bucket || "mesa", caminho: i.storage_path })),
    ];
    let naoApagados = 0;
    for (const a of antigos) {
      const { error } = await db().storage.from(a.bucket).remove([a.caminho]);
      if (error) naoApagados++;
    }
    for (const a of pedidosAntigos.filter((x) => x.moveu)) await db().storage.from(a.bucket).remove([a.de]).catch(() => null);
    const avisos: string[] = ["O custo e o uso de IA já cobrados continuam no cliente antigo."];
    if (plano.copiar.length) avisos.push(`${plano.copiar.length} ${plano.copiar.length === 1 ? "foto ficou também" : "fotos ficaram também"} no cliente antigo porque outra coisa de lá usa (kit, derivada, Canvas ou outro clone); no cliente novo entrou uma cópia.`);
    if (plano.reaproveitar.length) avisos.push(`${plano.reaproveitar.length} ${plano.reaproveitar.length === 1 ? "foto já existia" : "fotos já existiam"} no cliente novo: o clone passou a usar a de lá.`);
    if (naoApagados) avisos.push(`${naoApagados} ${naoApagados === 1 ? "arquivo antigo não saiu" : "arquivos antigos não saíram"} do Storage (o banco já aponta para o cliente novo).`);
    return f.json({
      clone: cloneNovo,
      resumo: { ...registro, arquivos_copiados: copiados.length },
      avisos,
      custo_usd: 0,
    });
  }

  // ---------------------------------------------------------------- conferência

  const ESQUEMA_LEITURA_CLONE = {
    nome: "leitura_do_clone",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["tracos", "impressao_geral", "espelhada", "artefatos", "resumo"],
      properties: {
        tracos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["traco", "nas_reais", "na_gerada"],
            properties: { traco: { type: "string", enum: [...TRACOS_DO_ROSTO] }, nas_reais: { type: "string" }, na_gerada: { type: "string" } },
          },
        },
        impressao_geral: { type: "string" },
        espelhada: { type: "string" },
        artefatos: { type: "array", items: { type: "string" } },
        resumo: { type: "string" },
      },
    },
  };

  const SISTEMA_LEITURA_CLONE = `Você é o conferente de identidade do estúdio da agência Aceleriq. A PRIMEIRA imagem é a foto gerada de uma pessoa real (com autorização de uso de imagem). As OUTRAS são fotos reais dessa pessoa: são a verdade.
Não identifique a pessoa e não diga quem ela é. Descreva, para cada traço (${TRACOS_DO_ROSTO.join(", ")}), como ele é nas fotos reais (nas_reais) e como está na foto gerada (na_gerada), em frases curtas e concretas: forma, tamanho, cor, posição, pintas e marcas do lado em que aparecem. Se o traço não aparece numa das imagens, diga "não aparece".
- impressao_geral: se, olhando tudo junto, parece a mesma pessoa ou outra, e por quê.
- espelhada: se pinta, tatuagem, repartição do cabelo ou assimetria aparecem do lado trocado na gerada ("não" se não).
- artefatos: deformações, mãos erradas, dentes estranhos, texto, marca d'água.
- resumo: uma frase.
Não julgue beleza. Português do Brasil, sem travessão. Responda só com o JSON pedido.`;

  async function imagemParaConferir(c: LinhaClone, imagemId: string, origem: string): Promise<{ bucket: string; caminho: string; tabela: "folha" | "acervo" }> {
    if (origem !== "acervo") {
      const { data } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).eq("modelo_id", c.id).maybeSingle();
      if (data) return { bucket: (data as LinhaImagemPersona).storage_bucket, caminho: (data as LinhaImagemPersona).storage_path, tabela: "folha" };
      if (origem === "folha") throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é da folha deste clone.");
    }
    const [a] = await f.lerImagens(c.client_id, [imagemId]);
    if (!a || !(a.tags ?? []).includes(`clone:${c.id}`)) throw new ErroDeRegra(404, "imagem_inexistente", "Esta imagem não é uma variação deste clone.");
    return { bucket: a.storage_bucket, caminho: a.storage_path, tabela: "acervo" };
  }

  async function cloneConferir(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    const alvo = await imagemParaConferir(c, imagemId, String(corpo.origem ?? ""));
    const reais = (await fotosReais(c)).sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).slice(0, 3);
    if (!reais.length) throw new ErroDeRegra(409, "sem_fotos_reais", "As fotos reais deste clone saíram do acervo.");
    const [gerada, ...fontes] = await Promise.all([
      f.baixarReduzida(alvo.bucket, alvo.caminho, 1280, "gerada"),
      ...reais.map((r) => f.baixarReduzida(r.storage_bucket, r.storage_path, 1024, `real-${r.nome}`)),
    ]);
    const leitor = await f.modeloDeTexto("leitura", corpo.modelo_id_leitura);
    const lido = await chamarTexto({
      clientId: c.client_id,
      tarefa: "verificacao",
      agente: "leitor",
      modeloId: leitor.id,
      sistema: SISTEMA_LEITURA_CLONE,
      mensagens: [{ papel: "usuario", conteudo: `Imagem 1 = foto gerada. Imagens 2 a ${fontes.length + 1} = fotos reais da mesma pessoa.${c.invariantes.length ? ` Traços anotados pela equipe: ${c.invariantes.join("; ")}.` : ""}`, imagens: [gerada, ...fontes] }],
      esquemaJson: ESQUEMA_LEITURA_CLONE,
      maxTokensSaida: 3_000,
      timeoutMs: f.timeoutTextoMs,
      referencia: { tipo: REF_CLONE, id: c.id },
      criadoPor: ch.userId,
    });
    const leitura: LeituraDoClone = normalizarLeituraDoClone(lido.json);
    let custo = lido.custoUsd;
    // Jev só como aviso: um Choice por traço (a foto real é a evidência, a gerada é a afirmação) e dois Noul.
    let notas: NotaDoTraco[] = [];
    let outra: number | null = null;
    let espelhada: number | null = null;
    let erroJev: string | null = null;
    try {
      const perguntas: Record<string, PerguntaJev> = {};
      leitura.tracos.forEach((t, k) => {
        perguntas[`traco_${t.traco}`] = {
          type: "choice",
          instructions: `Em \`comparacao.tracos[${k}]\`, o traço "${ROTULO_DO_TRACO[t.traco]}" está descrito nas fotos reais da pessoa (\`nas_reais\`, a verdade) e na foto gerada (\`na_gerada\`). Como o traço da foto gerada se relaciona com o das fotos reais?`,
          criteria: OPCOES_DO_TRACO,
        };
      });
      perguntas.outra_pessoa = {
        type: "noul",
        instructions: "Pelas descrições em `comparacao.tracos` e `comparacao.impressao_geral`, a foto gerada mostra OUTRA pessoa, e não a pessoa das fotos reais?",
        criteria: { true: "Sim: vários traços centrais (formato do rosto, olhos, nariz, lábios) diferem ou a impressão geral diz que é outra pessoa.", false: "Não: é a mesma pessoa, com diferenças pequenas de luz, ângulo, expressão, roupa ou cabelo." },
      };
      perguntas.espelhada = {
        type: "noul",
        instructions: "A descrição em `comparacao.espelhada` diz que pinta, tatuagem, repartição do cabelo ou assimetria do rosto aparecem do lado trocado na foto gerada?",
      };
      const res = await jevPerguntar({ state: { comparacao: leitura }, questions: perguntas });
      const cobrado = await cobrarJev(res, { clientId: c.client_id, tarefa: "verificacao", referencia: { tipo: REF_CLONE, id: c.id }, criadoPor: ch.userId });
      if (cobrado) custo += cobrado.custoUsd;
      notas = leitura.tracos.map((t) => {
        const r = res.answers[`traco_${t.traco}`];
        return { traco: t.traco, escolha: r?.choice ?? null, confianca: typeof r?.confidence === "number" ? r.confidence : null, probabilidades: r?.probabilities ?? null };
      });
      outra = probabilidadeNoul(res.answers.outra_pessoa);
      espelhada = probabilidadeNoul(res.answers.espelhada);
    } catch (e) {
      erroJev = e instanceof JevErro ? e.codigo : "jev_indisponivel";
    }
    const composto = alertasDoClone(notas, outra, espelhada);
    const conferencia = {
      leitura,
      tracos: notas,
      outra_pessoa: outra,
      espelhada,
      semelhanca: composto.semelhanca,
      alertas: [...composto.alertas, ...leitura.artefatos.slice(0, 3).map((a) => `Artefato: ${a}`)],
      conferir: composto.conferir,
      jev_erro: erroJev,
      comparada_com: reais.map((r) => r.id),
      modelo_id: lido.modeloId,
      conferida_em: new Date().toISOString(),
      custo_usd: arred6(custo),
      aviso: "Só aviso, sem biometria: a equipe compara e decide (sem refazer automático).",
    };
    if (alvo.tabela === "folha") await db().from("foto_modelo_imagens").update({ conferencia }).eq("id", imagemId);
    return f.json({ imagem_id: imagemId, conferencia, custo_usd: arred6(custo), saldo_usd: lido.saldoUsd });
  }

  // ---------------------------------------------------------------- pacote para vídeo

  /**
   * clone_pacote { modelo_id } -> { pacote }: o formato que a futura mesa de
   * vídeo vai ler (CLONES.md, seção "Pacote para vídeo"). URLs assinadas por
   * 1 hora; sem IA e sem custo.
   */
  async function clonePacote(ch: Chamador, corpo: Record<string, unknown>) {
    const c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    const [reais, todas] = await Promise.all([fotosReais(c), imagensDaFolha(c.id)]);
    const folha = ativasDa(todas);
    const aprovadas = folha.filter((i) => i.papel === "vista" && i.aprovada === true);
    const resumo = resumoDaFolhaDoClone(folha);
    const url = (b: string, p: string) => f.urlAssinada(b, p);
    const pacote = {
      formato: "aceleriq.clone.v1",
      clone: { id: c.id, client_id: c.client_id, nome: c.nome, versao: c.versao, status: c.status, pronto: resumo.pronto },
      autorizacao: { ...(c.autorizacao ?? {}), valida: autorizacaoValida(c.autorizacao) },
      identidade: {
        fotos_reais: await Promise.all(reais.map(async (r) => ({ imagem_id: r.id, principal: r.principal, largura: r.largura, altura: r.altura, url: await url(r.storage_bucket, r.storage_path) }))),
        ancora: c.ancora_imagem_id,
        folha: await Promise.all(aprovadas.map(async (a) => ({ imagem_id: a.id, vista: a.vista, largura: a.largura, altura: a.altura, motor_id: a.motor_id, feita_com_fotos_antigas: vistaDesatualizada(a, c.identidade_real), url: await url(a.storage_bucket, a.storage_path) }))),
        invariantes: c.invariantes,
        motor_preferido_id: c.motor_preferido_id,
      },
      video: {
        // Ordem sugerida por motor de vídeo (pesquisa de 25/09): frente primeiro, depois 3/4 e corpo.
        referencias_sugeridas: ["frente", "tres_quartos_esq", "tres_quartos_dir", "corpo_inteiro"].map((v) => aprovadas.find((a) => a.vista === v)?.id).filter(Boolean),
        limites_por_motor: { veo_3_1: 3, kling_3_elements: 4, runway_gen4: 3, seedance_2: "não aceita rosto de pessoa real no fluxo padrão" },
        orientacao: "No prompt do vídeo, descreva só ação e câmera (o rosto vem das referências); clipes de 5 a 10 s derivam menos.",
      },
      rotulo_de_ia: "Pessoa real recriada por IA com autorização. Ao publicar: rótulo de IA do Instagram/Meta; em anúncio, declarar conteúdo fotorrealista gerado.",
      gerado_em: new Date().toISOString(),
    };
    return f.json({ pacote, custo_usd: 0 });
  }

  // ---------------------------------------------------------------- estimativa

  async function estimarClones(ch: Chamador, corpo: Record<string, unknown>, alvo: string): Promise<Response> {
    const quantidade = Math.max(1, Math.min(16, Math.floor(Number(corpo.quantidade) || 1)));
    if (alvo === "clone_folha" || alvo === "clone_variacao") {
      let motorId = limpo(corpo.modelo_imagem_id, 160) || null;
      let refs = Math.min(MAX_IDENTIDADES_NO_GERADOR, Math.max(1, Math.floor(Number(corpo.fotos) || 3)));
      if (UUID.test(String(corpo.modelo_id ?? ""))) {
        const c = await cloneComAcesso(ch, String(corpo.modelo_id));
        motorId = c.motor_preferido_id || motorId;
        const folha = ativasDa(await imagensDaFolha(c.id));
        refs = Math.min(MAX_IDENTIDADES_NO_GERADOR, c.identidade_real.length + folha.filter((i) => i.aprovada === true).length);
      }
      const m = await carregarModelo(motorId || MOTOR_PADRAO_DO_CLONE.modelo_imagem_id, "imagem");
      const p = padraoDo(m);
      const uma = estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, p.qualidade), lerResolucao(corpo.resolucao) ?? p.resolucao, Math.max(1, refs));
      return f.json({ estimativa_usd: arred6(uma * quantidade), por_imagem_usd: uma, quantidade, modelo_imagem_id: m.id, custo_usd: 0 });
    }
    if (alvo === "clone_sugerir") {
      const diretor = await f.modeloDeTexto("diretor_arte");
      const uma = estimarComModelo(diretor, { tokensEntrada: 9_000, tokensSaida: 2_000 });
      return f.json({ estimativa_usd: arred6(uma), por_imagem_usd: uma, quantidade: 1, custo_usd: 0 });
    }
    if (alvo === "clone_conferir") {
      const leitor = await f.modeloDeTexto("leitura");
      const uma = estimarComModelo(leitor, { tokensEntrada: 4 * 1_600 + 1_500, tokensSaida: 1_800 });
      return f.json({ estimativa_usd: arred6(uma * quantidade), por_imagem_usd: uma, quantidade, custo_usd: 0 });
    }
    throw new ErroDeRegra(400, "alvo_invalido", "acao_alvo desconhecida para Clones.");
  }

  return {
    acoes: {
      clones_listar: clonesListar,
      clone_criar: cloneCriar,
      clone_ler: cloneLer,
      clone_editar: cloneEditar,
      clone_folha_gerar: cloneFolhaGerar,
      clone_imagem_decidir: cloneImagemDecidir,
      clone_variacao_gerar: cloneVariacaoGerar,
      clone_conferir: cloneConferir,
      clone_pacote: clonePacote,
      clone_variacoes_sugerir: cloneVariacoesSugerir,
      clone_transferir: cloneTransferir,
      clone_fotos_editar: cloneFotosEditar,
      clone_imagem_arquivar: cloneImagemArquivar,
      clone_variacao_refazer: cloneVariacaoRefazer,
      clone_duplicar: cloneDuplicar,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    estimar: estimarClones,
    // Para o Book (book.ts): a mesma variação, com as mesmas regras e a mesma autorização.
    cloneComAcesso,
    gerarVariacao,
    identidadesBaixadas,
  };
}

/** Ações de Clones que chamam IA ou baixam imagens (respondem com fôlego). */
export const ACOES_LONGAS_DE_CLONES = ["clone_folha_gerar", "clone_variacao_gerar", "clone_conferir", "clone_ler", "clones_listar", "clone_criar", "clone_pacote", "clone_variacoes_sugerir", "clone_transferir", "clone_fotos_editar", "clone_variacao_refazer", "clone_duplicar"];

/** Alvos que a ação estimar repassa para Clones. */
export const ALVOS_DE_ESTIMATIVA_DE_CLONES = ["clone_folha", "clone_variacao", "clone_conferir", "clone_sugerir"];
