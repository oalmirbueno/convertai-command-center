/**
 * Espelho da organização da Mesa Edição no Workspace do cliente (02/10/2026).
 *
 * O dono: "reconhecer o workspace e os arquivos e organizar tudo lá
 * corretamente". Regra da casa: nunca duplicar armazenamento. O vídeo da Mesa
 * mora no bucket "mesa"; o do Workspace, no bucket "workspace". Então o espelho:
 * - acha no Workspace os vídeos que SÃO os mesmos da Mesa (mesmo tamanho em
 *   bytes e nome parecido; o cliente costuma subir lá e a equipe aqui);
 * - propõe mover cada um para a mesma pasta que ele tem na Mesa, debaixo de
 *   "Vídeos" (a pasta de vídeos que já existe no Workspace, ou uma nova), com o
 *   nome que a Mesa deu;
 * - o que só existe na Mesa fica só na Mesa (contado na prévia, sem cópia).
 * Aplicar e Desfazer são os do organizador do Workspace (workspace-organizar/
 * aplicar.ts): cria as pastas que faltam, move, renomeia e volta como estava.
 *
 * Puro: sem Deno, sem banco.
 */

import { baseDoNome } from "./organizador-da-entrada.ts";
import { semAcento } from "./organizador-de-takes.ts";

export interface NoDoWorkspaceParaEspelho {
  id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  mime?: string | null;
  size_bytes?: number | null;
}

export interface ArquivoParaEspelho {
  id: string;
  nome: string;
  nome_original: string;
  grupo: string | null;
  bytes?: number | null;
  estado?: string;
}

export interface GrupoDoEspelho {
  caminho: string[];
  itens: Array<{ id: string; nome: string; ordem?: number | null }>;
}

export interface PlanoDoEspelho {
  /** Pasta raiz dos vídeos no Workspace (a que já existe) ou null (será criada "Vídeos"). */
  raiz_id: string | null;
  raiz_nome: string;
  grupos: GrupoDoEspelho[];
  /** Vídeo da Mesa -> nó do Workspace que é o mesmo arquivo. */
  pares: Array<{ arquivo_id: string; no_id: string; de: string; para: string }>;
  /** Arquivos da Mesa sem par no Workspace (ficam só na Mesa: nada é copiado). */
  so_na_mesa: number;
  /** Vídeos do Workspace sem par na Mesa (ficam onde estão). */
  so_no_workspace: number;
}

export const NOME_DA_RAIZ = "Vídeos";
const EXT_DE_VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mts)$/i;
/** O organizador do Workspace aceita até 4 níveis de pasta. */
const MAX_NIVEIS = 4;

const normal = (t: string) =>
  semAcento(String(t || ""))
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const ehVideoDoWorkspace = (n: NoDoWorkspaceParaEspelho) => n.kind === "file" && (String(n.mime || "").indexOf("video/") === 0 || EXT_DE_VIDEO.test(n.name || ""));

/** A pasta de vídeos que já existe na raiz do Workspace ("Vídeos", "Videos", "Vídeo"). */
export function raizDeVideos(nos: NoDoWorkspaceParaEspelho[]): NoDoWorkspaceParaEspelho | null {
  const achadas = nos.filter((n) => n.kind === "folder" && !n.parent_id && /^videos?$/.test(normal(n.name)));
  return achadas.sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null;
}

/** O nó do Workspace que é o mesmo arquivo: mesmo tamanho e nome parecido; sem tamanho, o mesmo nome. */
export function mesmoArquivo(a: ArquivoParaEspelho, n: NoDoWorkspaceParaEspelho): boolean {
  const nomes = [normal(a.nome_original), normal(a.nome), normal(baseDoNome(a.nome))].filter(Boolean);
  const nomeDoNo = normal(n.name);
  const nomeIgual = nomes.indexOf(nomeDoNo) >= 0;
  // Mesmo tamanho exato em bytes é o mesmo vídeo (o nome muda de um lado e do outro).
  if (a.bytes && n.size_bytes) return Number(a.bytes) === Number(n.size_bytes);
  return nomeIgual;
}

const comExtensaoDoNo = (nome: string, doNo: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(doNo || "");
  const base = String(nome || "").replace(/\.[a-z0-9]{2,5}$/i, "").trim() || String(doNo || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  return m ? `${base}.${m[1].toLowerCase()}` : base;
};

/**
 * O plano do espelho. Só vídeos da Mesa que têm pasta (grupo) e um par no
 * Workspace entram; cada nó do Workspace é usado uma vez. O caminho é
 * "Vídeos / <pastas da Mesa>" (até 4 níveis: o resto vira parte do último).
 */
export function planoDoEspelho(arquivos: ArquivoParaEspelho[], nos: NoDoWorkspaceParaEspelho[]): PlanoDoEspelho {
  const raiz = raizDeVideos(nos);
  const raizNome = raiz ? raiz.name : NOME_DA_RAIZ;
  const videos = nos.filter(ehVideoDoWorkspace);
  const usados = new Set<string>();
  const porCaminho: Record<string, GrupoDoEspelho> = {};
  const ordem: string[] = [];
  const pares: PlanoDoEspelho["pares"] = [];
  let soNaMesa = 0;
  arquivos
    .filter((a) => a.estado !== "arquivado" && a.grupo && a.grupo.trim())
    .forEach((a) => {
      const no = videos.find((n) => !usados.has(n.id) && mesmoArquivo(a, n));
      if (!no) {
        soNaMesa++;
        return;
      }
      usados.add(no.id);
      const partes = String(a.grupo)
        .split(" / ")
        .map((p) => p.trim())
        .filter(Boolean);
      const livres = MAX_NIVEIS - 1;
      const cabem = partes.length > livres ? partes.slice(0, livres - 1).concat([partes.slice(livres - 1).join(" - ")]) : partes;
      const caminho = [raizNome].concat(cabem);
      const k = caminho.join("/");
      if (!porCaminho[k]) {
        porCaminho[k] = { caminho, itens: [] };
        ordem.push(k);
      }
      const nome = comExtensaoDoNo(a.nome, no.name);
      porCaminho[k].itens.push({ id: no.id, nome, ordem: porCaminho[k].itens.length });
      pares.push({ arquivo_id: a.id, no_id: no.id, de: no.name, para: `${caminho.join(" / ")} / ${nome}` });
    });
  return {
    raiz_id: raiz ? raiz.id : null,
    raiz_nome: raizNome,
    grupos: ordem.map((k) => porCaminho[k]),
    pares,
    so_na_mesa: soNaMesa,
    so_no_workspace: videos.filter((n) => !usados.has(n.id)).length,
  };
}
