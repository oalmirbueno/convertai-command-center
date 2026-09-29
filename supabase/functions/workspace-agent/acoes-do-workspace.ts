/**
 * Ações do agente do Workspace (frente AG3, 29/09). Pedido do dono: "todos
 * agênticos: a conversa vira ação real". No Workspace: organizar pastas,
 * renomear, mover e arquivar arquivos e pastas do cliente.
 *
 * Contrato comum (../_shared/acoes-do-agente.ts): o modelo nunca vê id; vê
 * apelidos n1..nN (itens do Workspace do cliente) e r1 (a raiz do cliente).
 * Ordem clara vai direto, com Desfazer; o resto vira cartão com Confirmar.
 *
 * Operações (todas sem custo e com Desfazer):
 * - criar_pasta: ref r1 ou n# (pasta); para = nome. Desfazer apaga a pasta
 *   criada se continuar vazia.
 * - renomear: ref n#; para = nome novo. Desfazer volta o nome (se ninguém
 *   mudou depois).
 * - mover: ref n#; para = r1 ou n# de uma pasta. Nunca para dentro dele
 *   mesmo nem de uma subpasta dele. Desfazer volta a pasta de antes.
 * - arquivar: ref n#; vai para a pasta "Arquivo" na raiz do cliente (nasce
 *   se não existir). workspace_nodes não tem archived_at: arquivar é mover,
 *   e nada é apagado. Item enviado para aprovação não sai do lugar.
 *
 * Sem import de Deno: o vitest lê este arquivo. Sem travessão.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
  type ValorPara,
} from "../_shared/acoes-do-agente.ts";

export const AGENTE_DO_WORKSPACE = "workspace";
export const OPERACOES_DO_WORKSPACE = ["criar_pasta", "renomear", "mover", "arquivar"] as const;
export const NOME_DA_PASTA_DE_ARQUIVO = "Arquivo";
export const RAIZ = "raiz";

export const DESCRICOES_DO_WORKSPACE: Record<(typeof OPERACOES_DO_WORKSPACE)[number], string> = {
  criar_pasta: "ref r1 (raiz do cliente) ou n# de uma pasta. para: o nome da pasta nova.",
  renomear: "ref n#. para: o nome novo (sem barra).",
  mover: "ref n#. para: r1 (raiz) ou o apelido n# da pasta de destino.",
  arquivar: `ref n#. Vai para a pasta "${NOME_DA_PASTA_DE_ARQUIVO}" do cliente (nada é apagado). para vazio.`,
};

export type NoDoWorkspace = {
  id: string;
  name: string;
  kind: "folder" | "file" | string;
  parent_id: string | null;
  client_id: string | null;
  sent_for_approval_file_id?: string | null;
};

type AlvoDoWorkspace = Alvo & { dados: { kind: string; parent_id: string | null; caminho: string; aprovacao: boolean } };

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Nome válido de pasta ou arquivo: 1 a 120 caracteres, sem barra. */
export function nomeValido(v: unknown): string | null {
  const s = umaLinha(v, 120).replace(/[\\/]/g, "-").trim();
  return s.length >= 1 && s !== "." && s !== ".." ? s : null;
}

/** Caminho legível ("Artes/Outubro/post.png") subindo pelos pais conhecidos. */
export function caminhoDoNo(no: NoDoWorkspace, porId: Map<string, NoDoWorkspace>): string {
  const partes: string[] = [no.name];
  let pai = no.parent_id ? porId.get(no.parent_id) : undefined;
  let voltas = 0;
  while (pai && voltas < 12) {
    partes.unshift(pai.name);
    pai = pai.parent_id ? porId.get(pai.parent_id) : undefined;
    voltas++;
  }
  return partes.join("/");
}

/** O destino está dentro do item (ou é ele)? Mover para lá criaria um laço. */
export function destinoDentroDoItem(itemId: string, destinoId: string | null, porId: Map<string, NoDoWorkspace>): boolean {
  let atual = destinoId;
  let voltas = 0;
  while (atual && voltas < 64) {
    if (atual === itemId) return true;
    const no = porId.get(atual);
    atual = no ? no.parent_id : null;
    voltas++;
  }
  return false;
}

/** r1 (raiz) e n1..nN (pastas primeiro, depois arquivos, do mais novo para o mais antigo como veio). */
export function alvosDoWorkspace(clientId: string, nomeDoCliente: string, nos: NoDoWorkspace[]) {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const raiz = comApelido<AlvoDoWorkspace>([
    { id: RAIZ, titulo: `Raiz de ${nomeDoCliente || "cliente"}`, detalhe: "pasta principal do cliente", dados: { kind: "folder", parent_id: null, caminho: "", aprovacao: false } },
  ], "r");
  const ordenados = nos.filter((n) => n.client_id === clientId).slice().sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder"));
  const itens = comApelido<AlvoDoWorkspace>(ordenados.map((n) => {
    const caminho = caminhoDoNo(n, porId);
    return {
      id: n.id,
      titulo: umaLinha(n.name, 140) || "sem nome",
      detalhe: `${n.kind === "folder" ? "Pasta" : "Arquivo"} · /${umaLinha(caminho, 140)}${n.sent_for_approval_file_id ? " · enviado para aprovação" : ""}`,
      dados: { kind: String(n.kind), parent_id: n.parent_id, caminho, aprovacao: !!n.sent_for_approval_file_id },
    };
  }), "n");
  return { raiz, itens, todos: ([] as Array<AlvoComApelido<AlvoDoWorkspace>>).concat(raiz, itens), porId };
}

export type AlvosDoWorkspace = ReturnType<typeof alvosDoWorkspace>;

/** Regras: todas diretas (sem custo e com Desfazer). O destino do mover vira id; o rótulo, o nome da pasta. */
export function regrasDoWorkspace(a: AlvosDoWorkspace): Record<string, RegraDaOperacao<AlvoDoWorkspace>> {
  const porRef = new Map(a.todos.map((x) => [x.ref.toLowerCase(), x]));
  const pastaPeloApelido = (v: unknown): string | null => {
    const alvo = porRef.get(umaLinha(v, 12).toLowerCase());
    if (!alvo || alvo.dados.kind !== "folder") return null;
    return alvo.id;
  };
  return {
    criar_pasta: {
      rotulo: "criar a pasta",
      alvos: ["r", "n"],
      combina: true,
      repete: true,
      direta: true,
      para: (v) => nomeValido(v),
      trava: (alvo) => (alvo.dados.kind !== "folder" ? "Só dá para criar pasta dentro de uma pasta." : null),
    },
    renomear: {
      rotulo: "renomear para",
      alvos: ["n"],
      combina: true,
      direta: true,
      para: (v) => nomeValido(v),
      trava: (alvo, para) => (alvo.titulo === para ? "Já tem este nome." : null),
    },
    mover: {
      rotulo: "mover para",
      alvos: ["n"],
      combina: true,
      direta: true,
      para: (v) => pastaPeloApelido(v),
      trava: (alvo, para) => {
        const destino = para === RAIZ ? null : String(para);
        if (alvo.dados.aprovacao) return "Enviado para aprovação: não sai do lugar.";
        if ((alvo.dados.parent_id || null) === destino) return "Já está nesta pasta.";
        if (destino && destinoDentroDoItem(alvo.id, destino, a.porId)) return "Não dá para mover uma pasta para dentro dela mesma.";
        return null;
      },
    },
    arquivar: {
      rotulo: "arquivar",
      alvos: ["n"],
      direta: true,
      trava: (alvo) => {
        if (alvo.dados.aprovacao) return "Enviado para aprovação: não sai do lugar.";
        if (alvo.dados.kind === "folder" && alvo.titulo === NOME_DA_PASTA_DE_ARQUIVO && !alvo.dados.parent_id) return "Esta já é a pasta de arquivo.";
        const pai = alvo.dados.parent_id ? a.porId.get(alvo.dados.parent_id) : null;
        if (pai && pai.name === NOME_DA_PASTA_DE_ARQUIVO && !pai.parent_id) return "Já está arquivado.";
        return null;
      },
    },
  };
}

/** Rótulo do "para" no cartão: o nome da pasta de destino (o id nunca aparece). */
export function rotuloDoPara(a: AlvosDoWorkspace) {
  return (operacao: string, para: ValorPara): string | null => {
    if (operacao !== "mover") return null;
    if (para === RAIZ) return "raiz do cliente";
    const no = a.porId.get(String(para));
    return no ? `/${caminhoDoNo(no, a.porId)}` : null;
  };
}

export function blocoDasAcoesDoWorkspace(a: AlvosDoWorkspace): string {
  return [
    blocoDosAlvos("RAIZ DO CLIENTE", a.raiz),
    blocoDosAlvos("ITENS DO WORKSPACE DO CLIENTE", a.itens, "nenhum."),
    regraDasAcoes(DESCRICOES_DO_WORKSPACE),
  ].join("");
}

export function normalizarAcoesDoWorkspace(bruto: unknown, a: AlvosDoWorkspace, opcoes: { clientId: string; id?: string }): AcaoDoAgente | null {
  return normalizarAcaoDoAgente(bruto, a.todos, regrasDoWorkspace(a), {
    agente: AGENTE_DO_WORKSPACE,
    id: opcoes.id,
    contexto: { client_id: opcoes.clientId },
    rotuloDoPara: rotuloDoPara(a),
  });
}

/** Pedido com cara de organizar o Workspace (filtro barato antes do Jev). */
export function pareceOrganizar(texto: unknown): boolean {
  const t = String(texto ?? "").toLowerCase();
  return /\b(pasta|pastas|mova|mover|move|movam|renomei[ae]|renomear|arquiv[ae]|arquivar|organiz[ae]|organizar|reorganiz)/.test(t);
}

// ------------------------------------------------------------------ execução (banco por parâmetro)

// deno-lint-ignore no-explicit-any
export type BancoDoWorkspace = { from: (tabela: string) => any };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function noDoCliente(db: BancoDoWorkspace, clientId: string, id: string): Promise<NoDoWorkspace & { scope?: string }> {
  if (!UUID.test(id)) throw new Error("Item inválido.");
  const { data, error } = await db.from("workspace_nodes").select("id, name, kind, parent_id, client_id, scope, sent_for_approval_file_id").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível ler o item.");
  const n = data as (NoDoWorkspace & { scope?: string }) | null;
  if (!n || n.client_id !== clientId) throw new Error("Este item não está mais no Workspace do cliente.");
  return n;
}

/** Pasta de destino (null = raiz), conferida no banco: do mesmo cliente e pasta de verdade. */
async function pastaDoCliente(db: BancoDoWorkspace, clientId: string, id: string | null): Promise<string | null> {
  if (!id || id === RAIZ) return null;
  const p = await noDoCliente(db, clientId, id);
  if (p.kind !== "folder") throw new Error("O destino não é uma pasta.");
  return p.id;
}

/** Sobe pelos pais no banco: o destino não pode estar dentro do item. */
async function dentroDoItemNoBanco(db: BancoDoWorkspace, itemId: string, destinoId: string | null): Promise<boolean> {
  let atual = destinoId;
  for (let i = 0; atual && i < 64; i++) {
    if (atual === itemId) return true;
    const { data } = await db.from("workspace_nodes").select("id, parent_id").eq("id", atual).maybeSingle();
    atual = data ? ((data as { parent_id: string | null }).parent_id) : null;
  }
  return false;
}

/** A pasta "Arquivo" na raiz do cliente (cria se não existir). */
async function pastaDeArquivo(db: BancoDoWorkspace, clientId: string, userId: string): Promise<{ id: string; criada: boolean }> {
  const { data } = await db.from("workspace_nodes").select("id").eq("client_id", clientId).eq("kind", "folder").eq("name", NOME_DA_PASTA_DE_ARQUIVO).is("parent_id", null).limit(1);
  const achada = ((data as { id: string }[] | null) ?? [])[0];
  if (achada) return { id: achada.id, criada: false };
  const { data: nova, error } = await db.from("workspace_nodes").insert({ scope: "client", client_id: clientId, kind: "folder", name: NOME_DA_PASTA_DE_ARQUIVO, parent_id: null, created_by: userId }).select("id").single();
  if (error || !nova) throw new Error("Não foi possível criar a pasta de arquivo.");
  return { id: (nova as { id: string }).id, criada: true };
}

export async function executarItemDoWorkspace(
  db: BancoDoWorkspace,
  clientId: string,
  item: { operacao: string; alvo_id: string; para: ValorPara; titulo: string },
  deps: { userId: string },
): Promise<{ desfazer: Record<string, unknown>; aviso?: string }> {
  switch (item.operacao) {
    case "criar_pasta": {
      const nome = nomeValido(item.para);
      if (!nome) throw new Error("Nome de pasta inválido.");
      const pai = await pastaDoCliente(db, clientId, item.alvo_id);
      const { data, error } = await db.from("workspace_nodes").insert({ scope: "client", client_id: clientId, kind: "folder", name: nome, parent_id: pai, created_by: deps.userId }).select("id").single();
      if (error || !data) throw new Error("Não foi possível criar a pasta.");
      return { desfazer: { criado_id: (data as { id: string }).id } };
    }
    case "renomear": {
      const nome = nomeValido(item.para);
      if (!nome) throw new Error("Nome inválido.");
      const n = await noDoCliente(db, clientId, item.alvo_id);
      // O valor de antes é guardado antes de gravar (é o que o Desfazer devolve).
      const antes = { name: n.name };
      const { error } = await db.from("workspace_nodes").update({ name: nome }).eq("id", n.id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível renomear.");
      return { desfazer: { no_id: n.id, antes, depois: { name: nome } } };
    }
    case "mover": {
      const n = await noDoCliente(db, clientId, item.alvo_id);
      if (n.sent_for_approval_file_id) throw new Error("Enviado para aprovação: não sai do lugar.");
      const destino = await pastaDoCliente(db, clientId, item.para === null ? null : String(item.para));
      if (destino && (await dentroDoItemNoBanco(db, n.id, destino))) throw new Error("Não dá para mover uma pasta para dentro dela mesma.");
      const antes = { parent_id: n.parent_id };
      const { error } = await db.from("workspace_nodes").update({ parent_id: destino }).eq("id", n.id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível mover.");
      return { desfazer: { no_id: n.id, antes, depois: { parent_id: destino } } };
    }
    case "arquivar": {
      const n = await noDoCliente(db, clientId, item.alvo_id);
      if (n.sent_for_approval_file_id) throw new Error("Enviado para aprovação: não sai do lugar.");
      const arquivo = await pastaDeArquivo(db, clientId, deps.userId);
      if (arquivo.id === n.id) throw new Error("Esta já é a pasta de arquivo.");
      const antes = { parent_id: n.parent_id };
      const { error } = await db.from("workspace_nodes").update({ parent_id: arquivo.id }).eq("id", n.id).eq("client_id", clientId);
      if (error) throw new Error("Não foi possível arquivar.");
      return { desfazer: { no_id: n.id, antes, depois: { parent_id: arquivo.id } }, aviso: arquivo.criada ? `pasta ${NOME_DA_PASTA_DE_ARQUIVO} criada` : undefined };
    }
    default:
      throw new Error("Operação desconhecida.");
  }
}

/** Desfaz um item, só onde ninguém mexeu depois. */
export async function reverterItemDoWorkspace(
  db: BancoDoWorkspace,
  clientId: string,
  r: { operacao: string; desfazer?: Record<string, unknown> | null },
): Promise<void> {
  const d = (r.desfazer || {}) as Record<string, unknown>;
  if (r.operacao === "criar_pasta") {
    const id = String(d.criado_id || "");
    await noDoCliente(db, clientId, id);
    const { data } = await db.from("workspace_nodes").select("id").eq("parent_id", id).limit(1);
    if (((data as unknown[] | null) ?? []).length) throw new Error("A pasta já recebeu itens: não foi apagada.");
    const { error } = await db.from("workspace_nodes").delete().eq("id", id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível apagar a pasta criada.");
    return;
  }
  const id = String(d.no_id || "");
  const n = await noDoCliente(db, clientId, id);
  const antes = (d.antes || {}) as Record<string, unknown>;
  const depois = (d.depois || {}) as Record<string, unknown>;
  if (r.operacao === "renomear") {
    if (n.name !== depois.name) throw new Error("O nome mudou depois: ficou como está.");
    const { error } = await db.from("workspace_nodes").update({ name: antes.name }).eq("id", id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível voltar o nome.");
    return;
  }
  if (r.operacao === "mover" || r.operacao === "arquivar") {
    if ((n.parent_id || null) !== ((depois.parent_id as string | null) || null)) throw new Error("O item foi movido depois: ficou como está.");
    const volta = (antes.parent_id as string | null) || null;
    if (volta) await pastaDoCliente(db, clientId, volta);
    const { error } = await db.from("workspace_nodes").update({ parent_id: volta }).eq("id", id).eq("client_id", clientId);
    if (error) throw new Error("Não foi possível voltar o item.");
    return;
  }
  throw new Error("Sem o que desfazer.");
}
