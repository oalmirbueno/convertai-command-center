/**
 * Confirmar e Desfazer do organizador do Workspace (frente OR, 29/09/2026).
 *
 * Confirmar faz, pelo mesmo caminho que o Workspace já usa (workspace_nodes:
 * parent_id, sort_index e name), o que a pessoa viu na prévia e confirmou:
 * cria as pastas que faltam (reaproveita a que já existe com o mesmo nome no
 * mesmo lugar), move e renomeia. NUNCA apaga arquivo: o arquivo no Storage
 * não muda, só o nome de exibição e a pasta.
 *
 * Cada item guarda o antes (pasta, nome e posição) no registro do Desfazer.
 * Desfazer volta cada item que ainda está como a organização deixou (o que a
 * pessoa mexeu depois fica como está, com o motivo) e tira as pastas que a
 * organização criou e ficaram vazias. Pasta com qualquer coisa dentro fica.
 *
 * Travas: arquivo de outro cliente, pasta (só arquivo se move aqui), arquivo
 * em quarentena da pasta de recebimento, arquivo dentro de Arquivados ou da
 * pasta que recebe arquivos do cliente.
 *
 * Puro: o banco entra por `BancoDoWorkspace` (index.ts liga no Supabase com
 * a sessão de quem confirmou, então as regras de acesso do banco valem).
 */

import { comExtensao, extensao, type GrupoConfirmado, limparNome, semAcento } from "./organizador.ts";

export const PASTA_DE_ARQUIVADOS = "Arquivados";

export type NoDoIndice = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file" | string;
  name: string;
  sort_index: number | null;
  inbox_token?: string | null;
  inbox_scan_status?: string | null;
};

export type CamposDoNo = { parent_id?: string | null; name?: string; sort_index?: number };

export interface BancoDoWorkspace {
  /** Todos os nós do cliente (leve: id, pai, tipo, nome, posição, recebimento). */
  indice(): Promise<NoDoIndice[]>;
  /** Cria a pasta e devolve o id. */
  criarPasta(nome: string, parentId: string | null): Promise<string>;
  atualizar(id: string, campos: CamposDoNo): Promise<void>;
  /** Tira a pasta só se ela estiver vazia agora; true quando tirou. */
  tirarPastaVazia(id: string): Promise<boolean>;
}

export type EstadoDoNo = { parent_id: string | null; name: string; sort_index: number | null };

export type RegistroDoDesfazer = {
  versao: 1;
  client_id: string;
  parent_id: string | null;
  feito_em: string;
  itens: Array<{ id: string; antes: EstadoDoNo; depois: EstadoDoNo }>;
  /** Pastas criadas pela organização, na ordem em que nasceram. */
  pastas_criadas: string[];
};

export type ResultadoDaAplicacao = {
  registro: RegistroDoDesfazer;
  movidos: number;
  renomeados: number;
  pastas_criadas: number;
  falhas: Array<{ id: string; nome: string; motivo: string }>;
};

const chave = (t: string) => semAcento(t).toLowerCase().replace(/\s+/g, " ").trim();

/** Nome que ainda não existe na pasta ("Capa.png" -> "Capa (2).png"). */
export function nomeLivre(desejado: string, ocupados: Set<string>): string {
  if (!ocupados.has(chave(desejado))) return desejado;
  const ext = extensao(desejado);
  const base = ext ? desejado.slice(0, desejado.length - ext.length - 1) : desejado;
  for (let n = 2; n < 500; n++) {
    const tentativa = ext ? `${base} (${n}).${ext}` : `${base} (${n})`;
    if (!ocupados.has(chave(tentativa))) return tentativa;
  }
  return desejado;
}

/** Motivo quando o nó não pode ser mexido pelo organizador; null quando pode. */
export function travaDoNo(no: NoDoIndice | undefined, porId: Map<string, NoDoIndice>): string | null {
  if (!no) return "o arquivo não está mais no workspace deste cliente";
  if (no.kind !== "file") return "só arquivos são organizados (pastas ficam como estão)";
  if (no.inbox_scan_status === "pending" || no.inbox_scan_status === "blocked") return "arquivo recebido ainda em verificação";
  let atual = no.parent_id ? porId.get(no.parent_id) : undefined;
  for (let i = 0; atual && i < 40; i++) {
    if (atual.inbox_token) return "está na pasta que recebe arquivos do cliente";
    if (!atual.parent_id && atual.kind === "folder" && atual.name === PASTA_DE_ARQUIVADOS) return "está em Arquivados";
    atual = atual.parent_id ? porId.get(atual.parent_id) : undefined;
  }
  return null;
}

/**
 * Aplica o que a pessoa confirmou. Cada item responde por si: o que não pôde
 * volta em `falhas` com o motivo e o resto segue. Nada é apagado.
 */
export async function aplicarOrganizacao(
  banco: BancoDoWorkspace,
  clientId: string,
  parentId: string | null,
  grupos: GrupoConfirmado[],
  agora: () => string = () => new Date().toISOString(),
): Promise<ResultadoDaAplicacao> {
  const indice = await banco.indice();
  const porId = new Map(indice.map((n) => [n.id, n]));
  if (parentId) {
    const raiz = porId.get(parentId);
    if (!raiz || raiz.kind !== "folder") throw new Error("A pasta onde a organização começa não está mais no workspace deste cliente.");
  }
  const filhos = (pai: string | null) => indice.filter((n) => (n.parent_id || null) === pai);
  const registro: RegistroDoDesfazer = { versao: 1, client_id: clientId, parent_id: parentId, feito_em: agora(), itens: [], pastas_criadas: [] };
  const falhas: ResultadoDaAplicacao["falhas"] = [];
  let movidos = 0;
  let renomeados = 0;

  // Pasta do caminho: a que já existe com o mesmo nome no lugar, ou uma nova.
  const cachePastas = new Map<string, string>();
  const pastaDoCaminho = async (caminho: string[]): Promise<string> => {
    let atual: string | null = parentId;
    for (let i = 0; i < caminho.length; i++) {
      const nome = limparNome(caminho[i], 80) || "Pasta";
      const k = `${atual || "raiz"}|${chave(nome)}`;
      const emCache = cachePastas.get(k);
      if (emCache) {
        atual = emCache;
        continue;
      }
      const existente = filhos(atual)
        .filter((n) => n.kind === "folder" && chave(n.name) === chave(nome) && !n.inbox_token)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      let id: string;
      if (existente) id = existente.id;
      else {
        id = await banco.criarPasta(nome, atual);
        registro.pastas_criadas.push(id);
        const nova: NoDoIndice = { id, parent_id: atual, kind: "folder", name: nome, sort_index: 0 };
        indice.push(nova);
        porId.set(id, nova);
      }
      cachePastas.set(k, id);
      atual = id;
    }
    return atual as string;
  };

  for (const g of grupos) {
    let destino: string;
    try {
      destino = await pastaDoCaminho(g.caminho);
    } catch (e) {
      for (const it of g.itens) falhas.push({ id: it.id, nome: porId.get(it.id)?.name || it.nome, motivo: `não foi possível criar a pasta ${g.caminho.join(" / ")}: ${String((e as Error)?.message || e)}` });
      continue;
    }
    for (const it of g.itens) {
      const no = porId.get(it.id);
      const trava = travaDoNo(no, porId);
      if (trava || !no) {
        falhas.push({ id: it.id, nome: no?.name || it.nome, motivo: trava || "arquivo não encontrado" });
        continue;
      }
      const ocupados = new Set(filhos(destino).filter((n) => n.id !== no.id).map((n) => chave(n.name)));
      const desejado = comExtensao(it.nome || no.name, no.name);
      const nome = nomeLivre(desejado, ocupados);
      const antes: EstadoDoNo = { parent_id: no.parent_id || null, name: no.name, sort_index: no.sort_index ?? 0 };
      const depois: EstadoDoNo = { parent_id: destino, name: nome, sort_index: it.ordem ?? antes.sort_index ?? 0 };
      if (antes.parent_id === depois.parent_id && antes.name === depois.name && antes.sort_index === depois.sort_index) continue;
      const campos: CamposDoNo = {};
      if (antes.parent_id !== depois.parent_id) campos.parent_id = depois.parent_id;
      if (antes.name !== depois.name) campos.name = depois.name;
      if (antes.sort_index !== depois.sort_index) campos.sort_index = depois.sort_index ?? 0;
      try {
        await banco.atualizar(no.id, campos);
      } catch (e) {
        falhas.push({ id: no.id, nome: no.name, motivo: `não foi possível mover: ${String((e as Error)?.message || e)}` });
        continue;
      }
      if (campos.parent_id !== undefined) movidos++;
      if (campos.name !== undefined) renomeados++;
      registro.itens.push({ id: no.id, antes, depois });
      no.parent_id = depois.parent_id;
      no.name = depois.name;
      no.sort_index = depois.sort_index;
    }
  }
  return { registro, movidos, renomeados, pastas_criadas: registro.pastas_criadas.length, falhas };
}

/** Registro vindo da tela, conferido (ids, estados e a pasta de início). */
export function normalizarRegistro(bruto: unknown, clientId: string): RegistroDoDesfazer | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as RegistroDoDesfazer;
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
  if (r.versao !== 1 || r.client_id !== clientId || !Array.isArray(r.itens)) return null;
  const estado = (e: unknown): EstadoDoNo | null => {
    const x = e as EstadoDoNo;
    if (!x || typeof x !== "object") return null;
    if (x.parent_id !== null && !uuid(x.parent_id)) return null;
    const name = limparNome(x.name, 160);
    if (!name) return null;
    const s = Number(x.sort_index);
    return { parent_id: x.parent_id ?? null, name, sort_index: Number.isFinite(s) ? Math.round(s) : 0 };
  };
  const itens: RegistroDoDesfazer["itens"] = [];
  for (const it of r.itens.slice(0, 1000)) {
    const antes = estado(it?.antes);
    const depois = estado(it?.depois);
    if (!uuid(it?.id) || !antes || !depois) continue;
    itens.push({ id: it.id, antes, depois });
  }
  return {
    versao: 1,
    client_id: clientId,
    parent_id: uuid(r.parent_id) ? r.parent_id : null,
    feito_em: String(r.feito_em || ""),
    itens,
    pastas_criadas: (Array.isArray(r.pastas_criadas) ? r.pastas_criadas : []).filter(uuid).slice(0, 300),
  };
}

export type ResultadoDoDesfazer = {
  restaurados: number;
  pulados: Array<{ id: string; nome: string; motivo: string }>;
  pastas_tiradas: number;
  pastas_mantidas: number;
};

/**
 * Volta cada item ao antes, se ele ainda está como a organização deixou.
 * Depois tira as pastas criadas pela organização que ficaram vazias (da mais
 * funda para a de cima). Pasta com qualquer coisa dentro fica.
 */
export async function desfazerOrganizacao(banco: BancoDoWorkspace, registro: RegistroDoDesfazer): Promise<ResultadoDoDesfazer> {
  const indice = await banco.indice();
  const porId = new Map(indice.map((n) => [n.id, n]));
  const pulados: ResultadoDoDesfazer["pulados"] = [];
  let restaurados = 0;
  for (const it of registro.itens.slice().reverse()) {
    const no = porId.get(it.id);
    if (!no) {
      pulados.push({ id: it.id, nome: it.depois.name, motivo: "o arquivo não está mais no workspace" });
      continue;
    }
    if ((no.parent_id || null) !== it.depois.parent_id || no.name !== it.depois.name) {
      pulados.push({ id: it.id, nome: no.name, motivo: "foi mexido depois da organização; ficou como está" });
      continue;
    }
    if (it.antes.parent_id && !porId.has(it.antes.parent_id)) {
      pulados.push({ id: it.id, nome: no.name, motivo: "a pasta de antes não existe mais" });
      continue;
    }
    const campos: CamposDoNo = {};
    if ((no.parent_id || null) !== it.antes.parent_id) campos.parent_id = it.antes.parent_id;
    if (no.name !== it.antes.name) campos.name = it.antes.name;
    if ((no.sort_index ?? 0) !== (it.antes.sort_index ?? 0)) campos.sort_index = it.antes.sort_index ?? 0;
    if (!Object.keys(campos).length) continue;
    try {
      await banco.atualizar(no.id, campos);
      restaurados++;
      if (campos.parent_id !== undefined) no.parent_id = campos.parent_id;
      if (campos.name !== undefined) no.name = campos.name;
    } catch (e) {
      pulados.push({ id: it.id, nome: no.name, motivo: `não voltou: ${String((e as Error)?.message || e)}` });
    }
  }
  let tiradas = 0;
  let mantidas = 0;
  for (const id of registro.pastas_criadas.slice().reverse()) {
    const pasta = porId.get(id);
    if (!pasta || pasta.kind !== "folder") continue;
    const temFilho = indice.some((n) => n.parent_id === id && porId.has(n.id));
    if (temFilho) {
      mantidas++;
      continue;
    }
    try {
      if (await banco.tirarPastaVazia(id)) {
        tiradas++;
        porId.delete(id);
      } else mantidas++;
    } catch {
      mantidas++;
    }
  }
  return { restaurados, pulados, pastas_tiradas: tiradas, pastas_mantidas: mantidas };
}
