/**
 * Ações dos agentes sobre os arquivos do workspace do cliente
 * (workspace_nodes), no contrato comum de acoes-do-agente.ts.
 *
 * Operações (apelidos w1..wN, pastas e arquivos):
 * - mover (para = apelido da pasta de destino, "raiz", ou "nova: Nome" para
 *   criar a pasta na raiz do cliente e mover para ela).
 * - renomear (para = nome novo).
 * - arquivar: vai para a pasta "Arquivados" na raiz do cliente (criada na
 *   hora se não existir). Nunca apaga: o workspace não tem lixeira e o
 *   apagar da tela é definitivo, então o agente só arquiva. Desfazer devolve
 *   para a pasta de antes.
 *
 * Travas: a pasta Arquivados e a pasta de recebimento do cliente (inbox) não
 * saem do lugar; pasta não vai para dentro dela mesma.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import type { Alvo, AlvoComApelido, ItemDaAcaoDoAgente, RegraDaOperacao, ResultadoDoItem } from "./acoes-do-agente.ts";

export const PASTA_DE_ARQUIVADOS = "Arquivados";

export type NoDoWorkspace = { id: string; parent_id: string | null; kind: string; name: string; inbox_token?: string | null };
export type AlvoDoNo = Alvo & { dados: { kind: string; parent_id: string | null; caminho: string; inbox: boolean; arquivados: boolean } };

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Caminho de pastas até o nó ("Marca / Logos"). */
export function caminhoDoNo(no: NoDoWorkspace, porId: Map<string, NoDoWorkspace>): string {
  const partes: string[] = [];
  let atual = no.parent_id ? porId.get(no.parent_id) : undefined;
  for (let i = 0; atual && i < 12; i++) {
    partes.unshift(atual.name);
    atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
  }
  return partes.join(" / ");
}

/** Pastas primeiro, depois arquivos, cada um com apelido w1..wN. */
export function alvosDoWorkspace(nos: NoDoWorkspace[], max = 150): Array<AlvoComApelido<AlvoDoNo>> {
  const porId = new Map(nos.map((n) => [n.id, n]));
  return nos
    .slice()
    .sort((a, b) => Number(a.kind !== "folder") - Number(b.kind !== "folder") || caminhoDoNo(a, porId).localeCompare(caminhoDoNo(b, porId)) || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((n, i) => {
      const caminho = caminhoDoNo(n, porId);
      const arquivados = n.kind === "folder" && !n.parent_id && n.name === PASTA_DE_ARQUIVADOS;
      return {
        ref: `w${i + 1}`,
        id: n.id,
        titulo: umaLinha(n.name, 120),
        detalhe: `${n.kind === "folder" ? "pasta" : "arquivo"} · em ${caminho || "raiz"}${n.inbox_token ? " · recebe arquivos do cliente" : ""}`,
        dados: { kind: n.kind, parent_id: n.parent_id, caminho, inbox: !!n.inbox_token, arquivados },
      };
    });
}

/** Nome de arquivo ou pasta limpo (sem barra, até 120). */
export function nomePedido(v: unknown): string | null {
  const s = umaLinha(v, 160).replace(/[\\/]+/g, "-").slice(0, 120).trim();
  return s || null;
}

/**
 * Regras do workspace. O destino de mover é um apelido de pasta, "raiz" ou
 * "nova: Nome"; o valor gravado na proposta é o id da pasta, "raiz" ou
 * "nova:Nome" (o executor cria a pasta na hora).
 */
export function regrasDoWorkspace(alvos: Array<AlvoComApelido<AlvoDoNo>>): Record<string, RegraDaOperacao<AlvoDoNo>> {
  const porRef = new Map(alvos.map((a) => [a.ref.toLowerCase(), a]));
  const porId = new Map(alvos.map((a) => [a.id, a]));
  const dentroDe = (pastaId: string, noId: string) => {
    // A pasta de destino está dentro do nó (ou é ele)? Sobe pelos pais conhecidos.
    let atual: AlvoComApelido<AlvoDoNo> | undefined = porId.get(pastaId);
    for (let i = 0; atual && i < 20; i++) {
      if (atual.id === noId) return true;
      atual = atual.dados.parent_id ? porId.get(atual.dados.parent_id) : undefined;
    }
    return false;
  };
  const travaFixa = (a: AlvoComApelido<AlvoDoNo>) =>
    a.dados.arquivados ? "A pasta Arquivados fica onde está." : a.dados.inbox ? "Esta pasta recebe os arquivos do cliente e fica onde está." : null;
  return {
    mover: {
      rotulo: "mover",
      alvos: ["w"],
      combina: true,
      para: (bruto, a) => {
        const s = String(bruto ?? "").trim();
        if (/^raiz$/i.test(s)) return a.dados.parent_id ? "raiz" : null;
        const nova = /^nova\s*:\s*(.+)$/i.exec(s);
        if (nova) {
          const nome = nomePedido(nova[1]);
          return nome ? `nova:${nome}` : null;
        }
        const destino = porRef.get(s.toLowerCase());
        if (!destino || destino.dados.kind !== "folder" || destino.id === a.dados.parent_id || dentroDe(destino.id, a.id)) return null;
        return destino.id;
      },
      trava: (a) => travaFixa(a),
    },
    renomear: {
      rotulo: "renomear",
      alvos: ["w"],
      combina: true,
      para: (bruto, a) => {
        const n = nomePedido(bruto);
        return n && n !== a.titulo ? n : null;
      },
      trava: (a) => (a.dados.arquivados ? "A pasta Arquivados mantém o nome." : null),
    },
    arquivar: {
      rotulo: "arquivar",
      alvos: ["w"],
      trava: (a) => travaFixa(a) || (a.dados.caminho.split(" / ")[0] === PASTA_DE_ARQUIVADOS ? "Já está em Arquivados." : null),
    },
  };
}

/** Texto do destino para o cartão ("para a pasta Logos", "para a raiz"). */
export function rotuloDoDestino(alvos: Array<AlvoComApelido<AlvoDoNo>>) {
  const porId = new Map(alvos.map((a) => [a.id, a]));
  return (op: string, para: unknown): string | null => {
    if (op !== "mover") return null;
    const s = String(para ?? "");
    if (s === "raiz") return "raiz do cliente";
    if (s.indexOf("nova:") === 0) return `pasta nova ${s.slice(5)}`;
    const p = porId.get(s);
    return p ? `pasta ${p.dados.caminho ? `${p.dados.caminho} / ` : ""}${p.titulo}` : null;
  };
}

export const DESCRICOES_DO_WORKSPACE: Record<string, string> = {
  mover: 'ref w#; para com o apelido da pasta de destino (w#), "raiz" ou "nova: Nome da pasta" para criar na raiz.',
  renomear: "ref w#; para com o nome novo (com a extensão, quando é arquivo).",
  arquivar: 'ref w#; leva para a pasta "Arquivados" (nunca apaga). para vazio.',
};

// ------------------------------------------------------------------ execução

// deno-lint-ignore no-explicit-any
type ServicoMinimo = { from: (tabela: string) => any };

async function lerNo(servico: ServicoMinimo, clientId: string, id: string) {
  const { data, error } = await servico.from("workspace_nodes").select("id, client_id, scope, parent_id, kind, name").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível ler o arquivo do workspace.");
  const n = data as { id: string; client_id: string | null; scope: string; parent_id: string | null; kind: string; name: string } | null;
  if (!n || n.scope !== "client" || n.client_id !== clientId) throw new Error("Este item não está mais no workspace deste cliente.");
  return n;
}

/** Pasta na raiz do cliente com este nome; cria quando não existe. */
async function pastaNaRaiz(servico: ServicoMinimo, clientId: string, nome: string, userId: string): Promise<{ id: string; criada: boolean }> {
  const { data } = await servico.from("workspace_nodes").select("id").eq("scope", "client").eq("client_id", clientId).is("parent_id", null).eq("kind", "folder").eq("name", nome).limit(1);
  const existente = ((data ?? []) as Array<{ id: string }>)[0];
  if (existente) return { id: existente.id, criada: false };
  const { data: nova, error } = await servico
    .from("workspace_nodes")
    .insert({ name: nome, kind: "folder", scope: "client", client_id: clientId, parent_id: null, created_by: userId })
    .select("id")
    .single();
  if (error || !nova) throw new Error(`Não foi possível criar a pasta ${nome}.`);
  return { id: (nova as { id: string }).id, criada: true };
}

async function moverNo(servico: ServicoMinimo, clientId: string, id: string, parentId: string | null) {
  if (parentId) {
    const destino = await lerNo(servico, clientId, parentId);
    if (destino.kind !== "folder") throw new Error("O destino não é uma pasta.");
    // Pasta não vai para dentro dela mesma: sobe pelos pais do destino.
    let atual: string | null = destino.id;
    for (let i = 0; atual && i < 30; i++) {
      if (atual === id) throw new Error("Uma pasta não vai para dentro dela mesma.");
      const lido: { data: unknown } = await servico.from("workspace_nodes").select("parent_id").eq("id", atual).maybeSingle();
      atual = (lido.data as { parent_id: string | null } | null)?.parent_id ?? null;
    }
  }
  const { error } = await servico.from("workspace_nodes").update({ parent_id: parentId }).eq("id", id).eq("client_id", clientId);
  if (error) throw new Error("Não foi possível mover. Confira se já existe um item com o mesmo nome no destino.");
}

/** Uma operação no workspace, já confirmada. */
export async function executarNoWorkspace(
  servico: ServicoMinimo,
  clientId: string,
  userId: string,
  item: ItemDaAcaoDoAgente,
): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const n = await lerNo(servico, clientId, item.alvo_id);
  switch (item.operacao) {
    case "mover": {
      const para = String(item.para ?? "");
      let destino: string | null = null;
      let pastaCriada: string | null = null;
      if (para === "raiz") destino = null;
      else if (para.indexOf("nova:") === 0) {
        const p = await pastaNaRaiz(servico, clientId, para.slice(5), userId);
        destino = p.id;
        if (p.criada) pastaCriada = p.id;
      } else destino = para;
      if (destino === n.parent_id) return { aviso: "já estava nesta pasta" };
      await moverNo(servico, clientId, n.id, destino);
      return { desfazer: { parent_id: n.parent_id, pasta_criada: pastaCriada } };
    }
    case "renomear": {
      const { error } = await servico.from("workspace_nodes").update({ name: String(item.para) }).eq("id", n.id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível renomear. Confira se já existe um item com este nome na pasta.");
      return { desfazer: { name: n.name } };
    }
    case "arquivar": {
      const p = await pastaNaRaiz(servico, clientId, PASTA_DE_ARQUIVADOS, userId);
      if (p.id === n.id) throw new Error("A pasta Arquivados fica onde está.");
      if (n.parent_id === p.id) return { aviso: "já estava em Arquivados" };
      await moverNo(servico, clientId, n.id, p.id);
      return { desfazer: { parent_id: n.parent_id } };
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** Desfaz uma operação no workspace (a pasta criada fica: vazia, não atrapalha, e nada é apagado). */
export async function reverterNoWorkspace(servico: ServicoMinimo, clientId: string, r: ResultadoDoItem): Promise<void> {
  const d = (r.desfazer ?? {}) as Record<string, unknown>;
  if (r.operacao === "renomear") {
    const { error } = await servico.from("workspace_nodes").update({ name: String(d.name) }).eq("id", r.alvo_id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível voltar o nome.");
    return;
  }
  if (r.operacao === "mover" || r.operacao === "arquivar") {
    await moverNo(servico, clientId, r.alvo_id, (d.parent_id as string | null) ?? null);
  }
}
