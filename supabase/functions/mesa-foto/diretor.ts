import { resolverPastasCitadas, type PastaNomeada } from "./modulos/selecao-do-workspace.ts";
/**
 * Diretor de fotografia agêntico (pedido do dono, 26/09): banco,
 * armazenamento e execução. As regras puras (pacote com apelidos, propostas,
 * item a item, leitura guardada) ficam em diretor-agentico.ts.
 *
 * Ações (POST { acao, ... } na função mesa-foto):
 * - diretor_contexto { client_id, foco, campanha_id?, marca_id? } -> { resumo, foco_rotulo, contagens, sem_leitura, contexto }
 *   (sem IA, sem custo; cache curto no servidor). A tela chama ao abrir e ao trocar de cliente ou de etapa.
 * - diretor_executar_item { mensagem_id, acao_id, ref, marca_id? } -> { anexo, resultado, custo_usd }
 *   UMA foto da proposta paga (agente "diretor_geracao"), só depois do Confirmar com o custo à vista. A tela
 *   chama item por item; item já feito devolve o resultado guardado (nunca gera duas vezes).
 * - agente_conversar (index.ts) monta o pacote aqui (prepararConversa), lê por visão as fotos novas do pedido
 *   (uma vez por imagem, JSON em mesa/<cliente>/foto/leituras/) e devolve as propostas (propostasDaResposta).
 * - executar_acao_agente e desfazer_acao_agente (index.ts) chamam executarProposta e desfazerProposta para as
 *   propostas "diretor" (sem custo) e "diretor_geracao" (cancelar no meio e Desfazer = arquivar o gerado).
 *
 * Toda execução passa pelas ações que a Mesa Foto já tem, com o JWT de quem
 * confirmou (can_access_client e RLS valem como no clique da tela). A carteira
 * cobrada é a do cliente, pelo motor de IA, como em qualquer geração da mesa.
 *
 * Frente MF (27/09, "diretor que faz"): com ordem clara, sem custo e com
 * Desfazer, a proposta é feita na hora (executarDiretoDoDiretor, regra 6 do
 * contrato); toda proposta feita guarda o `caminho` (a área onde o resultado
 * está, já aberta no que foi feito). A foto entra num post de fotos na Agenda
 * (post_na_agenda, _shared/post-de-fotos.ts) e as fotos geradas com
 * agenda_das_fotos entram no post quando a última termina.
 */

import {
  type AcaoDoAgente,
  type AcaoGuardada,
  acaoGuardadaNaMensagem,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  ErroDaAcao,
  executarItemAItem,
  exigirEstado,
  type ItemDaAcaoDoAgente,
  type ResultadoDoItem,
  executarDireto,
  textoDoResultado,
} from "../_shared/acoes-do-agente.ts";
import { ehPostDeFotos, estadoDoPostDeFotos, podeTrocarAsFotos, prepararPostDeFotos } from "../_shared/post-de-fotos.ts";
import { criarItemDoPostDeFotos } from "../_shared/post-de-fotos-item.ts";
import { executarNoAcervo, reverterNoAcervo } from "../_shared/acoes-do-acervo.ts";
import { ErroDeRegra, UUID } from "./calculos.ts";
import { autorizacaoValida, ORIGEM_CLONE } from "./clones-regras.ts";
import type { Chamador, FerramentasDaMesa } from "./ferramentas.ts";
import {
  AGENTE_DE_GERACAO,
  AGENTE_SEM_CUSTO,
  aplicarCustos,
  cartaoDaFoto,
  caminhoDaLeitura,
  chamadaDaGeracao,
  chaveDoCusto,
  chaveDoFoco,
  comLeituras,
  comResultadoDoItem,
  criarCacheCurto,
  custoReal,
  emAndamento,
  type EntradaDoPacote,
  type FocoDoDiretor,
  idsDasLeituras,
  type ImagemBruta,
  type KitBruto,
  type LeituraGuardada,
  lerFoco,
  marcarAndamento,
  montarPacote,
  normalizarAcoesDoDiretor,
  normalizarGeracoesDoDiretor,
  normalizarLeitura,
  ordenarImagens,
  type PacoteDoDiretor,
  paraLer,
  pararGeracao,
  pastaDasLeituras,
  pedidoDoItem,
  resultadoDoItem,
  blocoDoPacote,
  caminhoDaAcaoDoDiretor,
  lerDestinoDoPost,
  type PostBruto,
  lerEnsaioPedido,
  lerFotosDoKit,
  lerNomeDoKit,
  CODIGO_DO_RECORTE_OU_AREA,
  comRecusaNosIrmaos,
  FRASE_DO_RECORTE_OU_AREA,
} from "./diretor-agentico.ts";
// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";

type Json = Record<string, unknown>;

/** Código da ação chamada por dentro (chamar de DepsDoDiretor), quando a ação respondeu com um. */
const codigoDaAcaoInterna = (e: unknown): string | null => {
  const c = e && typeof e === "object" ? (e as { codigoDaAcao?: unknown }).codigoDaAcao : null;
  return typeof c === "string" && c ? c : null;
};

export type DepsDoDiretor = {
  /** Chama uma ação da Mesa Foto que já existe (mesmo handler da tela) e devolve o corpo; erro vira exceção com a frase da ação. */
  chamar: (acao: string, ch: Chamador, corpo: Json) => Promise<Json>;
  /** Custo de uma foto no Preparar (cenário novo) com o gerador padrão. */
  custoDoPreparo: () => Promise<number | null>;
  /** Leitura por visão com o modelo de leitura do catálogo (paga, uma vez por imagem). */
  lerPorVisao: (ch: Chamador, clientId: string, img: ImagemBruta) => Promise<{ bruto: unknown; custo_usd: number }>;
  kitsDoCliente: (clientId: string) => Promise<KitBruto[]>;
  auditar: (entrada: {
    ch: Chamador;
    toolName: string;
    input: Json;
    success: boolean;
    durationMs: number;
    resultRef: string;
    /** FN-09: sem sucesso, o código e o motivo vão para a auditoria (antes ficavam nulos). */
    errorCode?: string | null;
    errorMessage?: string | null;
  }) => Promise<void>;
};

const CAMPOS_DA_IMAGEM = "id, nome, pasta, tags, ativa, aprovada, origem, gerada, modo, kit_id, descricao, criado_em, storage_bucket, storage_path";

const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDeRegra(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};

/** Contexto consolidado do cliente (a mesma leitura do diretor), com o resumo curto para a tela. */
type ContextoLido = { dados: Record<string, unknown>; cliente: string; campanha: { id: string; nome: string; papel: string } | null } | null;

export function acoesDoDiretor(f: FerramentasDaMesa, d: DepsDoDiretor) {
  const db = () => f.servico();
  // Pacote do cliente: 30 s (a tela manda de novo ao trocar de etapa); contexto consolidado: 2 min.
  const cacheDoPacote = criarCacheCurto<EntradaDoPacote>(30_000, 40);
  const cacheDoContexto = criarCacheCurto<ContextoLido>(120_000, 40);
  // Leitura em curso: a conversa e o pacote pedem o mesmo contexto ao mesmo tempo e o banco lê uma vez só.
  const contextoEmCurso = new Map<string, Promise<NonNullable<ContextoLido>>>();

  const esquecer = (clientId: string) => cacheDoPacote.esquecer(`${clientId}|`);

  // ---------------------------------------------------------------- contexto

  /** contextoDoCliente com cache curto (dossiê, marca, cérebro e campanha não mudam a cada mensagem). */
  async function contextoComCache(clientId: string, campanhaId?: unknown, marcaId?: unknown): Promise<NonNullable<ContextoLido>> {
    const chave = `${clientId}|${String(campanhaId ?? "")}|${String(marcaId ?? "")}`;
    const guardado = cacheDoContexto.ler(chave);
    if (guardado) return guardado;
    const emCurso = contextoEmCurso.get(chave);
    if (emCurso) return await emCurso;
    const ler = f.contextoDoCliente;
    if (!ler) throw new ErroDeRegra(503, "contexto_indisponivel", "O contexto do cliente não está disponível.");
    const promessa = ler(clientId, campanhaId, marcaId).then((c) => {
      const lido = { dados: c.dados, cliente: c.cliente, campanha: c.campanha };
      cacheDoContexto.gravar(chave, lido);
      return lido;
    });
    contextoEmCurso.set(chave, promessa);
    try {
      return await promessa;
    } finally {
      contextoEmCurso.delete(chave);
    }
  }

  const resumoDoContexto = (c: ContextoLido) => {
    if (!c) return null;
    const dados = c.dados || {};
    const marca = dados.marca as Record<string, unknown> | undefined;
    const temMarca = !!marca && (!!marca.estilo || (Array.isArray(marca.paleta) && marca.paleta.length > 0) || !!marca.tom_de_voz);
    return {
      marca: temMarca ? c.cliente || "marca" : null,
      cerebro: !!dados.cerebro_do_cliente || (Array.isArray(dados.memoria_do_diretor) && dados.memoria_do_diretor.length > 0),
      dossie: !!dados.dossie_atual,
      campanha: c.campanha ? c.campanha.nome : null,
    };
  };

  async function lista<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    try {
      const r = await p;
      return r.error ? [] : ((r.data as T[] | null) ?? []);
    } catch {
      return [];
    }
  }

  /**
   * Tudo o que o diretor precisa saber do cliente, sem IA: fotos ativas (as
   * marcadas e as do que está aberto primeiro), clones com a autorização,
   * modelos sintéticas, prompts, books, produtos, campanhas e as leituras
   * guardadas. O foco da tela só vale para o que é deste cliente.
   */
  async function entradaDoPacote(clientId: string, focoBruto: FocoDoDiretor, contexto: ContextoLido): Promise<EntradaDoPacote> {
    const chave = `${clientId}|${chaveDoFoco(focoBruto)}`;
    const guardada = cacheDoPacote.ler(chave);
    if (guardada) return guardada;
    const [imagens, clones, personas, prompts, books, kits, campanhas, pasta, posts] = await Promise.all([
      lista<ImagemBruta>(db().from("cliente_imagens").select(CAMPOS_DA_IMAGEM).eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(80)),
      lista<Json>(db().from("foto_modelos").select("id, nome, status, identidade_real, autorizacao").eq("client_id", clientId).eq("origem", ORIGEM_CLONE).neq("status", "arquivada").order("atualizado_em", { ascending: false }).limit(30)),
      lista<Json>(db().from("foto_modelos").select("id, nome, status").eq("client_id", clientId).neq("origem", ORIGEM_CLONE).neq("status", "arquivada").order("atualizado_em", { ascending: false }).limit(20)),
      lista<Json>(db().from("foto_biblioteca").select("id, titulo, categoria, client_id, prompt_pt, prompt_en, destaque").eq("tipo", "prompt").or(`client_id.is.null,client_id.eq.${clientId}`).order("destaque", { ascending: false }).limit(40)),
      lista<Json>(db().from("foto_books").select("id, nome, status, assunto").eq("client_id", clientId).neq("status", "arquivado").order("atualizado_em", { ascending: false }).limit(20)),
      d.kitsDoCliente(clientId).catch((e) => (registrarFalha("mesa-foto: kitsDoCliente falhou", e), [] as KitBruto[])),
      lista<Json>(db().from("mesa_campanhas").select("id, nome, status").eq("client_id", clientId).neq("status", "encerrada").order("criado_em", { ascending: false }).limit(20)),
      db().storage.from("mesa").list(pastaDasLeituras(clientId), { limit: 1000 }).then((r) => (r.data ?? []).map((o) => String(o.name)), () => [] as string[]),
      postsDeFotos(clientId),
    ]);
    const clonesLidos = clones.map((c) => {
      const v = autorizacaoValida(c.autorizacao as Record<string, unknown> | null);
      return {
        id: String(c.id),
        nome: String(c.nome || "Clone"),
        status: String(c.status || ""),
        identidade_real: Array.isArray(c.identidade_real) ? (c.identidade_real as { imagem_id: string; principal?: boolean }[]) : [],
        autorizacao_ok: v.ok,
        motivo_autorizacao: v.motivo,
      };
    });
    // O foco só vale para o que é deste cliente (id de outro cliente some em silêncio).
    const foco: FocoDoDiretor = {
      ...focoBruto,
      kit_id: focoBruto.kit_id && kits.some((k) => k.id === focoBruto.kit_id) ? focoBruto.kit_id : null,
      clone_id: focoBruto.clone_id && clonesLidos.some((c) => c.id === focoBruto.clone_id) ? focoBruto.clone_id : null,
      persona_id: focoBruto.persona_id && personas.some((p) => p.id === focoBruto.persona_id) ? focoBruto.persona_id : null,
      book_id: focoBruto.book_id && books.some((b) => b.id === focoBruto.book_id) ? focoBruto.book_id : null,
    };
    // Fotos do foco e fotos de origem dos clones que não vieram na lista das recentes.
    const conhecidas = new Set(imagens.map((i) => i.id));
    const faltam = foco.imagem_ids.concat(...clonesLidos.map((c) => c.identidade_real.map((r) => r.imagem_id))).filter((id) => UUID.test(String(id)) && !conhecidas.has(id));
    const extras = faltam.length ? await lista<ImagemBruta>(db().from("cliente_imagens").select(CAMPOS_DA_IMAGEM).eq("client_id", clientId).in("id", Array.from(new Set(faltam)).slice(0, 40))) : [];
    const todas = imagens.concat(extras);
    foco.imagem_ids = foco.imagem_ids.filter((id) => todas.some((i) => i.id === id));
    const faltamPrompts = foco.prompt_ids.filter((id) => !prompts.some((p) => p.id === id));
    const promptsExtras = faltamPrompts.length
      ? await lista<Json>(db().from("foto_biblioteca").select("id, titulo, categoria, client_id, prompt_pt, prompt_en").eq("tipo", "prompt").or(`client_id.is.null,client_id.eq.${clientId}`).in("id", faltamPrompts))
      : [];
    const lidasNoStorage = idsDasLeituras(pasta);
    // Leituras guardadas das fotos que vão primeiro no pacote (as outras ficam só marcadas como lidas).
    const primeiras = ordenarImagens(todas, foco, clonesLidos).slice(0, 16).filter((i) => lidasNoStorage.indexOf(i.id) >= 0);
    const baixadas = await f.emParalelo(primeiras, 6, async (i) => {
      try {
        const { data } = await db().storage.from("mesa").download(caminhoDaLeitura(clientId, i.id));
        return data ? [i.id, normalizarLeitura(JSON.parse(await data.text()))] as const : null;
      } catch {
        return null;
      }
    });
    const leituras: Record<string, LeituraGuardada> = {};
    baixadas.forEach((x) => {
      if (x && x[1]) leituras[x[0]] = x[1];
    });
    const entrada: EntradaDoPacote = {
      clientId,
      cliente: contexto ? contexto.cliente : "",
      foco,
      imagens: todas,
      clones: clonesLidos,
      prompts: prompts.concat(promptsExtras).map((p) => ({
        id: String(p.id),
        titulo: String(p.titulo || "Prompt"),
        categoria: (p.categoria as string) ?? null,
        client_id: (p.client_id as string) ?? null,
        prompt_pt: (p.prompt_pt as string) ?? null,
        prompt_en: (p.prompt_en as string) ?? null,
      })),
      books: books.map((b) => ({ id: String(b.id), nome: String(b.nome || "Book"), status: (b.status as string) ?? null, assunto: (b.assunto as { tipo?: string; id?: string; nome?: string }) ?? null })),
      kits,
      personas: personas.map((p) => ({ id: String(p.id), nome: String(p.nome || "Modelo"), status: (p.status as string) ?? null })),
      campanhas: campanhas.map((c) => ({ id: String(c.id), nome: String(c.nome || "Campanha"), status: (c.status as string) ?? null })),
      posts,
      leituras,
      lidasNoStorage,
      contexto: resumoDoContexto(contexto),
    };
    cacheDoPacote.gravar(chave, entrada);
    return entrada;
  }

  /** Posts de fotos da Agenda que ainda aceitam fotos (os que já foram para a aprovação ficam de fora). */
  async function postsDeFotos(clientId: string): Promise<PostBruto[]> {
    const trabalhos = await lista<Json>(db().from("estudio_trabalhos").select("id, task_id, status, entrega_status, cards, file_ids, legenda, direcao")
      .eq("client_id", clientId).not("task_id", "is", null).eq("direcao->>so_fotos", "true").order("atualizado_em", { ascending: false }).limit(20));
    const abertos = trabalhos.filter((t) => ehPostDeFotos(t.direcao) && podeTrocarAsFotos(t as { entrega_status?: string | null }));
    if (!abertos.length) return [];
    const tarefas = await lista<Json>(db().from("tasks").select("id, title, due_date, deleted_at").in("id", abertos.map((t) => String(t.task_id))));
    const porId = new Map(tarefas.filter((t) => !t.deleted_at).map((t) => [String(t.id), t]));
    return abertos
      .filter((t) => porId.has(String(t.task_id)))
      .map((t) => {
        const tarefa = porId.get(String(t.task_id)) as Json;
        return {
          trabalho_id: String(t.id),
          task_id: String(t.task_id),
          titulo: String(tarefa.title || "Post de fotos"),
          data: typeof tarefa.due_date === "string" ? tarefa.due_date.slice(0, 10) : null,
          fotos: Array.isArray(t.cards) ? t.cards.length : 0,
          estado: estadoDoPostDeFotos(t as Parameters<typeof estadoDoPostDeFotos>[0]).rotulo,
        };
      })
      .sort((a, b) => String(a.data || "9999").localeCompare(String(b.data || "9999")));
  }

  async function contextoSemFalhar(clientId: string, campanhaId?: unknown, marcaId?: unknown): Promise<ContextoLido> {
    try {
      return await contextoComCache(clientId, campanhaId, marcaId);
    } catch {
      return null;
    }
  }

  /** diretor_contexto: o pacote do cliente para a tela (resumo, sem id nem IA). */
  async function diretorContexto(ch: Chamador, corpo: Json) {
    const clientId = idDe(corpo.client_id, "client_id");
    await f.garantirAcesso(ch, clientId);
    const foco = lerFoco(corpo.foco);
    const contexto = await contextoSemFalhar(clientId, corpo.campanha_id, corpo.marca_id);
    const pacote = montarPacote(await entradaDoPacote(clientId, foco, contexto));
    return f.json({
      etapa: pacote.foco.etapa,
      resumo: pacote.resumo,
      foco_rotulo: pacote.foco_rotulo,
      contagens: pacote.contagens,
      sem_leitura: pacote.sem_leitura.length,
      contexto: pacote.contexto,
      gerado_em: new Date().toISOString(),
      custo_usd: 0,
    });
  }

  // ---------------------------------------------------------------- leitura por visão (uma vez por imagem)

  async function guardarLeitura(clientId: string, imagemId: string, leitura: LeituraGuardada) {
    const corpo = new Blob([JSON.stringify(leitura)], { type: "application/json" });
    // upsert false: a primeira leitura guardada vale (duas abas ao mesmo tempo não leem de novo).
    await db().storage.from("mesa").upload(caminhoDaLeitura(clientId, imagemId), corpo, { contentType: "application/json", upsert: false }).catch(() => null);
  }

  /**
   * Antes da conversa: o pacote do cliente e as leituras que faltam das fotos
   * do pedido (anexadas, marcadas e as variações novas do clone aberto), até 4.
   */
  async function prepararConversa(ch: Chamador, clientId: string, corpo: Json, anexos: string[]) {
    const focoBruto = corpo.foco && typeof corpo.foco === "object"
      ? lerFoco(corpo.foco)
      : lerFoco({ etapa: "acervo", kit_id: corpo.kit_id, ensaio_id: corpo.ensaio_id, imagem_ids: anexos });
    const contexto = await contextoSemFalhar(clientId, corpo.campanha_id, corpo.marca_id);
    let entrada = await entradaDoPacote(clientId, focoBruto, contexto);
    let pacoteEspecifico = !!corpo.pauta_id;
    let selecaoDaPasta: string[] | null = null;
    let avisoWorkspace = "";
    if (corpo.pauta_id) entrada = { ...entrada, posts: (entrada.posts || []).filter((p) => p.task_id === corpo.pauta_id) };
    // Explicit folder retrieval brings older Workspace photos into the bounded agent pack.
    const { data: pastas, error: erroPastas } = await db().from("workspace_nodes").select("id, name, parent_id").eq("client_id", clientId).eq("kind", "folder").limit(1000);
    if (erroPastas) { selecaoDaPasta = []; avisoWorkspace = "Não foi possível consultar as pastas do Workspace. Não diga que buscou ou selecionou fotos delas."; }
    if (!erroPastas) {
      const resolucao = resolverPastasCitadas(String(corpo.mensagem || ""), (pastas || []) as PastaNomeada[]);
      const ids = resolucao.ids;
      if (resolucao.estado === "ambigua") { selecaoDaPasta = []; avisoWorkspace = "A pasta citada é ambígua. Peça o caminho completo. Não selecione fotos de outra pasta."; }
      if (ids.length) {
        pacoteEspecifico = true;
        selecaoDaPasta = [];
        avisoWorkspace = "Use somente as fotos recuperadas da pasta citada. Se não houver fotos indexadas nela, informe isso sem selecionar outras.";
        const { data: nos, error: erroNos } = await db().from("workspace_nodes").select("id").eq("client_id", clientId).eq("kind", "file").in("parent_id", ids).limit(500);
        if (erroNos) throw new Error("Não foi possível ler a pasta pedida do Workspace.");
        if (nos?.length) {
          const { data: daPasta, error: erroFotos } = await db().from("cliente_imagens").select(CAMPOS_DA_IMAGEM).eq("client_id", clientId).eq("ativa", true).in("workspace_node_id", nos.map((n: { id: string }) => n.id)).order("nome").limit(60);
          if (erroFotos) throw new Error("Não foi possível carregar as fotos da pasta pedida.");
          const fotos = (daPasta || []) as ImagemBruta[];
          selecaoDaPasta = fotos.map((i) => i.id);
          entrada = { ...entrada, imagens: [...fotos, ...entrada.imagens.filter((i) => !fotos.some((f) => f.id === i.id))], foco: { ...entrada.foco, imagem_ids: [...fotos.map((i) => i.id), ...entrada.foco.imagem_ids].slice(0, 60) } };
        }
      }
    }
    let pacote = montarPacote(entrada);
    const faltam = paraLer(pacote, anexos);
    let custoLeituras = 0;
    const novas: Record<string, LeituraGuardada> = {};
    if (faltam.length) {
      const porId = new Map(entrada.imagens.map((i) => [i.id, i]));
      await f.emParalelo(faltam, 4, async (id) => {
        const img = porId.get(id);
        if (!img || !img.storage_path) return;
        try {
          const r = await d.lerPorVisao(ch, clientId, img);
          custoLeituras += Number(r.custo_usd) || 0;
          const leitura = normalizarLeitura(r.bruto);
          if (!leitura) return;
          novas[id] = leitura;
          await guardarLeitura(clientId, id, leitura);
        } catch (e) {
          // Sem leitura agora, a conversa segue com o que o acervo sabe (tenta de novo na próxima).
          console.warn("[mesa-foto] leitura do diretor falhou", { imagem_id: id, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      });
      if (Object.keys(novas).length) {
        entrada = comLeituras(entrada, novas);
        if (!pacoteEspecifico) cacheDoPacote.gravar(`${clientId}|${chaveDoFoco(focoBruto)}`, entrada);
        pacote = montarPacote(entrada);
      }
    }
    return { pacote, selecaoDaPasta, bloco: `${blocoDoPacote(pacote)}\n${avisoWorkspace}`, custoLeituras: Math.round(custoLeituras * 1e6) / 1e6, lidas: Object.keys(novas).length };
  }

  // ---------------------------------------------------------------- propostas

  async function custosDaGeracao(ch: Chamador, clientId: string, acao: AcaoDoAgente): Promise<Record<string, number | null>> {
    const pedidos = ((acao.contexto || {}) as Json).pedidos as Record<string, ReturnType<typeof pedidoDoItem>>;
    const chaves = new Map<string, NonNullable<ReturnType<typeof pedidoDoItem>>>();
    Object.keys(pedidos || {}).forEach((ref) => {
      const pd = pedidos[ref];
      if (pd && !chaves.has(chaveDoCusto(pd))) chaves.set(chaveDoCusto(pd), pd);
    });
    const saida: Record<string, number | null> = {};
    let preparo: number | null | undefined;
    await f.emParalelo(Array.from(chaves.entries()), 4, async ([chave, pd]) => {
      try {
        let v: number | null = null;
        if (pd.clone_id) {
          const r = await d.chamar("estimar", ch, { acao_alvo: "clone_variacao", modelo_id: pd.clone_id, quantidade: 1 });
          v = Number(r.estimativa_usd);
        } else if (pd.operacao === "variar_imagem" || pd.operacao === "melhorar_foto") {
          if (preparo === undefined) preparo = await d.custoDoPreparo();
          v = preparo;
        } else {
          const corpo: Json = { acao_alvo: "book_gerar", quantidade: 1, client_id: clientId };
          if (pd.operacao === "gerar_no_book") corpo.book_id = pd.alvo_id;
          const r = await d.chamar("estimar", ch, corpo);
          v = Number(r.estimativa_usd);
        }
        saida[chave] = typeof v === "number" && isFinite(v) ? v : null;
      } catch {
        saida[chave] = null;
      }
    });
    return saida;
  }

  /** As duas propostas da resposta: sem custo (confirma de uma vez) e de geração (confirma com o custo e vai item a item). */
  async function propostasDaResposta(ch: Chamador, r: Json, pacote: PacoteDoDiretor) {
    const acao = normalizarAcoesDoDiretor(r.acoes, pacote);
    let geracao = normalizarGeracoesDoDiretor(r.geracoes, pacote);
    if (geracao && geracao.itens.length) geracao = aplicarCustos(geracao, await custosDaGeracao(ch, pacote.client_id, geracao));
    return { acao, geracao };
  }

  // ---------------------------------------------------------------- execução sem custo

  type PostEmMontagem = { trabalhoId: string | null; taskId: string; titulo: string; formato: unknown; fotos: string[]; itemCriado: boolean };
  type EstadoDaExecucao = {
    canvas?: { id: string; versao: number; nome: string; nos: Json[]; ligacoes: Json[]; viewport: Json };
    /** Posts de fotos montados nesta proposta (um por destino). */
    posts?: Record<string, PostEmMontagem>;
    /** A proposta (para contar as fotos de cada post) e a chave do pedido (idempotência do item novo). */
    acao?: AcaoDoAgente;
    chave?: string;
  };

  /**
   * post_na_agenda: a foto entra no post (no fim, na ordem da lista). Post novo
   * nasce no item da Agenda da data pedida (o mesmo pedido não cria dois).
   * Nada é gerado e nada vai ao cliente: a legenda, a data e o envio ficam no post.
   */
  async function porNoPost(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente, estado: EstadoDaExecucao) {
    const destino = lerDestinoDoPost(item.para);
    if (!destino) throw new Error("O post da Agenda não foi entendido. Peça de novo dizendo o post ou a data.");
    const chave = String(item.para);
    estado.posts = estado.posts || {};
    let atual = estado.posts[chave];
    if (!atual) {
      if (destino.tipo === "post") {
        const { data } = await db().from("estudio_trabalhos").select("id, client_id, task_id, direcao, entrega_status").eq("id", destino.trabalho_id).maybeSingle();
        const t = data as { id: string; client_id: string; task_id: string | null; direcao: Json | null; entrega_status: string | null } | null;
        if (!t || t.client_id !== clientId || !t.task_id || !ehPostDeFotos(t.direcao)) throw new Error("Este post não está mais na Agenda.");
        if (!podeTrocarAsFotos(t)) throw new Error("O post já foi para a aprovação: as fotos só mudam depois da resposta do cliente.");
        const { data: tarefa } = await db().from("tasks").select("title").eq("id", t.task_id).maybeSingle();
        const fotos = ((((t.direcao || {}) as Json).fotos || {}) as Json).imagem_ids;
        atual = {
          trabalhoId: t.id,
          taskId: t.task_id,
          titulo: String((tarefa as Json | null)?.title || "Post de fotos"),
          formato: (t.direcao || {}).formato,
          fotos: Array.isArray(fotos) ? (fotos as string[]).filter((x) => UUID.test(String(x))) : [],
          itemCriado: false,
        };
      } else {
        const doMesmoPost = estado.acao ? estado.acao.itens.filter((i) => i.operacao === "post_na_agenda" && i.para === item.para).length : 1;
        const criado = await criarItemDoPostDeFotos(db(), {
          clientId,
          userId: ch.userId,
          titulo: destino.titulo,
          data: destino.data,
          carrossel: doMesmoPost > 1,
          pedidoId: `diretor:${(estado.chave || "x").slice(0, 40)}:${destino.data}`,
        });
        atual = { trabalhoId: null, taskId: criado.task_id, titulo: criado.title, formato: null, fotos: [], itemCriado: !criado.replayed };
      }
      estado.posts[chave] = atual;
    }
    if (atual.fotos.indexOf(item.alvo_id) < 0) atual.fotos.push(item.alvo_id);
    const r = await prepararPostDeFotos(db(), { clientId, taskId: atual.taskId, titulo: atual.titulo, formato: atual.formato, imagemIds: atual.fotos, userId: ch.userId, trabalhoId: atual.trabalhoId });
    atual.trabalhoId = r.trabalho.id;
    const recusada = r.recusadas.find((x) => x.id === item.alvo_id);
    if (recusada) throw new Error(recusada.motivo);
    return {
      desfazer: { trabalho_id: r.trabalho.id, task_id: atual.taskId, imagem_id: item.alvo_id, item_criado: atual.itemCriado },
      aviso: r.sem_aprovacao_da_equipe ? "Foto gerada: a equipe aprova antes de ir ao cliente." : undefined,
    };
  }

  /** Desfazer do post_na_agenda: a foto sai do post (o item da Agenda fica; sem fotos, o post volta a esperar as fotos). */
  async function tirarDoPost(ch: Chamador, clientId: string, x: Json) {
    const trabalhoId = String(x.trabalho_id || "");
    const imagem = String(x.imagem_id || "");
    if (!UUID.test(trabalhoId)) return;
    const { data } = await db().from("estudio_trabalhos").select("id, client_id, task_id, status, direcao, entrega_status").eq("id", trabalhoId).maybeSingle();
    const t = data as { id: string; client_id: string; task_id: string | null; status: string; direcao: Json | null; entrega_status: string | null } | null;
    if (!t || t.client_id !== clientId || !t.task_id) return;
    if (!podeTrocarAsFotos(t)) throw new Error("O post já foi para a aprovação: tire a foto na Mesa Foto depois da resposta do cliente.");
    const direcao = (t.direcao || {}) as Json;
    const antes = (((direcao.fotos || {}) as Json).imagem_ids as string[] | undefined) || [];
    const fotos = antes.filter((id) => id !== imagem);
    if (fotos.length) {
      const { data: tarefa } = await db().from("tasks").select("title").eq("id", t.task_id).maybeSingle();
      await prepararPostDeFotos(db(), { clientId, taskId: t.task_id, titulo: String((tarefa as Json | null)?.title || "Post de fotos"), formato: direcao.formato, imagemIds: fotos, userId: ch.userId, trabalhoId: t.id });
      return;
    }
    await db().from("estudio_trabalhos").update({ cards: [], status: "dirigido", direcao: { ...direcao, cards: [], fotos: { imagem_ids: [] } } }).eq("id", t.id);
  }

  const SAIDA_DO_CANVAS = "diretor_saida";

  async function levarAoCanvas(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente, estado: EstadoDaExecucao) {
    const [img] = await f.lerImagens(clientId, [item.alvo_id]);
    if (!img || img.ativa === false) throw new Error("A foto não está mais no acervo.");
    const tags = img.tags ?? [];
    const indice = estado.canvas ? estado.canvas.nos.length : 0;
    const cartao = cartaoDaFoto({ id: img.id, titulo: img.nome, dados: { pessoa_real: tags.indexOf("pessoa_real_autorizada") >= 0, kit_id: img.kit_id } }, indice);
    const ligacao = { id: `l_${cartao.id}`.slice(0, 64), de: cartao.id, para: SAIDA_DO_CANVAS, ordem: indice };
    let r: Json;
    if (!estado.canvas) {
      const hoje = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");
      r = await d.chamar("canvas_salvar", ch, {
        client_id: clientId,
        canvas: {
          nome: `Do diretor ${hoje}`,
          nos: [cartao, { id: SAIDA_DO_CANVAS, tipo: "saida", x: 460, y: 40, dados: { titulo: "Resultado", formato: "4:5" } }],
          ligacoes: [ligacao],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
    } else {
      const c = estado.canvas;
      r = await d.chamar("canvas_salvar", ch, {
        client_id: clientId,
        canvas: { id: c.id, nome: c.nome, nos: c.nos.concat([cartao]), ligacoes: c.ligacoes.concat([ligacao]), viewport: c.viewport },
        versao_esperada: c.versao,
      });
    }
    const salvo = (r.canvas || {}) as Json;
    estado.canvas = {
      id: String(salvo.id),
      versao: Number(salvo.versao),
      nome: String(salvo.nome || "Do diretor"),
      nos: Array.isArray(salvo.nos) ? (salvo.nos as Json[]) : [],
      ligacoes: Array.isArray(salvo.ligacoes) ? (salvo.ligacoes as Json[]) : [],
      viewport: (salvo.viewport as Json) || { x: 0, y: 0, zoom: 1 },
    };
    return { desfazer: { canvas_id: estado.canvas.id, no_id: cartao.id } };
  }

  async function tirarDoCanvas(ch: Chamador, clientId: string, canvasId: string, noId: string) {
    const { data } = await db().from("foto_canvas").select("id, client_id, nome, versao, nos, ligacoes, viewport").eq("id", canvasId).maybeSingle();
    const c = data as Json | null;
    if (!c || c.client_id !== clientId) return;
    const nos = (Array.isArray(c.nos) ? (c.nos as Json[]) : []).filter((n) => n.id !== noId);
    const ligacoes = (Array.isArray(c.ligacoes) ? (c.ligacoes as Json[]) : []).filter((l) => l.de !== noId && l.para !== noId);
    // Só sobrou o resultado vazio: o canvas vai para o arquivo (apagar é arquivar).
    const vazio = !nos.some((n) => n.id !== SAIDA_DO_CANVAS);
    await d.chamar("canvas_salvar", ch, { client_id: clientId, canvas: { id: canvasId, nome: c.nome, nos, ligacoes, viewport: c.viewport }, versao_esperada: c.versao, ...(vazio ? { arquivar: true } : {}) });
  }

  // ---------------------------------------------------------------- produto (kit) e ensaio (AG2, 29/09)

  const CAMPOS_DO_KIT = "id, client_id, tipo, nome, variante, atributos, invariantes, lacunas, autorizacao, frente_imagem_id, status";

  /** O kit como o kit_salvar recebe (o mesmo conjunto de fotos de agora), conferido contra o cliente. */
  async function kitParaSalvar(clientId: string, kitId: string): Promise<{ kit: Json; refs: Json[] }> {
    const { data, error } = await db().from("foto_kits").select(CAMPOS_DO_KIT).eq("id", kitId).maybeSingle();
    if (error) {
      registrarFalha("mesa-foto: produto não lido para o diretor", error, { kit_id: kitId });
      throw new Error("Não foi possível ler o produto agora.");
    }
    const k = data as Json | null;
    if (!k || k.client_id !== clientId) throw new Error("Produto não encontrado neste cliente.");
    const { data: refs, error: e2 } = await db().from("foto_kit_refs").select("imagem_id, papel, vista, prioridade").eq("kit_id", kitId);
    if (e2) {
      registrarFalha("mesa-foto: fotos do produto não lidas para o diretor", e2, { kit_id: kitId });
      throw new Error("Não foi possível ler as fotos do produto.");
    }
    const { client_id: _c, ...kit } = k;
    return { kit, refs: ((refs as Json[] | null) ?? []).map((r) => ({ imagem_id: r.imagem_id, papel: r.papel, vista: r.vista ?? null, prioridade: r.prioridade ?? 100 })) };
  }

  async function salvarKit(ch: Chamador, clientId: string, kit: Json, refs: Json[]) {
    await d.chamar("kit_salvar", ch, { client_id: clientId, kit, refs });
  }

  async function executarNoKit(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer?: Json | null; aviso?: string }> {
    const atual = await kitParaSalvar(clientId, item.alvo_id);
    if (item.operacao === "renomear_kit") {
      const n = lerNomeDoKit(item.para);
      if (!n) throw new Error("O nome novo do produto não foi entendido.");
      await salvarKit(ch, clientId, { ...atual.kit, nome: n.nome, variante: n.variante }, atual.refs);
      return { desfazer: { nome: atual.kit.nome, variante: atual.kit.variante ?? null } };
    }
    const novas = lerFotosDoKit(item.para);
    if (!novas.length) throw new Error("As fotos novas do produto não foram entendidas.");
    const refs = novas.map((r) => {
      const antes = atual.refs.find((x) => x.imagem_id === r.imagem_id && x.papel === r.papel);
      return { imagem_id: r.imagem_id, papel: r.papel, vista: antes ? antes.vista : null, prioridade: antes ? antes.prioridade : 100 };
    });
    await salvarKit(ch, clientId, atual.kit, refs);
    return { desfazer: { refs: atual.refs, frente_imagem_id: atual.kit.frente_imagem_id ?? null } };
  }

  async function reverterNoKit(ch: Chamador, clientId: string, r: ResultadoDoItem) {
    const x = (r.desfazer || {}) as Json;
    const atual = await kitParaSalvar(clientId, r.alvo_id);
    if (r.operacao === "renomear_kit") {
      await salvarKit(ch, clientId, { ...atual.kit, nome: x.nome, variante: x.variante ?? null }, atual.refs);
      return;
    }
    const refs = Array.isArray(x.refs) ? (x.refs as Json[]) : [];
    if (!refs.length) return;
    await salvarKit(ch, clientId, { ...atual.kit, frente_imagem_id: x.frente_imagem_id ?? null }, refs);
  }

  /** Monta e salva o ensaio do produto SEM gerar (o mesmo caminho do cartão "Só montar o ensaio"). */
  async function montarEnsaio(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente): Promise<{ desfazer: Json; aviso?: string }> {
    const e = lerEnsaioPedido(item.para);
    if (!e) throw new Error("Diga se é variações ou campanha, e quantas fotos.");
    const titulo = `${e.tipo === "campanha" ? "Campanha" : "Variações"} de ${item.titulo}`.slice(0, 160);
    const sugestao: Json = e.tipo === "campanha"
      ? { tipo: "campanha", titulo, motivo: "Montado pelo diretor a pedido da equipe.", kit_id: item.alvo_id, quantidade: e.quantidade, fotos: [] }
      : { tipo: "plano_de_variacoes", titulo, motivo: "Montado pelo diretor a pedido da equipe.", kit_id: item.alvo_id, quantidade: e.quantidade, variacoes: [] };
    const r = await d.chamar("agente_aplicar", ch, { client_id: clientId, kit_id: item.alvo_id, sugestao });
    const ensaio = (r.ensaio || {}) as Json;
    if (!ensaio.id) throw new Error("O ensaio não voltou salvo.");
    const estimativa = Number(r.estimativa_usd);
    const n = Array.isArray(ensaio.tomadas) ? (ensaio.tomadas as unknown[]).length : e.quantidade;
    return {
      desfazer: { ensaio_id: String(ensaio.id), tipo: e.tipo },
      aviso: `Ensaio salvo com ${n} ${n === 1 ? "foto" : "fotos"}${isFinite(estimativa) && estimativa > 0 ? `; gerar custa ~US$ ${estimativa.toFixed(2)}` : ""}. Nada foi gerado: confirme a geração na etapa.`,
    };
  }

  /** Desfazer do montar_ensaio: o ensaio vai para o arquivo (apagar é arquivar; o que já foi gerado fica no acervo). */
  async function arquivarEnsaio(clientId: string, x: Json) {
    const id = String(x.ensaio_id || "");
    if (!UUID.test(id)) return;
    const { error } = await db().from("foto_ensaios").update({ status: "arquivado" }).eq("id", id).eq("client_id", clientId);
    if (error) {
      registrarFalha("mesa-foto: ensaio não arquivado no Desfazer", error, { ensaio_id: id });
      throw new Error("O ensaio não foi arquivado.");
    }
  }

  async function executarSemCusto(ch: Chamador, clientId: string, item: ItemDaAcaoDoAgente, estado: EstadoDaExecucao): Promise<{ desfazer?: Json | null; aviso?: string } | void> {
    switch (item.operacao) {
      case "renomear_kit":
      case "fotos_do_kit":
        return await executarNoKit(ch, clientId, item);
      case "montar_ensaio":
        return await montarEnsaio(ch, clientId, item);
      case "aprovar_e_enviar": {
        const [img] = await f.lerImagens(clientId, [item.alvo_id]);
        if (!img || img.ativa === false) throw new Error("A foto não está mais no acervo.");
        const jaAprovada = !!img.aprovada;
        if (!jaAprovada) await d.chamar("acervo_decidir", ch, { client_id: clientId, imagem_id: img.id, decisao: "aprovar" });
        await d.chamar("enviar", ch, { client_id: clientId, imagem_ids: [img.id], destino: "arquivos" });
        return jaAprovada ? { aviso: "já estava aprovada; foi para Arquivos" } : { desfazer: { aprovada: false } };
      }
      case "fotos_do_clone": {
        const { data } = await db().from("foto_modelos").select("id, client_id, identidade_real").eq("id", item.alvo_id).maybeSingle();
        const c = data as { id: string; client_id: string; identidade_real: { imagem_id: string; principal?: boolean }[] | null } | null;
        if (!c || c.client_id !== clientId) throw new Error("Clone não encontrado neste cliente.");
        const antes = Array.isArray(c.identidade_real) ? c.identidade_real : [];
        const principal = (antes.find((r) => r.principal) || antes[0] || { imagem_id: null }).imagem_id;
        const novas = String(item.para || "").split(",").filter((x) => UUID.test(x));
        await d.chamar("clone_fotos_editar", ch, { modelo_id: c.id, imagem_ids: novas, ...(principal && novas.indexOf(principal) >= 0 ? { principal_id: principal } : {}) });
        return { desfazer: { imagem_ids: antes.map((r) => r.imagem_id), principal_id: principal } };
      }
      case "montar_book": {
        const tipo = /^c\d/.test(item.ref) ? "clone" : /^k\d/.test(item.ref) ? "produto" : "persona";
        const r = await d.chamar("book_criar", ch, { client_id: clientId, assunto: { tipo, id: item.alvo_id }, nome: String(item.para || "") });
        const book = (r.book || {}) as Json;
        return { desfazer: { book_id: String(book.id || "") } };
      }
      case "levar_ao_canvas":
        return await levarAoCanvas(ch, clientId, item, estado);
      case "post_na_agenda":
        return await porNoPost(ch, clientId, item, estado);
      case "abrir_no_estudio": {
        // Só o caminho: a foto abre no Estúdio de fotos com a ferramenta pedida (nada muda, nada a desfazer).
        const [img] = await f.lerImagens(clientId, [item.alvo_id]);
        if (!img || img.ativa === false) throw new Error("A foto não está mais no acervo.");
        return;
      }
      default:
        return await executarNoAcervo(db(), clientId, item);
    }
  }

  async function reverterSemCusto(ch: Chamador, clientId: string, r: ResultadoDoItem) {
    const x = (r.desfazer || {}) as Json;
    switch (r.operacao) {
      case "renomear_kit":
      case "fotos_do_kit":
        await reverterNoKit(ch, clientId, r);
        return;
      case "montar_ensaio":
        await arquivarEnsaio(clientId, x);
        return;
      case "aprovar_e_enviar":
        // A cópia em Arquivos fica (é registro do envio); a aprovação volta.
        if (x.aprovada === false) await d.chamar("acervo_decidir", ch, { client_id: clientId, imagem_id: r.alvo_id, decisao: "rejeitar" });
        return;
      case "fotos_do_clone": {
        const ids = Array.isArray(x.imagem_ids) ? (x.imagem_ids as string[]) : [];
        if (!ids.length) return;
        await d.chamar("clone_fotos_editar", ch, { modelo_id: r.alvo_id, imagem_ids: ids, ...(x.principal_id ? { principal_id: x.principal_id } : {}) });
        return;
      }
      case "montar_book":
        if (x.book_id) await d.chamar("book_salvar", ch, { book_id: x.book_id, status: "arquivado" });
        return;
      case "levar_ao_canvas":
        if (x.canvas_id && x.no_id) await tirarDoCanvas(ch, clientId, String(x.canvas_id), String(x.no_id));
        return;
      case "post_na_agenda":
        await tirarDoPost(ch, clientId, x);
        return;
      case "abrir_no_estudio":
        return;
      default:
        await reverterNoAcervo(db(), clientId, r);
    }
  }

  // ---------------------------------------------------------------- execução paga (item a item)

  /** O book do produto aberto (o mais recente aberto; sem ele, cria um "Book de <produto>"). */
  async function bookDoProduto(ch: Chamador, clientId: string, kitId: string): Promise<string> {
    if (!UUID.test(kitId)) throw new Error("Abra o produto (kit) para gerar com este prompt.");
    const { data } = await db().from("foto_books").select("id").eq("client_id", clientId).eq("status", "aberto").eq("assunto->>tipo", "produto").eq("assunto->>id", kitId)
      .order("atualizado_em", { ascending: false }).limit(1);
    const achado = ((data as { id: string }[] | null) ?? [])[0];
    if (achado) return achado.id;
    const r = await d.chamar("book_criar", ch, { client_id: clientId, assunto: { tipo: "produto", id: kitId } });
    const book = (r.book || {}) as Json;
    if (!book.id) throw new Error("Não foi possível abrir o book do produto.");
    return String(book.id);
  }

  async function executarGeracao(ch: Chamador, clientId: string, acao: AcaoDoAgente, item: ItemDaAcaoDoAgente, marcaId: string | null) {
    const pd = pedidoDoItem(acao, item.ref);
    if (!pd) throw new Error("O pedido desta foto não foi guardado. Peça de novo ao diretor.");
    let bookId: string | null = pd.operacao === "gerar_no_book" ? pd.alvo_id : null;
    if (pd.operacao === "gerar_do_prompt") bookId = await bookDoProduto(ch, clientId, String(pd.kit_id || ""));
    // AG2: o que a equipe ensinou a EVITAR (guardado na proposta) vai no pedido de cada foto.
    const evitar = ((acao.contexto || {}) as Json).evitar;
    const chamada = chamadaDaGeracao(pd, clientId, { bookId, marcaId, evitar: Array.isArray(evitar) ? (evitar as string[]) : null });
    const r = await d.chamar(chamada.acao, ch, chamada.corpo);
    const imagem = (r.imagem || {}) as Json;
    if (!imagem.id) throw new Error("A foto não voltou do gerador.");
    const avisos = Array.isArray(r.avisos) ? (r.avisos as string[]) : [];
    return {
      desfazer: {
        imagem_id: String(imagem.id),
        clone_id: pd.clone_id,
        book_id: bookId,
        custo_usd: Number(r.custo_usd) || 0,
      },
      aviso: avisos.length ? String(avisos[0]).slice(0, 300) : undefined,
    };
  }

  async function reverterGeracao(clientId: string, r: ResultadoDoItem) {
    const x = (r.desfazer || {}) as Json;
    const imagemId = String(x.imagem_id || "");
    if (!UUID.test(imagemId)) return;
    // Desfazer a geração é arquivar a foto nova (apagar é arquivar; o arquivo fica).
    await executarNoAcervo(db(), clientId, { ref: r.ref, alvo_id: imagemId, titulo: r.titulo, detalhe: null, operacao: "arquivar_foto", rotulo: "arquivar", para: null });
  }

  const comoErro = (e: unknown) => (e instanceof ErroDaAcao ? new ErroDeRegra(e.status, e.codigo, e.message) : e);

  async function guardadaDoDiretor(ch: Chamador, corpo: Json, agente?: string): Promise<AcaoGuardada> {
    try {
      return await acaoGuardadaNaMensagem(db(), corpo.mensagem_id, (clientId) => f.garantirAcesso(ch, clientId), { acaoId: corpo.acao_id, agente });
    } catch (e) {
      throw comoErro(e);
    }
  }

  async function avisarNaConversa(g: AcaoGuardada, texto: string) {
    if (!g.mensagem.conversa_id) return;
    // AG2: a linha do resultado não some calada (o erro do insert vai para o log).
    try {
      const { error } = await db().from("agente_mensagens").insert({ conversa_id: g.mensagem.conversa_id, client_id: g.mensagem.client_id, papel: "sistema", conteudo: texto, anexos: [] });
      if (error) registrarFalha("mesa-foto: resultado do diretor não gravado na conversa", error, { mensagem_id: g.mensagem.id });
    } catch (e) {
      registrarFalha("mesa-foto: resultado do diretor não gravado na conversa", e, { mensagem_id: g.mensagem.id });
    }
  }

  /** diretor_executar_item: UMA foto da proposta paga (a tela chama item por item). */
  async function diretorExecutarItem(ch: Chamador, corpo: Json) {
    const inicio = Date.now();
    const g = await guardadaDoDiretor(ch, corpo, AGENTE_DE_GERACAO);
    const clientId = g.mensagem.client_id;
    const ref = String(corpo.ref ?? "").trim().toLowerCase();
    const item = g.acao.itens.find((i) => i.ref === ref);
    if (!item) throw new ErroDeRegra(404, "item_inexistente", "Esta foto não está na lista confirmada.");
    // Já feito: devolve o que foi guardado (nunca gera duas vezes nem cobra de novo).
    const ja = resultadoDoItem(g.acao, ref);
    if (ja) return f.json({ anexo: g.acao, resultado: ja, repetido: true, custo_usd: 0 });
    try {
      exigirEstado(g.acao, "confirmar");
    } catch (e) {
      throw comoErro(e);
    }
    if (emAndamento(g.acao, ref)) throw new ErroDeRegra(409, "item_em_andamento", "Esta foto já está sendo gerada. Espere terminar.");
    await g.gravar(marcarAndamento(g.acao, ref));
    const marcaId = typeof corpo.marca_id === "string" && UUID.test(corpo.marca_id) ? corpo.marca_id : null;
    // FN-05: guarda o código da recusa (executarItemAItem só conserva o motivo).
    const falha = { codigo: null as string | null };
    const [resultado] = await executarItemAItem([item], async (it) => {
      try {
        return await executarGeracao(ch, clientId, g.acao, it, marcaId);
      } catch (e) {
        falha.codigo = codigoDaAcaoInterna(e);
        throw e;
      }
    }, 1);
    // Relê antes de gravar: outra aba pode ter cancelado no meio.
    const atual = await guardadaDoDiretor(ch, corpo, AGENTE_DE_GERACAO);
    let comResultado = comResultadoDoItem(atual.acao, resultado, ch.userId);
    // FN-05: a mesma foto sem recorte nem área dá a mesma recusa nos outros itens dela (nada foi cobrado).
    if (!resultado.ok && (falha.codigo === CODIGO_DO_RECORTE_OU_AREA || resultado.motivo === FRASE_DO_RECORTE_OU_AREA)) {
      comResultado = comRecusaNosIrmaos(comResultado, resultado, ch.userId);
    }
    let anexo = await atual.gravar(comResultado);
    esquecer(clientId);
    // Frente MF: terminou a lista. As fotos novas entram no post da Agenda pedido e o caminho fica pronto.
    if (anexo.executada_em && !anexo.caminho) anexo = await fecharGeracao(ch, clientId, atual, anexo);
    const custo = resultado.ok && resultado.desfazer ? Number(resultado.desfazer.custo_usd) || 0 : 0;
    if (anexo.executada_em) await avisarNaConversa(atual, `Geração: ${textoDoResultado(anexo.resultados || [])}. Custo real US$ ${custoReal(anexo).toFixed(4)}.`);
    await d.auditar({
      ch,
      toolName: "foto_geracao_do_diretor",
      input: { client_id: clientId, mensagem_id: g.mensagem.id, ref, operacao: item.operacao, custo_usd: custo },
      success: resultado.ok,
      durationMs: Date.now() - inicio,
      resultRef: g.mensagem.id,
      errorCode: resultado.ok ? null : falha.codigo || "item_falhou",
      errorMessage: resultado.ok ? null : resultado.motivo || null,
    });
    return f.json({ anexo, resultado, custo_usd: custo });
  }

  /** Fim da geração: as fotos novas entram no post pedido (agenda_das_fotos) e a proposta ganha o caminho. */
  async function fecharGeracao(ch: Chamador, clientId: string, g: AcaoGuardada, anexo: AcaoDoAgente): Promise<AcaoDoAgente> {
    const contexto = { ...(anexo.contexto || {}) } as Json;
    const destino = typeof contexto.agenda_das_fotos === "string" ? contexto.agenda_das_fotos : "";
    const novas = (anexo.resultados || []).filter((r) => r.ok && r.desfazer && UUID.test(String(r.desfazer.imagem_id || ""))).map((r) => String((r.desfazer as Json).imagem_id));
    if (destino && novas.length && !contexto.post_da_agenda) {
      try {
        const estado: EstadoDaExecucao = { chave: g.mensagem.id };
        let ultimo: Json | null = null;
        for (const id of novas) {
          const r = await porNoPost(ch, clientId, { ref: id.slice(0, 8), alvo_id: id, titulo: "foto nova", detalhe: null, operacao: "post_na_agenda", rotulo: "pôr no post", para: destino }, estado);
          ultimo = (r.desfazer || null) as Json | null;
        }
        if (ultimo) contexto.post_da_agenda = { trabalho_id: ultimo.trabalho_id, task_id: ultimo.task_id, fotos: novas.length };
      } catch (e) {
        contexto.post_da_agenda_aviso = e instanceof Error ? e.message.slice(0, 300) : "As fotos não entraram no post.";
      }
    }
    const comContexto = { ...anexo, contexto };
    const caminho = caminhoDaAcaoDoDiretor(comContexto, clientId, contexto.abrir_sozinho === true);
    return await g.gravar({ ...comContexto, caminho });
  }

  /**
   * Frente MF, regra 6 ("ele já vai fazendo"): faz a proposta sem custo na
   * hora e devolve o anexo já feito, com o Desfazer de sempre e o caminho.
   * Quem chama já conferiu a ordem clara (Jev) e podeExecutarDireto.
   */
  async function executarDiretoDoDiretor(ch: Chamador, clientId: string, acao: AcaoDoAgente, opcoes: { chave: string; abrirSozinho: boolean }): Promise<AcaoDoAgente> {
    const inicio = Date.now();
    const estado: EstadoDaExecucao = { acao, chave: opcoes.chave };
    const feita = await executarDireto(acao, (item) => executarSemCusto(ch, clientId, item, estado), { userId: ch.userId, lote: 1 });
    esquecer(clientId);
    const falhas = (feita.resultados || []).filter((r) => !r.ok).length;
    const primeiraFalha = (feita.resultados || []).find((r) => !r.ok);
    await d.auditar({
      ch,
      toolName: "foto_acao_do_diretor_na_hora",
      input: { client_id: clientId, operacoes: feita.itens.map((i) => i.operacao) },
      success: falhas === 0,
      durationMs: Date.now() - inicio,
      resultRef: opcoes.chave,
      errorCode: primeiraFalha ? "item_falhou" : null,
      errorMessage: primeiraFalha ? primeiraFalha.motivo || null : null,
    });
    return { ...feita, caminho: caminhoDaAcaoDoDiretor(feita, clientId, opcoes.abrirSozinho) };
  }

  /** executar_acao_agente para as propostas do diretor: sem custo executa tudo; geração só cancela (vai item a item). */
  async function executarProposta(ch: Chamador, corpo: Json, g: AcaoGuardada) {
    const clientId = g.mensagem.client_id;
    const inicio = Date.now();
    try {
      exigirEstado(g.acao, "confirmar");
    } catch (e) {
      throw comoErro(e);
    }
    if (g.acao.agente === AGENTE_DE_GERACAO) {
      if (corpo.descartar !== true) throw new ErroDeRegra(409, "gerar_item_a_item", "A geração vai uma foto por vez: confirme no cartão do diretor.");
      const anexo = await g.gravar(pararGeracao(g.acao, ch.userId));
      return f.json({ anexo });
    }
    const estado: EstadoDaExecucao = { acao: g.acao, chave: g.mensagem.id };
    let r: { anexo: AcaoDoAgente; resultados: ResultadoDoItem[] };
    try {
      // Lote de 1: fotos da mesma campanha, do mesmo clone, do mesmo canvas ou do mesmo post não se atropelam.
      r = await confirmarAcaoGuardada(g, (item) => executarSemCusto(ch, clientId, item, estado), { descartar: corpo.descartar === true, userId: ch.userId, lote: 1 });
    } catch (e) {
      throw comoErro(e);
    }
    if (corpo.descartar === true) return f.json({ anexo: r.anexo });
    esquecer(clientId);
    // Frente MF: a proposta feita guarda o caminho (a área onde o resultado está).
    const caminho = caminhoDaAcaoDoDiretor(r.anexo, clientId, ((r.anexo.contexto || {}) as Json).abrir_sozinho === true);
    if (caminho) r = { ...r, anexo: await g.gravar({ ...r.anexo, caminho }) };
    const feitos = r.resultados.filter((x) => x.ok).length;
    const falhas = r.resultados.length - feitos;
    const primeiraFalha = r.resultados.find((x) => !x.ok);
    await avisarNaConversa(g, `Diretor: ${textoDoResultado(r.resultados)}.`);
    await d.auditar({
      ch,
      toolName: "foto_acao_do_diretor",
      input: { client_id: clientId, mensagem_id: g.mensagem.id, operacoes: r.anexo.itens.map((i) => i.operacao) },
      success: falhas === 0,
      durationMs: Date.now() - inicio,
      resultRef: g.mensagem.id,
      errorCode: primeiraFalha ? "item_falhou" : null,
      errorMessage: primeiraFalha ? primeiraFalha.motivo || null : null,
    });
    return f.json({ anexo: r.anexo, feitos, falhas, canvas_id: estado.canvas ? estado.canvas.id : null });
  }

  /** desfazer_acao_agente para as propostas do diretor: volta o que mudou e arquiva o que foi gerado. */
  async function desfazerProposta(ch: Chamador, _corpo: Json, g: AcaoGuardada) {
    const clientId = g.mensagem.client_id;
    const inicio = Date.now();
    let r: { anexo: AcaoDoAgente; voltaram: number; falharam: Array<{ ref: string; titulo: string; motivo: string }> };
    try {
      r = await desfazerAcaoGuardada(
        g,
        (x) => (g.acao.agente === AGENTE_DE_GERACAO ? reverterGeracao(clientId, x) : reverterSemCusto(ch, clientId, x)),
        { userId: ch.userId },
      );
    } catch (e) {
      throw comoErro(e);
    }
    esquecer(clientId);
    await d.auditar({
      ch,
      toolName: g.acao.agente === AGENTE_DE_GERACAO ? "foto_desfazer_geracao_do_diretor" : "foto_desfazer_acao_do_diretor",
      input: { client_id: clientId, mensagem_id: g.mensagem.id },
      success: r.falharam.length === 0,
      durationMs: Date.now() - inicio,
      resultRef: g.mensagem.id,
    });
    return f.json({ anexo: r.anexo, voltaram: r.voltaram, falharam: r.falharam });
  }

  const ehDoDiretor = (a: AcaoDoAgente) => a.agente === AGENTE_SEM_CUSTO || a.agente === AGENTE_DE_GERACAO;

  return {
    acoes: {
      diretor_contexto: diretorContexto,
      diretor_executar_item: diretorExecutarItem,
    } as Record<string, (ch: Chamador, corpo: Json) => Promise<Response>>,
    contextoComCache,
    prepararConversa,
    propostasDaResposta,
    executarProposta,
    desfazerProposta,
    executarDiretoDoDiretor,
    ehDoDiretor,
    esquecer,
  };
}

export const ACOES_LONGAS_DO_DIRETOR = ["diretor_executar_item", "diretor_contexto"];
