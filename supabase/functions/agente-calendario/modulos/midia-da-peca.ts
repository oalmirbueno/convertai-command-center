/**
 * Mídia da peça no servidor (23/10/2026): lê a peça e o acervo, pede as notas
 * ao Jev, escreve o roteiro do vídeo (2 versões, o Jev escolhe pela
 * viralidade), busca referência livre quando o acervo não tem foto boa e grava
 * no item da proposta com recibo para Desfazer. Regras em
 * midia-da-peca-regras.ts. Tudo de fora (banco, Jev, modelo, Openverse) entra
 * por `deps`, para o teste rodar sem rede.
 *
 * Nunca gera imagem nem vídeo e nunca publica: a geração continua no Estúdio
 * (pauta de fotos e pauta de vídeo), com o custo antes do clique.
 */
import {
  candidatasDoAcervo,
  type EscolhaDaFotoReal,
  escolherFotoReal,
  type FotoDoAcervo,
  itemDaDescricaoDaTarefa,
  itemComMidia,
  type MidiaDaPeca,
  pedidoDaMidia,
  perguntasDaMidia,
  escolhidasPelasNotas,
  type ReferenciaDaInternet,
  resumoDaMidia,
  termosDaBusca,
  textoDaFoto,
  textoDaVersao,
  type TipoDeMidia,
  type VersaoDoRoteiro,
  versoesDoModelo,
} from "./midia-da-peca-regras.ts";
import { gravarPassosDoFormato, type PassoDoFormato } from "../mudanca-de-formato.ts";

type Respostas = Record<string, { score?: number; choice?: string } | undefined>;

export type DepsDaMidia = {
  // deno-lint-ignore no-explicit-any
  db: any;
  /** Jev com a cobrança na carteira do cliente. */
  julgar: (state: unknown, questions: Record<string, unknown>) => Promise<Respostas>;
  /** O modelo rápido com o esquema ESQUEMA_DA_MIDIA_DA_PECA. */
  escrever: (pedido: string) => Promise<{ json: unknown; custoUsd: number }>;
  /** O bloco do motor de copy viral (ganchos do nicho) e o nicho em palavras. */
  prepararViral: () => Promise<{ bloco: string; nicho: string; publico: string | null }>;
  /** Gerar a mais e escolher: a ordem das versões pela nota viral do Jev (a melhor primeiro). */
  escolherViral: (textos: string[], nicho: string, publico: string | null) => Promise<number[]>;
  /** Openverse com licença comercial e de modificação. */
  buscarWeb: (termos: string) => Promise<ReferenciaDaInternet[]>;
  agora?: () => string;
};

export type PlanoDaMidia = {
  midia: MidiaDaPeca;
  versao: VersaoDoRoteiro | null;
  custo: number;
  avisos: string[];
};

const CAMPOS_DO_ACERVO = "id, nome, descricao, tags, pasta, categoria, ativa, gerada";

type TarefaDaPeca = { id: string; title: string; description: string | null; due_date: string | null; delivery_type: string | null; project_id: string | null };

/**
 * O item da peça: o da proposta do Mês quando a tarefa nasceu de uma; sem ela
 * (26/10: peça criada pelo MCP, pela Mesa Ads ou à mão), o item montado pelo
 * título e pelos campos da descrição, com `proposta` nula.
 */
// deno-lint-ignore no-explicit-any
async function itemDaTarefa(db: any, clientId: string, taskId: string) {
  const [t, p] = await Promise.all([
    db.from("tasks").select("id, title, description, due_date, delivery_type, project_id, deleted_at").eq("id", taskId).maybeSingle(),
    db.from("calendario_propostas").select("id, itens").eq("client_id", clientId).contains("task_ids", [taskId]).order("criado_em", { ascending: false }).limit(1),
  ]);
  if (t.error || p.error) throw new Error("Não foi possível ler a peça agora. Tente de novo.");
  if (!t.data || t.data.deleted_at) throw new Error("Esta peça não está mais na agenda.");
  const tarefa = t.data as TarefaDaPeca;
  const proposta = (p.data || [])[0] as { id: string; itens: Array<Record<string, unknown>> } | undefined;
  const indice = proposta && Array.isArray(proposta.itens) ? proposta.itens.findIndex((i) => i && i.task_id === taskId) : -1;
  if (!proposta || indice < 0) return { tarefa, proposta: null, indice: -1, item: itemDaDescricaoDaTarefa(tarefa) };
  return { tarefa, proposta, indice, item: proposta.itens[indice] };
}

/** O tipo pela peça quando o pedido não diz: item de vídeo é vídeo; de foto é foto. */
function tipoDoItem(item: Record<string, unknown>): TipoDeMidia | null {
  if (item.formato === "video") return "video";
  if (item.formato === "foto" || item.mesa === "foto") return "foto";
  return null;
}

/**
 * Pensa a mídia sem gravar. Ordem: acervo (Jev) primeiro, porque a imagem de
 * partida entra no roteiro; o modelo só quando é vídeo ou quando falta foto
 * (para os termos da busca livre); a busca livre só sem foto do acervo.
 */
export async function planejarMidia(deps: DepsDaMidia, a: { clientId: string; taskId: string; tipo?: TipoDeMidia | null; pedido?: string | null; maxFotos?: number | null }): Promise<PlanoDaMidia> {
  const { tarefa, item } = await itemDaTarefa(deps.db, a.clientId, a.taskId);
  const tipo = a.tipo || tipoDoItem(item);
  if (!tipo) throw new Error("Esta peça é de arte (carrossel ou estático). Peça foto ou vídeo para ela e o formato muda junto.");
  const tema = String(item.tema || tarefa.title || "").replace(/^Peça de foto: /, "");
  const pedido = a.pedido ? String(a.pedido).slice(0, 800) : null;
  const avisos: string[] = [];
  let custo = 0;

  const { data: fotosBrutas } = await deps.db.from("cliente_imagens").select(CAMPOS_DO_ACERVO).eq("client_id", a.clientId).eq("ativa", true).order("atualizado_em", { ascending: false }).limit(200);
  const candidatas = candidatasDoAcervo((fotosBrutas || []) as FotoDoAcervo[], [tema, item.gancho, item.referencia, pedido].filter(Boolean).join(" "));
  const viralP = deps.prepararViral().catch(() => ({ bloco: "", nicho: "negócio local", publico: null }));
  const viral = await viralP;
  const peca = { tema, gancho: item.gancho ?? null, pedido, tipo, nicho: viral.nicho };

  let acervo: Array<FotoDoAcervo & { nota: number }> = [];
  if (candidatas.length) {
    try {
      const uso = tipo === "video" ? "imagem de partida de um vídeo curto" : "foto do post";
      const r = await deps.julgar({ peca, candidatas: candidatas.map(textoDaFoto) }, perguntasDaMidia(candidatas.length, uso));
      // 27/10: a composição do vídeo da pauta pede uma foto por cena (até 4); o "Pensar a mídia" segue com 2.
      const quantas = tipo === "video" ? Math.max(1, Math.min(4, Math.floor(Number(a.maxFotos)) || 2)) : Math.max(1, Math.min(4, Number((item.foto as Record<string, unknown> | undefined)?.quantidade) || 4));
      acervo = escolhidasPelasNotas(candidatas, r, quantas);
    } catch {
      avisos.push("O Jev não respondeu: as fotos do Workspace ficaram para você escolher.");
    }
  }

  let versao: VersaoDoRoteiro | null = null;
  let termos = "";
  if (tipo === "video" || !acervo.length) {
    const partida = acervo[0] ? textoDaFoto(acervo[0]) : null;
    const s = await deps.escrever(pedidoDaMidia({ tipo, tema, gancho: item.gancho as string | null, referencia: item.referencia as string | null, pedido, data: tarefa.due_date }, { nicho: viral.nicho, blocoViral: viral.bloco, partida, temReferenciaReal: acervo.length > 0 }));
    custo += s.custoUsd;
    termos = termosDaBusca((s.json as Record<string, unknown> | null)?.busca_en);
    if (tipo === "video") {
      const versoes = versoesDoModelo(s.json);
      if (versoes.length > 1) {
        try {
          const ordem = await deps.escolherViral(versoes.map(textoDaVersao), viral.nicho, viral.publico);
          versao = versoes[ordem[0] ?? 0] || versoes[0];
        } catch {
          versao = versoes[0];
        }
      } else versao = versoes[0] || null;
      if (!versao) avisos.push("O roteiro do vídeo não veio completo: a direção ficou como estava.");
    }
  }

  let web: ReferenciaDaInternet[] = [];
  if (!acervo.length && termos) {
    try {
      const achadas = (await deps.buscarWeb(termos)).slice(0, 10);
      if (achadas.length) {
        const r = await deps.julgar({ peca, candidatas: achadas.map((w) => `${w.titulo}${w.autor ? `, de ${w.autor}` : ""}`) }, perguntasDaMidia(achadas.length, "referência visual"));
        web = escolhidasPelasNotas(achadas, r, 3).map(({ nota: _n, ...w }) => w);
      }
    } catch {
      avisos.push("A busca de referência livre não respondeu agora.");
    }
  }

  const fonte: MidiaDaPeca["fonte"] = acervo.length ? "acervo" : web.length ? "internet" : "texto";
  const base = { tipo, fonte, acervo: acervo.map((f) => ({ id: f.id, nome: f.nome, nota: f.nota })), web, gancho: versao ? versao.gancho : null };
  const midia: MidiaDaPeca = {
    ...base,
    cenas: versao ? versao.cenas : [],
    narracao: versao ? versao.narracao || null : null,
    porque: acervo.length ? `Nota do Jev ${acervo[0].nota} de 3 para "${acervo[0].nome}".` : null,
    resumo: resumoDaMidia(base),
    pedido,
    gerada_em: deps.agora ? deps.agora() : new Date().toISOString(),
  };
  if (tipo === "foto" && !acervo.length) avisos.push("O acervo não tem foto real que sirva: suba as fotos no Workspace ou use a referência livre na Mesa Foto.");
  return { midia, versao, custo, avisos };
}

/**
 * Grava a mídia no item da proposta (CAS pelo item lido agora) e devolve o recibo para Desfazer. Peça sem
 * proposta: um roteiro espelho gravado com o item montado da tarefa (o mesmo do "troca_gravada"), para o
 * Estúdio e a Agenda acharem a mídia; o recibo volta o espelho ao item sem a mídia.
 */
// deno-lint-ignore no-explicit-any
export async function gravarMidia(db: any, clientId: string, taskId: string, plano: PlanoDaMidia): Promise<PassoDoFormato[]> {
  const { tarefa, proposta, indice, item } = await itemDaTarefa(db, clientId, taskId);
  if (!proposta) {
    const data = String(item.data || new Date().toISOString().slice(0, 10));
    const { data: espelho, error } = await db.from("calendario_propostas").insert({
      client_id: clientId, project_id: tarefa.project_id ?? null, periodo_inicio: data, periodo_fim: data,
      parametros: { origem: "midia_da_tarefa" }, status: "gravada", diagnostico: null, temas: [], itens: [item], task_ids: [taskId],
      gravada_em: new Date().toISOString(),
    }).select("id").single();
    if (error || !espelho) throw new Error("Não foi possível guardar a mídia desta peça. Nada mudou.");
    return gravarPassosDoFormato(db, [{ tabela: "calendario_propostas", id: (espelho as { id: string }).id, antes: { itens: [item] }, depois: { itens: [itemComMidia(item, plano.midia, plano.versao)] } }], clientId);
  }
  const itens = proposta.itens.map((i, k) => (k === indice ? itemComMidia(i, plano.midia, plano.versao) : i));
  return gravarPassosDoFormato(db, [{ tabela: "calendario_propostas", id: proposta.id, antes: { itens: proposta.itens }, depois: { itens } }], clientId);
}

/**
 * Foto real primeiro (26/10, dono: "achar interessante colocar de forma inteligente imagens reais quando tem"):
 * só as fotos REAIS do acervo (fotoReal), o Jev dá a nota contra a peça e a melhor acima do corte é a
 * sugerida; sem nenhuma, a peça gera com IA e a tela diz isso numa linha. Não grava nada; o custo é o do Jev.
 */
export async function fotoRealDaPeca(deps: Pick<DepsDaMidia, "db" | "julgar">, a: { clientId: string; taskId: string; uso: "arte" | "video"; max?: number }): Promise<EscolhaDaFotoReal & { julgou: boolean }> {
  const { tarefa, item } = await itemDaTarefa(deps.db, a.clientId, a.taskId);
  const tema = String(item.tema || tarefa.title || "").replace(/^Peça de foto: /, "");
  const { data } = await deps.db.from("cliente_imagens").select(CAMPOS_DO_ACERVO).eq("client_id", a.clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(200);
  return escolherFotoReal((data || []) as FotoDoAcervo[], [tema, item.gancho, item.referencia].filter(Boolean).join(" "), deps.julgar, {
    uso: a.uso === "video" ? "imagem de partida de um vídeo curto" : "foto real de base da arte (capa do post)",
    peca: { tema, gancho: item.gancho ?? null, formato: item.formato ?? null },
    max: a.max,
  });
}
