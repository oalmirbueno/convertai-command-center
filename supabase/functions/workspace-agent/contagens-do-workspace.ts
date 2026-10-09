/**
 * Contagens do Workspace calculadas pelo código (lote B, 09/10/2026).
 *
 * O agente respondeu "a pasta com mais itens é materiais (38)" quando a maior era
 * "Referencias de Design" (108): o modelo contava numa lista solta e misturava as
 * seções de Arquivos (files.folder) com as pastas do Workspace (workspace_nodes).
 * Agora quantidade, total e ranking saem daqui, com a fonte e o escopo escritos,
 * na mesma regra da tela (src/pages/Workspace.tsx):
 * - pasta do Workspace: "itens" = arquivos dentro dela, contando as subpastas;
 * - seção de Arquivos: arquivos sem pai de carrossel e que não são espelho de um
 *   arquivo do Workspace (mesmo storage_path), fora os arquivados.
 * O modelo só comenta; não calcula.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { jevPerguntar, probabilidadeNoul, type ResultadoJev } from "../_shared/jev.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";

export type NoDoWorkspace = { id: string; parent_id: string | null; kind: string; name: string; storage_path?: string | null };
export type ArquivoDoSistema = { folder: string | null; parent_file_id: string | null; storage_bucket: string | null; storage_path: string | null };
export type ItemDaRaiz = { nome: string; tipo: "pasta" | "secao" | "arquivo"; itens: number };
export type Contagens = {
  cliente: string;
  raiz: ItemDaRaiz[];
  pastas_do_workspace: number;
  arquivos_do_workspace: number;
  arquivos_nas_secoes: number;
  /** false quando a leitura parou no teto de páginas (o quadro avisa). */
  completo: boolean;
};

const ROTULO_DO_TIPO: Record<ItemDaRaiz["tipo"], string> = { pasta: "pasta do Workspace", secao: "seção de Arquivos", arquivo: "arquivo solto na raiz" };

/** Cálculo puro (sem banco): os itens da raiz na regra da tela, do maior para o menor. */
export function calcularContagens(nos: NoDoWorkspace[], arquivos: ArquivoDoSistema[], cliente: string, completo = true): Contagens {
  const filhos = new Map<string, NoDoWorkspace[]>();
  nos.forEach((n) => {
    if (!n.parent_id) return;
    const l = filhos.get(n.parent_id) || [];
    l.push(n);
    filhos.set(n.parent_id, l);
  });
  const arquivosDentro = (id: string): number => {
    let total = 0;
    const pilha = [id];
    const vistos = new Set<string>();
    while (pilha.length) {
      const atual = pilha.pop() as string;
      if (vistos.has(atual)) continue;
      vistos.add(atual);
      (filhos.get(atual) || []).forEach((f) => {
        if (f.kind === "folder") pilha.push(f.id);
        else total += 1;
      });
    }
    return total;
  };
  const raiz: ItemDaRaiz[] = [];
  nos.filter((n) => !n.parent_id).forEach((n) => raiz.push(n.kind === "folder" ? { nome: n.name, tipo: "pasta", itens: arquivosDentro(n.id) } : { nome: n.name, tipo: "arquivo", itens: 0 }));
  const caminhosDoWorkspace = new Set(nos.map((n) => n.storage_path).filter((p): p is string => !!p));
  const porSecao = new Map<string, number>();
  let soltos = 0;
  let nasSecoes = 0;
  arquivos.forEach((f) => {
    if (f.parent_file_id) return;
    if (f.storage_bucket === "workspace" && f.storage_path && caminhosDoWorkspace.has(f.storage_path)) return;
    const secao = String(f.folder || "").trim();
    if (!secao) {
      soltos += 1;
      return;
    }
    nasSecoes += 1;
    porSecao.set(secao, (porSecao.get(secao) || 0) + 1);
  });
  porSecao.forEach((itens, nome) => raiz.push({ nome, tipo: "secao", itens }));
  raiz.sort((a, b) => b.itens - a.itens || a.nome.localeCompare(b.nome));
  for (let i = 0; i < soltos; i += 1) raiz.push({ nome: "arquivo sem seção", tipo: "arquivo", itens: 0 });
  return {
    cliente,
    raiz,
    pastas_do_workspace: nos.filter((n) => n.kind === "folder").length,
    arquivos_do_workspace: nos.filter((n) => n.kind !== "folder").length,
    arquivos_nas_secoes: nasSecoes,
    completo,
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O quadro que a equipe vê no começo da resposta (fonte, escopo e regra de contagem escritos). */
export function quadroDasContagens(c: Contagens): string {
  const comItens = c.raiz.filter((r) => r.tipo !== "arquivo");
  const pastas = c.raiz.filter((r) => r.tipo === "pasta").length;
  const secoes = c.raiz.filter((r) => r.tipo === "secao").length;
  const soltos = c.raiz.filter((r) => r.tipo === "arquivo").length;
  const linhas = comItens.map((r) => `| ${r.nome.replace(/\|/g, "/")} | ${ROTULO_DO_TIPO[r.tipo]} | ${r.itens} |`);
  const maior = comItens.length ? comItens[0].itens : 0;
  const maiores = comItens.filter((r) => r.itens === maior && maior > 0).map((r) => `"${r.nome}"`);
  const partes = [
    `**Contagem calculada pelo painel** (fonte: Workspace e Arquivos de ${c.cliente}; escopo: raiz do cliente; "itens" = arquivos dentro, contando as subpastas, como na tela).`,
    "",
    "| Item da raiz | Tipo | Itens |",
    "| --- | --- | --- |",
    ...linhas,
    "",
    `Na raiz: ${plural(c.raiz.length, "item", "itens")} (${plural(pastas, "pasta do Workspace", "pastas do Workspace")}, ${plural(secoes, "seção de Arquivos", "seções de Arquivos")}${soltos ? `, ${plural(soltos, "arquivo solto", "arquivos soltos")}` : ""}).${maiores.length ? ` Com mais itens: ${maiores.join(" e ")} (${maior}).` : ""}`,
  ];
  // Maior e menor de cada tipo (o código afirma; o modelo não escreve número depois do quadro).
  const extremos = (tipo: ItemDaRaiz["tipo"], rotulo: string) => {
    const l = comItens.filter((r) => r.tipo === tipo);
    if (!l.length) return null;
    const max = l[0].itens;
    const min = l[l.length - 1].itens;
    const nomes = (v: number) => l.filter((r) => r.itens === v).map((r) => `"${r.nome}"`).join(" e ");
    return `${rotulo}: ${l.length}. Maior: ${nomes(max)} (${max}). Menor: ${nomes(min)} (${min}).`;
  };
  [extremos("pasta", "Pastas do Workspace"), extremos("secao", "Seções de Arquivos")].forEach((x) => x && partes.push(x));
  if (!c.completo) partes.push("Aviso: a leitura parou no limite de páginas; os números podem estar abaixo do real.");
  return partes.join("\n");
}

/** O mesmo quadro para o modelo, com a regra de uso (ele comenta, não conta). */
export function blocoDasContagens(c: Contagens, mostradoNaResposta: boolean): string {
  return [
    "---CONTAGEM CALCULADA DO WORKSPACE (fonte de verdade para quantidade, total, maior e menor)---",
    quadroDasContagens(c),
    "Quantidade, total, ranking, maior ou menor: use SÓ este quadro e diga o escopo (raiz do cliente) e a fonte. Pasta do Workspace e seção de Arquivos são coisas diferentes: não misture. Não conte na lista de arquivos. Se pedirem a contagem de algo que não está no quadro (uma subpasta, um tipo de arquivo), diga que essa contagem não foi calculada aqui.",
    mostradoNaResposta ? "O painel JÁ MOSTROU este quadro no começo da sua resposta: não repita a tabela e não escreva outro número de contagem; complete em no máximo duas frases." : "",
  ].filter(Boolean).join("\n");
}

async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, paginas = 20, tamanho = 1000): Promise<{ linhas: T[]; completo: boolean }> {
  const linhas: T[] = [];
  for (let p = 0; p < paginas; p += 1) {
    const { data, error } = await consulta(p * tamanho, p * tamanho + tamanho - 1);
    if (error) throw new Error(error.message);
    const lote = (data as T[] | null) || [];
    linhas.push(...lote);
    if (lote.length < tamanho) return { linhas, completo: true };
  }
  return { linhas, completo: false };
}

/** Lê o Workspace e os Arquivos do cliente inteiros (paginado) e calcula. Falha: null + log (o agente segue sem o quadro). */
export async function lerContagens(admin: SupabaseClient, clientId: string, cliente: string): Promise<Contagens | null> {
  try {
    const [nos, arquivos] = await Promise.all([
      lerTudo<NoDoWorkspace>((de, ate) => admin.from("workspace_nodes").select("id, parent_id, kind, name, storage_path").eq("client_id", clientId).order("created_at", { ascending: true }).range(de, ate)),
      lerTudo<ArquivoDoSistema>((de, ate) => admin.from("files").select("folder, parent_file_id, storage_bucket, storage_path").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: true }).range(de, ate)),
    ]);
    return calcularContagens(nos.linhas, arquivos.linhas, cliente, nos.completo && arquivos.completo);
  } catch (e) {
    registrarFalha("workspace-agent: contagens do workspace não calculadas", e, { client_id: clientId });
    return null;
  }
}

/**
 * Com o quadro já na resposta, número de contagem é só o do quadro: as frases do modelo que trazem
 * número saem da versão gravada (no teste real de 09/10 ele escreveu "8 pastas" quando eram 4 pastas
 * e 4 seções). Sobrando nada, fica só o quadro.
 */
export function semNumerosDoModelo(texto: string): string {
  return String(texto || "")
    .split("\n")
    .map((linha) => linha.replace(/([.!?])\s+/g, "$1\u0001").split("\u0001").filter((f) => !/\d/.test(f)).join(" ").trim())
    .filter((linha, i, l) => linha || (i > 0 && l[i - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reserva sem Jev: as palavras de contagem e ranking. */
export function pedeContagemPorPalavras(texto: string): boolean {
  const t = String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /\b(quant[oa]s?|quantidade|total|contagem|conta(r|gem)?\b|ranking|maior|menor|mais itens|menos itens|mais arquivos|menos arquivos|mais cheia|mais vazia)\b/.test(t);
}

/**
 * O pedido quer quantidade, total ou ranking de pastas, seções ou arquivos do Workspace?
 * Jev Noul (julgamento sobre a frase); sem o Jev, as palavras. Nunca lança.
 */
export async function pedeContagem(texto: string, cobrar?: (j: ResultadoJev) => unknown): Promise<boolean> {
  try {
    const r = await jevPerguntar({
      state: { pedido: String(texto || "").slice(0, 1500) },
      questions: {
        contagem: {
          type: "noul",
          instructions: "O `pedido` da equipe ao agente do Workspace pergunta uma quantidade, um total, uma contagem ou um ranking (maior, menor, mais ou menos itens) de pastas, seções ou arquivos do Workspace do cliente?",
          criteria: {
            true: "Sim: pede para contar, somar, comparar tamanhos ou dizer qual pasta ou seção tem mais ou menos itens.",
            false: "Não: pede outra coisa (organizar, criar, mover, resumir conteúdo, escrever texto) sem pedir números de contagem.",
          },
        },
      },
    }, { timeoutMs: 8000 });
    if (cobrar) await Promise.resolve(cobrar(r)).catch(() => undefined);
    const p = probabilidadeNoul(r.answers.contagem);
    return typeof p === "number" ? p >= 0.5 : pedeContagemPorPalavras(texto);
  } catch (e) {
    registrarFalha("workspace-agent: Jev da contagem indisponível (vale a palavra do pedido)", e);
    return pedeContagemPorPalavras(texto);
  }
}
