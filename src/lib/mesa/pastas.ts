import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ehImagem } from "@/lib/mesa/api";

/**
 * Árvore de pastas da Mesa, espelhando a organização que já existe no
 * Workspace do cliente (tabela workspace_nodes). Pedido do dono (23/09):
 * "já está tudo pronto lá; trazer a mesma lógica, sincronizar os dois com a
 * mesma organização". Tudo aqui é JSON puro (vai para o cache persistido).
 */

/** Raiz da árvore (o próprio Workspace). */
export const RAIZ = "";
/** Pastas virtuais para o que não mora no Workspace. */
export const PASTA_ARQUIVOS = "__arquivos";
export const PASTA_ENVIADAS = "__enviadas";
export const PASTA_FORA = "__fora";
/** Fotos feitas na Mesa Foto (origem mesa_foto): antes caíam em "Fora do Workspace" e ninguém achava (25/09). */
export const PASTA_MESA_FOTO = "__mesa_foto";

export interface PastaDoExplorador {
  id: string;
  nome: string;
  /** Pasta mãe; RAIZ ("") no primeiro nível. */
  paiId: string;
}

export interface ArvoreDePastas {
  porId: Record<string, PastaDoExplorador>;
  /** Subpastas de cada pasta (RAIZ inclusa), em ordem de nome. */
  filhos: Record<string, PastaDoExplorador[]>;
  /** Itens na pasta e em todas as subpastas dela. */
  total: Record<string, number>;
}

/** Monta a árvore; pai que não existe vira raiz e ciclos não travam a conta. */
export function montarArvore(pastas: PastaDoExplorador[], diretos: Record<string, number>): ArvoreDePastas {
  const porId: Record<string, PastaDoExplorador> = {};
  for (const p of pastas) if (p.id) porId[p.id] = p;
  const filhos: Record<string, PastaDoExplorador[]> = {};
  for (const p of pastas) {
    if (!p.id) continue;
    const pai = p.paiId && porId[p.paiId] && p.paiId !== p.id ? p.paiId : RAIZ;
    (filhos[pai] = filhos[pai] || []).push(pai === p.paiId ? p : { id: p.id, nome: p.nome, paiId: RAIZ });
  }
  for (const k of Object.keys(filhos)) filhos[k].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));

  const total: Record<string, number> = {};
  const visitando: Record<string, boolean> = {};
  const contar = (id: string): number => {
    if (total[id] !== undefined) return total[id];
    if (visitando[id]) return 0;
    visitando[id] = true;
    let n = diretos[id] || 0;
    for (const f of filhos[id] || []) n += contar(f.id);
    total[id] = n;
    return n;
  };
  contar(RAIZ);
  for (const id of Object.keys(porId)) contar(id);
  return { porId, filhos, total };
}

/** Caminho da raiz até a pasta (sem a raiz). */
export function trilhaAte(arvore: ArvoreDePastas, id: string): PastaDoExplorador[] {
  const saida: PastaDoExplorador[] = [];
  const vistas: Record<string, boolean> = {};
  let atual = arvore.porId[id];
  while (atual && !vistas[atual.id]) {
    vistas[atual.id] = true;
    saida.unshift(atual);
    atual = atual.paiId ? arvore.porId[atual.paiId] : undefined;
  }
  return saida;
}

// ------------------------------------------------------------------ workspace

export interface NoDoWorkspace {
  id: string;
  name: string;
  kind: "folder" | "file";
  mime: string | null;
  storage_path: string | null;
  parent_id: string | null;
}

export const chaveDaArvoreDoWorkspace = (clientId: string) => ["mesa", "workspace-arvore", clientId];

const POR_PAGINA_DE_NOS = 1000;

/** Todos os nós do Workspace do cliente (pastas e arquivos), lidos em páginas. */
export function useArvoreDoWorkspace(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDaArvoreDoWorkspace(clientId),
    enabled: ativo && !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<NoDoWorkspace[]> => {
      const saida: NoDoWorkspace[] = [];
      for (let pagina = 0; pagina < 10; pagina++) {
        const { data, error } = await (supabase as any)
          .from("workspace_nodes")
          .select("id, name, kind, mime, storage_path, parent_id")
          .eq("client_id", clientId)
          .order("name", { ascending: true })
          .range(pagina * POR_PAGINA_DE_NOS, pagina * POR_PAGINA_DE_NOS + POR_PAGINA_DE_NOS - 1);
        if (error) throw error;
        const lote = (data || []) as NoDoWorkspace[];
        for (const n of lote) saida.push(n);
        if (lote.length < POR_PAGINA_DE_NOS) break;
      }
      return saida;
    },
  });
}

/** Pastas do Workspace no formato do explorador. */
export function pastasDoWorkspace(nos: NoDoWorkspace[]): PastaDoExplorador[] {
  return nos.filter((n) => n.kind === "folder").map((n) => ({ id: n.id, nome: n.name || "Pasta", paiId: n.parent_id || RAIZ }));
}

/** Arquivos do Workspace que são imagem e têm arquivo guardado. */
export function imagensDoWorkspace(nos: NoDoWorkspace[]): NoDoWorkspace[] {
  return nos.filter((n) => n.kind === "file" && !!n.storage_path && ehImagem(n.mime, n.name));
}

// ------------------------------------------------------------------ acervo

/** O mínimo do acervo (cliente_imagens) para achar a pasta da foto. */
export interface FotoComPasta {
  origem?: string | null;
  workspace_node_id?: string | null;
  pasta?: string | null;
}

/**
 * Pastas do acervo espelhando o Workspace: a foto que veio do Workspace fica
 * na pasta onde o arquivo mora lá; as de Arquivos ficam em "Arquivos" (uma
 * subpasta por pasta de Arquivos); as enviadas, em "Enviadas"; as feitas na
 * Mesa Foto, em "Mesa Foto".
 */
export function pastasDoAcervo(nos: NoDoWorkspace[], fotos: FotoComPasta[]): {
  pastas: PastaDoExplorador[];
  pastaDoNo: Record<string, string>;
} {
  const pastas = pastasDoWorkspace(nos);
  const pastaDoNo: Record<string, string> = {};
  for (const n of nos) if (n.kind === "file") pastaDoNo[n.id] = n.parent_id || RAIZ;
  let temArquivos = false;
  let temEnviadas = false;
  let temFora = false;
  let temMesaFoto = false;
  const subpastas: string[] = [];
  for (const f of fotos) {
    const destino = pastaDaFoto(f, pastaDoNo);
    if (destino === PASTA_ENVIADAS) temEnviadas = true;
    else if (destino === PASTA_MESA_FOTO) temMesaFoto = true;
    else if (destino === PASTA_FORA) temFora = true;
    else if (destino.indexOf(PASTA_ARQUIVOS) === 0) {
      temArquivos = true;
      if (destino !== PASTA_ARQUIVOS && subpastas.indexOf(destino) < 0) subpastas.push(destino);
    }
  }
  if (temArquivos) pastas.push({ id: PASTA_ARQUIVOS, nome: "Arquivos", paiId: RAIZ });
  for (const s of subpastas) pastas.push({ id: s, nome: s.slice(PASTA_ARQUIVOS.length + 1), paiId: PASTA_ARQUIVOS });
  if (temMesaFoto) pastas.push({ id: PASTA_MESA_FOTO, nome: "Mesa Foto", paiId: RAIZ });
  if (temEnviadas) pastas.push({ id: PASTA_ENVIADAS, nome: "Enviadas", paiId: RAIZ });
  if (temFora) pastas.push({ id: PASTA_FORA, nome: "Fora do Workspace", paiId: RAIZ });
  return { pastas, pastaDoNo };
}

/** Pasta (id do explorador) de uma foto do acervo. */
export function pastaDaFoto(f: FotoComPasta, pastaDoNo: Record<string, string>): string {
  if (f.workspace_node_id && pastaDoNo[f.workspace_node_id] !== undefined) return pastaDoNo[f.workspace_node_id];
  if (f.origem === "arquivo") {
    const nome = f.pasta && f.pasta.trim() ? f.pasta.trim() : "";
    return nome ? `${PASTA_ARQUIVOS}/${nome}` : PASTA_ARQUIVOS;
  }
  if (f.origem === "upload") return PASTA_ENVIADAS;
  if (f.origem === "mesa_foto") return PASTA_MESA_FOTO;
  return PASTA_FORA;
}
