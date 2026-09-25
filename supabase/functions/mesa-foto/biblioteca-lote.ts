/**
 * Biblioteca de prompts da Mesa Foto: limpar os exemplos do Openverse e gerar
 * o exemplo de cada prompt com o PRÓPRIO prompt (pedido do dono, 25/09: "as
 * fotos da biblioteca de prompt não têm nada a ver com o prompt"). As fotos
 * vieram do Openverse por busca de palavras e não mostram a direção do prompt.
 *
 * Só admin. Custo sempre à vista antes (biblioteca_exemplos_estimar) e uma
 * imagem por chamada (a tela chama de novo até acabar, com andamento; o que
 * já saiu fica salvo). A carteira cobrada é a do client_id que o admin passa.
 *
 * Ações:
 * - biblioteca_limpar_exemplos { modo?: 'openverse'|'nao_batem', confirmar?: boolean, client_id? }
 *     -> { modo, encontrados, limpos, itens[{ id, titulo, bate }], confirmado, custo_usd }
 *     Sem confirmar: só lista (prévia). 'nao_batem' pergunta ao Jev, pelo título e
 *     pela busca da foto, se ela mostra o que o prompt descreve (cobra o Jev no client_id).
 * - biblioteca_exemplos_estimar { client_id?, modelo_imagem_id?, qualidade?, refazer_gerados? }
 *     -> { pendentes, por_imagem_usd, total_usd, modelo_imagem_id, rotulo, qualidade }
 * - biblioteca_exemplo_proximo { client_id, item_id?, modelo_imagem_id?, qualidade?, refazer_gerados? }
 *     -> { item, url, custo_usd, saldo_usd, pendentes, acabou } (UMA imagem por chamada)
 */

import { carregarModelo, chamarImagem, cobrarJev, estimarComModelo, type ModeloIa, type Qualidade } from "../_shared/ia-motor.ts";
import { JevErro, jevPerguntar, probabilidadeNoul, type PerguntaJev } from "../_shared/jev.ts";
import { arred6, ErroDeRegra, limpo, promptDoExemplo, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa } from "./ferramentas.ts";
import { emPng } from "./imagem.ts";

const TAG_EXEMPLO_PUBLICO = "exemplo_banco_publico";
const TAG_EXEMPLO_GERADO = "exemplo_gerado";
const TAG_SEM_EXEMPLO = "exemplo_nao_encontrado";
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];
/** O Jev recebe os itens em blocos (uma chamada por bloco). */
const BLOCO_DO_JEV = 25;

/**
 * Gerador do exemplo: o mais barato com qualidade de topo (pesquisa de 25/09).
 * MAI-Image-2.6 está em 3º no ranking cego de texto para imagem da Artificial
 * Analysis (Elo 1147) a cerca de US$ 0,04 por imagem; o Seedream 4.5 (US$
 * 0,04) é a reserva; sem os dois, o padrão de imagem do catálogo.
 */
export const MOTORES_DO_EXEMPLO = ["openrouter:microsoft/mai-image-2.6", "openrouter:bytedance-seed/seedream-4.5"];
export const QUALIDADE_DO_EXEMPLO_EM_LOTE: Qualidade = "media";

type ItemLido = {
  id: string;
  client_id: string | null;
  tipo: string;
  categoria: string;
  titulo: string;
  prompt_pt: string | null;
  prompt_en: string | null;
  negativo: string | null;
  imagem_url: string | null;
  storage_path: string | null;
  fonte_nome: string | null;
  fonte_url: string | null;
  licenca: string | null;
  autor: string | null;
  tags: string[] | null;
  exemplo?: Record<string, unknown> | null;
  destaque: boolean;
};

/** Exemplo que veio do Openverse (banco público, por busca de palavras). */
export function exemploDoOpenverse(i: Pick<ItemLido, "tags" | "exemplo" | "fonte_nome" | "imagem_url">): boolean {
  if (!i.imagem_url) return false;
  const tags = i.tags ?? [];
  if (tags.includes(TAG_EXEMPLO_PUBLICO) || tags.some((t) => t.startsWith("openverse:"))) return true;
  if (i.exemplo && typeof i.exemplo === "object" && (i.exemplo as Record<string, unknown>).tipo === "banco_publico") return true;
  return /openverse/i.test(i.fonte_nome ?? "");
}

/** Item que ainda precisa do exemplo gerado pelo próprio prompt. */
export const precisaDeExemplo = (i: Pick<ItemLido, "tipo" | "tags" | "prompt_pt" | "prompt_en">, refazerGerados = false) =>
  i.tipo === "prompt" && !!(i.prompt_en || i.prompt_pt) && (refazerGerados || !(i.tags ?? []).includes(TAG_EXEMPLO_GERADO));

/** Campos que tiram o exemplo do Openverse e devolvem o crédito original do prompt. */
export function camposSemOpenverse(i: Pick<ItemLido, "tags" | "exemplo" | "fonte_nome" | "fonte_url" | "licenca" | "autor">): Record<string, unknown> {
  const origem = (i.exemplo && typeof i.exemplo === "object" ? (i.exemplo as Record<string, unknown>).prompt_origem : null) as Record<string, unknown> | null;
  const campos: Record<string, unknown> = {
    imagem_url: null,
    miniatura_url: null,
    exemplo: null,
    tags: (i.tags ?? []).filter((t) => t !== TAG_EXEMPLO_PUBLICO && t !== TAG_SEM_EXEMPLO && !t.startsWith("openverse:")),
  };
  if (origem && typeof origem === "object") {
    campos.fonte_nome = origem.fonte_nome ?? null;
    campos.fonte_url = origem.fonte_url ?? null;
    campos.licenca = origem.licenca ?? null;
    campos.autor = origem.autor ?? null;
  } else if (/openverse/i.test(i.fonte_nome ?? "")) {
    campos.fonte_nome = "Aceleriq (curadoria)";
    campos.fonte_url = null;
    campos.licenca = null;
    campos.autor = "Aceleriq (curadoria)";
  }
  return campos;
}

export function acoesDaBibliotecaEmLote(
  f: FerramentasDaMesa,
  d: {
    ehAdmin: (ch: Chamador) => Promise<boolean>;
    atualizarItemDaBiblioteca: (id: string, campos: Record<string, unknown>) => Promise<{ item: unknown; aviso: string | null }>;
    modeloDeImagem: (pedido?: unknown) => Promise<ModeloIa>;
  },
) {
  const db = () => f.servico();

  async function garantirAdmin(ch: Chamador) {
    if (!(await d.ehAdmin(ch))) throw new ErroDeRegra(403, "somente_admin", "Só admin mexe nos exemplos da biblioteca da agência.");
  }

  async function itensDaAgencia(): Promise<ItemLido[]> {
    const { data, error } = await db().from("foto_biblioteca").select("*").is("client_id", null).eq("tipo", "prompt").order("destaque", { ascending: false }).order("titulo").limit(1000);
    if (error) throw new ErroDeRegra(503, "biblioteca_indisponivel", "Não foi possível ler a biblioteca da agência.");
    return (data as ItemLido[] | null) ?? [];
  }

  const lerQualidade = (v: unknown): Qualidade => (QUALIDADES.includes(v as Qualidade) ? (v as Qualidade) : QUALIDADE_DO_EXEMPLO_EM_LOTE);

  /** O gerador pedido ou o mais barato de boa qualidade que estiver ativo. */
  async function motorDoExemplo(pedido: unknown): Promise<ModeloIa> {
    if (typeof pedido === "string" && pedido.trim()) return await carregarModelo(pedido.trim(), "imagem");
    for (const id of MOTORES_DO_EXEMPLO) {
      try {
        return await carregarModelo(id, "imagem");
      } catch {
        // próximo da lista
      }
    }
    return await d.modeloDeImagem();
  }

  const estimativaDoItem = (m: ModeloIa, q: Qualidade, i: Pick<ItemLido, "titulo" | "categoria" | "prompt_pt" | "prompt_en" | "negativo">) =>
    estimarComModelo(m, { imagens: 1, qualidade: q, tokensEntrada: Math.ceil(promptDoExemplo(i).length / 3.5), resolucao: null, imagensEntrada: 0, tamanho: "1024x1024" });

  /** Pergunta ao Jev, pelo que se sabe da foto (título e busca), se ela mostra o que o prompt descreve. */
  async function quaisBatem(ch: Chamador, clientId: string, itens: ItemLido[]): Promise<{ bate: Map<string, number | null>; custo: number; erro: string | null }> {
    const bate = new Map<string, number | null>();
    let custo = 0;
    let erro: string | null = null;
    for (let k = 0; k < itens.length; k += BLOCO_DO_JEV) {
      const bloco = itens.slice(k, k + BLOCO_DO_JEV);
      const estado = {
        itens: bloco.map((i) => {
          const ex = (i.exemplo && typeof i.exemplo === "object" ? i.exemplo : {}) as Record<string, unknown>;
          return {
            prompt: { titulo: i.titulo, categoria: i.categoria, descricao: limpo(i.prompt_pt || i.prompt_en, 400) },
            foto: { titulo_da_foto: limpo(ex.titulo_da_foto, 200) || null, busca_que_achou: limpo(ex.busca, 120) || null },
          };
        }),
      };
      const perguntas: Record<string, PerguntaJev> = {};
      bloco.forEach((_i, n) => {
        perguntas[`item_${n}`] = {
          type: "noul",
          instructions: `A foto de exemplo descrita em \`itens[${n}].foto\` (título da foto no banco público e a busca que a encontrou) mostra o assunto E a direção descritos em \`itens[${n}].prompt\` (mesmo tipo de produto ou cena, mesma luz, cenário e composição)?`,
          criteria: {
            true: "Sim: pelo título e pela busca, a foto mostra o mesmo tipo de assunto e de cena que o prompt descreve.",
            false: "Não: a foto é de outro assunto ou outra cena, ou o título não permite dizer que ela mostra o que o prompt descreve.",
          },
        };
      });
      try {
        const res = await jevPerguntar({ state: estado, questions: perguntas });
        const cobrado = await cobrarJev(res, { clientId, tarefa: "verificacao", referencia: { tipo: "foto_biblioteca", id: clientId }, criadoPor: ch.userId });
        if (cobrado) custo += cobrado.custoUsd;
        bloco.forEach((i, n) => bate.set(i.id, probabilidadeNoul(res.answers[`item_${n}`])));
      } catch (e) {
        erro = e instanceof JevErro ? e.codigo : "jev_indisponivel";
        bloco.forEach((i) => bate.set(i.id, null));
      }
    }
    return { bate, custo, erro };
  }

  async function bibliotecaLimparExemplos(ch: Chamador, corpo: Record<string, unknown>) {
    await garantirAdmin(ch);
    const modo = corpo.modo === "nao_batem" ? "nao_batem" : "openverse";
    const doOpenverse = (await itensDaAgencia()).filter(exemploDoOpenverse);
    let alvo = doOpenverse;
    let custo = 0;
    let aviso: string | null = null;
    let bate = new Map<string, number | null>();
    if (modo === "nao_batem" && doOpenverse.length) {
      const clientId = String(corpo.client_id ?? "").trim();
      if (!UUID.test(clientId)) throw new ErroDeRegra(400, "client_id_obrigatorio", "Para o Jev conferir quais não batem, diga em qual cliente cobrar (client_id). Ou limpe todos do Openverse, sem custo.");
      await f.garantirAcesso(ch, clientId);
      const r = await quaisBatem(ch, clientId, doOpenverse);
      bate = r.bate;
      custo = r.custo;
      if (r.erro) aviso = "O Jev não respondeu para parte dos itens: esses ficaram marcados como não conferidos e entram na limpeza.";
      // Só aviso de julgamento: abaixo de 0,5 (ou sem resposta) sai; a prévia mostra a probabilidade de cada um.
      alvo = doOpenverse.filter((i) => {
        const p = bate.get(i.id);
        return p == null || p < 0.5;
      });
    }
    const itens = alvo.map((i) => ({ id: i.id, titulo: i.titulo, categoria: i.categoria, imagem_url: i.imagem_url, bate: bate.has(i.id) ? bate.get(i.id) : null }));
    if (corpo.confirmar !== true) {
      return f.json({ modo, encontrados: doOpenverse.length, limpos: 0, a_limpar: itens.length, itens, confirmado: false, aviso, custo_usd: arred6(custo) });
    }
    let limpos = 0;
    for (const i of alvo) {
      const r = await d.atualizarItemDaBiblioteca(i.id, camposSemOpenverse(i));
      aviso = aviso ?? r.aviso;
      limpos++;
    }
    return f.json({ modo, encontrados: doOpenverse.length, limpos, a_limpar: 0, itens, confirmado: true, aviso, custo_usd: arred6(custo) });
  }

  async function bibliotecaExemplosEstimar(ch: Chamador, corpo: Record<string, unknown>) {
    await garantirAdmin(ch);
    const m = await motorDoExemplo(corpo.modelo_imagem_id);
    const q = lerQualidade(corpo.qualidade);
    const pendentes = (await itensDaAgencia()).filter((i) => precisaDeExemplo(i, corpo.refazer_gerados === true));
    const total = pendentes.reduce((s, i) => s + estimativaDoItem(m, q, i), 0);
    return f.json({
      pendentes: pendentes.length,
      por_imagem_usd: pendentes.length ? arred6(total / pendentes.length) : estimativaDoItem(m, q, { titulo: "", categoria: "produto", prompt_pt: "", prompt_en: "x".repeat(340), negativo: "" }),
      total_usd: arred6(total),
      modelo_imagem_id: m.id,
      rotulo: m.rotulo,
      qualidade: q,
      custo_usd: 0,
    });
  }

  async function bibliotecaExemploProximo(ch: Chamador, corpo: Record<string, unknown>) {
    await garantirAdmin(ch);
    const clientId = String(corpo.client_id ?? "").trim();
    if (!UUID.test(clientId)) throw new ErroDeRegra(400, "client_id_obrigatorio", "Diga em qual cliente cobrar a geração (client_id).");
    await f.garantirAcesso(ch, clientId);
    const refazer = corpo.refazer_gerados === true;
    const todos = await itensDaAgencia();
    const fila = todos.filter((i) => precisaDeExemplo(i, refazer));
    const pedido = UUID.test(String(corpo.item_id ?? "")) ? todos.find((i) => i.id === String(corpo.item_id)) ?? null : fila[0] ?? null;
    if (!pedido) return f.json({ item: null, url: null, pendentes: 0, acabou: true, custo_usd: 0 });
    if (!pedido.prompt_en && !pedido.prompt_pt) throw new ErroDeRegra(400, "item_sem_prompt", "Este item não tem prompt.");
    const m = await motorDoExemplo(corpo.modelo_imagem_id);
    const q = lerQualidade(corpo.qualidade);
    const saida = await chamarImagem({
      clientId,
      modeloId: m.id,
      prompt: promptDoExemplo(pedido),
      referencias: [],
      qualidade: q,
      tamanho: "1024x1024",
      referencia: { tipo: "foto_biblioteca", id: pedido.id },
      criadoPor: ch.userId,
      tarefa: "estudio",
      agente: "gerador_imagem",
    });
    const png = await emPng(saida.png);
    const caminho = `biblioteca/exemplos/${pedido.id}-${crypto.randomUUID().slice(0, 8)}.png`;
    await f.salvarNoMesa(caminho, png, "image/png");
    const semOpenverse = exemploDoOpenverse(pedido) ? camposSemOpenverse(pedido) : { tags: pedido.tags ?? [] };
    const tags = Array.from(new Set([...((semOpenverse.tags as string[]) ?? []).filter((t) => t !== TAG_SEM_EXEMPLO), TAG_EXEMPLO_GERADO]));
    const r = await d.atualizarItemDaBiblioteca(pedido.id, {
      ...semOpenverse,
      imagem_url: null,
      miniatura_url: null,
      storage_path: caminho,
      tags,
      exemplo: {
        tipo: "gerado",
        pelo_proprio_prompt: true,
        modelo_id: saida.modeloId,
        qualidade: q,
        custo_usd: arred6(saida.custoUsd),
        pago_por_cliente: clientId,
        gerado_em: new Date().toISOString(),
        aviso: "Exemplo gerado por IA com o próprio prompt (lacunas preenchidas com valores genéricos, sem marca).",
      },
    }).catch(async (e) => {
      await db().storage.from("mesa").remove([caminho]).catch(() => {});
      throw e;
    });
    const pendentes = Math.max(0, fila.filter((i) => i.id !== pedido.id).length);
    return f.json({
      item: r.item,
      url: await f.urlAssinada("mesa", caminho),
      aviso: r.aviso,
      pendentes,
      acabou: pendentes === 0,
      custo_usd: saida.custoUsd,
      saldo_usd: saida.saldoUsd,
      reserva_usada: saida.reservaUsada ?? null,
    });
  }

  return {
    acoes: {
      biblioteca_limpar_exemplos: bibliotecaLimparExemplos,
      biblioteca_exemplos_estimar: bibliotecaExemplosEstimar,
      biblioteca_exemplo_proximo: bibliotecaExemploProximo,
    } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>,
  };
}

export const ACOES_LONGAS_DA_BIBLIOTECA = ["biblioteca_limpar_exemplos", "biblioteca_exemplo_proximo"];
