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
 * - estimar aceita acao_alvo clone_folha, clone_variacao e clone_conferir.
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
import { arred6, dimensoesDaImagem, ErroDeRegra, extensaoDe, limpo, limpoOuNulo, listaDeTextos, mimeDe, nomeSeguro, sha256Hex, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa, ImagemDoAcervoLida } from "./ferramentas.ts";
import { estimativaDeUmaImagem, type LinhaImagemPersona } from "./modelos.ts";
import { lerSemente, lerVista, type VistaDaPersona } from "./personas.ts";
import {
  alertasDoClone,
  autorizacaoValida,
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

const REF_CLONE = "foto_clone";
const LADO_IDENTIDADE = 1280;
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
const MIGRATION = "a migration 04 (docs/mesa-foto/migrations/04_clones.sql) foi aplicada?";

type IdentidadeReal = { imagem_id: string; client_id: string; principal: boolean };

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

  async function imagensDaFolha(id: string): Promise<LinhaImagemPersona[]> {
    const { data, error } = await db().from("foto_modelo_imagens").select("*").eq("modelo_id", id).order("criado_em", { ascending: true }).limit(300);
    if (error) throw new ErroDeRegra(503, "clones_indisponivel", "Não foi possível ler a folha do clone.");
    return (data as LinhaImagemPersona[] | null) ?? [];
  }

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

  const comUrl = async <T extends { storage_bucket: string; storage_path: string }>(i: T) => ({ ...i, url: await f.urlAssinada(i.storage_bucket, i.storage_path) });

  async function atualizarStatus(c: LinhaClone, imagens?: LinhaImagemPersona[]): Promise<LinhaClone> {
    const lista = imagens ?? (await imagensDaFolha(c.id));
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

  /** Fotos reais e vistas aprovadas que vão ao gerador, já baixadas, com a legenda de cada uma. */
  async function identidadesBaixadas(c: LinhaClone, vista: VistaDaPersona | null, m: ModeloIa): Promise<{ fontes: FonteDeIdentidade[]; imagens: ImagemEntrada[] }> {
    const [reais, folha] = await Promise.all([fotosReais(c), imagensDaFolha(c.id)]);
    if (!reais.length) throw new ErroDeRegra(409, "sem_fotos_reais", "As fotos reais deste clone saíram do acervo. Escolha as fotos de novo.");
    const aprovadas = folha.filter((i) => i.papel === "vista" && i.aprovada === true);
    const limite = Math.min(limiteDeReferencias(m) || MAX_IDENTIDADES_NO_GERADOR, MAX_IDENTIDADES_NO_GERADOR);
    const fontes = identidadesDoClone(
      reais.map((r) => ({ id: r.id, tipo: "real" as const, vista: null, principal: r.principal })),
      aprovadas.map((a) => ({ id: a.id, tipo: "folha" as const, vista: a.vista })),
      vista,
      limite,
    );
    const imagens = await f.emParalelo(fontes, 3, (fo) => {
      if (fo.tipo === "real") {
        const r = reais.find((x) => x.id === fo.id)!;
        return f.baixarReduzida(r.storage_bucket, r.storage_path, LADO_IDENTIDADE, `real-${r.nome}`);
      }
      const a = aprovadas.find((x) => x.id === fo.id)!;
      return f.baixarReduzida(a.storage_bucket, a.storage_path, LADO_IDENTIDADE, `folha-${a.vista ?? "vista"}`);
    });
    return { fontes, imagens };
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
    if (corpo.incluir_arquivados !== true) q = q.neq("status", "arquivada");
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
    const ids = lerFotosReais(corpo.imagem_ids);
    const achadas = await f.lerImagens(clientId, ids);
    const faltando = ids.filter((id) => !achadas.some((a) => a.id === id));
    if (faltando.length) throw new ErroDeRegra(404, "imagem_fora_do_cliente", "Há foto que não está no acervo deste cliente.", { imagem_ids: faltando });
    const geradas = achadas.filter((a) => a.gerada === true || (a.tags ?? []).includes("referencia_web"));
    if (geradas.length) {
      throw new ErroDeRegra(422, "foto_nao_e_real", "O clone nasce só de fotos REAIS da pessoa: foto gerada por IA ou da internet não vira identidade.", { imagem_ids: geradas.map((g) => g.id) });
    }
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
      identidade_real: ids.map((id) => ({ imagem_id: id, client_id: clientId, principal: id === principalPedido })),
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
    const [reais, folha, variacoes] = await Promise.all([fotosReais(c), imagensDaFolha(c.id), variacoesDoClone(c)]);
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
      imagens: await f.emParalelo(folha, 6, comUrl),
      folha: resumoDaFolhaDoClone(folha),
      variacoes: await f.emParalelo(variacoes.slice(0, 60), 6, comUrl),
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
      patch.status = statusDoClone("rascunho", await imagensDaFolha(c.id));
    }
    if (!Object.keys(patch).length) return f.json({ clone: c, avisos, custo_usd: 0 });
    const { data, error } = await db().from("foto_modelos").update(patch).eq("id", c.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar o clone.");
    return f.json({ clone: data, avisos, custo_usd: 0 });
  }

  async function cloneFolhaGerar(ch: Chamador, corpo: Record<string, unknown>) {
    let c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    const vista = lerVista(corpo.vista);
    if (!vista || !FOLHA_DO_CLONE.includes(vista)) throw new ErroDeRegra(400, "vista_invalida", `Vista inválida. Use: ${FOLHA_DO_CLONE.join(", ")}.`);
    const m = await motorDaChamada(c, corpo.modelo_imagem_id);
    const p = padraoDo(m);
    const { fontes, imagens } = await identidadesBaixadas(c, vista, m);
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
    const linha = data as LinhaImagemPersona;
    return f.json({ imagem: await comUrl(linha), url: await f.urlAssinada(linha.storage_bucket, linha.storage_path), clone: c, folha: resumoDaFolhaDoClone(todas), ...respostaDaGeracao(saida) });
  }

  async function cloneImagemDecidir(ch: Chamador, corpo: Record<string, unknown>) {
    const imagemId = idDe(corpo.imagem_id, "imagem_id");
    const { data: achada, error: e0 } = await db().from("foto_modelo_imagens").select("*").eq("id", imagemId).maybeSingle();
    if (e0) throw new ErroDeRegra(503, "clones_indisponivel", "Não foi possível ler a imagem.");
    if (!achada) throw new ErroDeRegra(404, "imagem_inexistente", "Imagem do clone não encontrada.");
    const img = achada as LinhaImagemPersona;
    const c = await cloneComAcesso(ch, img.modelo_id);
    const decisao = String(corpo.decisao ?? "");
    if (decisao !== "aprovar" && decisao !== "rejeitar") throw new ErroDeRegra(400, "decisao_invalida", "decisao: aprovar ou rejeitar.");
    // Uma vista aprovada por posição: aprovar outra da mesma vista tira a aprovação da anterior.
    if (decisao === "aprovar" && img.vista) {
      await db().from("foto_modelo_imagens").update({ aprovada: null }).eq("modelo_id", c.id).eq("papel", "vista").eq("vista", img.vista).eq("aprovada", true).neq("id", img.id);
    }
    const { data, error } = await db().from("foto_modelo_imagens").update({ aprovada: decisao === "aprovar", motivo: limpoOuNulo(corpo.motivo, 500) }).eq("id", img.id).select("*").single();
    if (error || !data) throw new ErroDeRegra(503, "gravacao_falhou", "Não foi possível gravar a decisão.");
    const todas = await imagensDaFolha(c.id);
    const atual = await atualizarStatus(c, todas);
    return f.json({ imagem: await comUrl(data as LinhaImagemPersona), clone: atual, folha: resumoDaFolhaDoClone(todas), custo_usd: 0 });
  }

  async function cloneVariacaoGerar(ch: Chamador, corpo: Record<string, unknown>) {
    let c = await cloneComAcesso(ch, idDe(corpo.modelo_id, "modelo_id"));
    garantirGeravel(c);
    const pedido = lerPedidoDeVariacao(corpo.pedido ?? corpo);
    const formato = lerFormatoDaVariacao(corpo.formato);
    const m = await motorDaChamada(c, corpo.modelo_imagem_id);
    const p = padraoDo(m);
    const vistaMaisPerto: VistaDaPersona = pedido.enquadramento === "corpo_inteiro" ? "corpo_inteiro" : pedido.enquadramento === "meio_corpo" ? "meio_corpo" : "frente";
    const { fontes, imagens } = await identidadesBaixadas(c, vistaMaisPerto, m);
    const prompt = promptDaVariacaoDoClone({ nome: c.nome, fontes, invariantes: c.invariantes, pedido, formato });
    const qualidade = lerQualidade(corpo.qualidade, p.qualidade);
    const resolucao = lerResolucao(corpo.resolucao) ?? p.resolucao;
    const saida = await chamarImagem({
      clientId: c.client_id,
      modeloId: m.id,
      prompt,
      referencias: imagens,
      qualidade,
      tamanho: FORMATOS_DA_VARIACAO[formato],
      resolucao,
      seed: lerSemente(corpo.seed),
      mesmoModelo: true,
      referencia: { tipo: REF_CLONE, id: c.id },
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
    const { data, error } = await db().from("cliente_imagens").insert({
      client_id: c.client_id,
      origem: "mesa_foto",
      storage_bucket: "mesa",
      storage_path: caminho,
      nome: `${c.nome} (variação${pedido.preset ? `: ${PRESETS_DE_VARIACAO.find((x) => x.id === pedido.preset)?.rotulo ?? pedido.preset}` : ""})`.slice(0, 160),
      pasta: "Mesa Foto / Clones",
      categoria: "pessoa",
      tags: Array.from(new Set(["mesa_foto", "gerada", "pessoa_real_autorizada", "clone_variacao", `clone:${c.id}`, "tipo:pessoa"])),
      descricao: `Pessoa real (${c.nome}) recriada por IA a partir de fotos reais, com autorização de uso de imagem de ${c.autorizacao?.data ?? "data registrada"} (${c.autorizacao?.finalidade ?? ""}). ${oQueMudou ? `Mudou: ${oQueMudou}. ` : ""}Motor ${saida.modeloId}. Ao publicar, ligue o rótulo de IA.`.slice(0, 1000),
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
    const url = await f.urlAssinada("mesa", caminho);
    return f.json({ imagem: { ...nova, url }, url, clone: c, pedido, ...respostaDaGeracao(saida) });
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
    const [reais, folha] = await Promise.all([fotosReais(c), imagensDaFolha(c.id)]);
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
        folha: await Promise.all(aprovadas.map(async (a) => ({ imagem_id: a.id, vista: a.vista, largura: a.largura, altura: a.altura, motor_id: a.motor_id, url: await url(a.storage_bucket, a.storage_path) }))),
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
        const folha = await imagensDaFolha(c.id);
        refs = Math.min(MAX_IDENTIDADES_NO_GERADOR, c.identidade_real.length + folha.filter((i) => i.aprovada === true).length);
      }
      const m = await carregarModelo(motorId || MOTOR_PADRAO_DO_CLONE.modelo_imagem_id, "imagem");
      const p = padraoDo(m);
      const uma = estimativaDeUmaImagem(m, lerQualidade(corpo.qualidade, p.qualidade), lerResolucao(corpo.resolucao) ?? p.resolucao, Math.max(1, refs));
      return f.json({ estimativa_usd: arred6(uma * quantidade), por_imagem_usd: uma, quantidade, modelo_imagem_id: m.id, custo_usd: 0 });
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
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
    estimar: estimarClones,
  };
}

/** Ações de Clones que chamam IA ou baixam imagens (respondem com fôlego). */
export const ACOES_LONGAS_DE_CLONES = ["clone_folha_gerar", "clone_variacao_gerar", "clone_conferir", "clone_ler", "clones_listar", "clone_criar", "clone_pacote"];

/** Alvos que a ação estimar repassa para Clones. */
export const ALVOS_DE_ESTIMATIVA_DE_CLONES = ["clone_folha", "clone_variacao", "clone_conferir"];
