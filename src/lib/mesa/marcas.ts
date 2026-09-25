import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Marcas por projeto dentro do mesmo cliente (pedido do dono em 25/09: "na
 * Acerbi tem o projeto da Acerbi e o da CME, com logo diferente; selecionar
 * em cima, dentro da Acerbi, o contexto da Acerbi ou da CME").
 *
 * Tabela cliente_marcas (docs/marcas/01_cliente_marcas.sql). É raro: só a
 * Acerbi tem. Cliente sem marca cadastrada, ou banco sem a tabela ainda,
 * volta lista vazia e nada muda na tela nem nas chamadas.
 *
 * A marca escolhida mora no endereço (?marca=<id>) e na casca de cada mesa;
 * `definirMarcaAtual` guarda a escolha para `chamarFuncao` (src/lib/mesa/api.ts)
 * mandar `marca_id` às funções da Mesa sem cada tela precisar repassar.
 */

export interface MarcaDoCliente {
  id: string;
  client_id: string;
  project_id: string | null;
  nome: string;
  principal: boolean;
  ordem: number;
  paleta: { nome?: string; hex?: string; papel?: string }[];
  logo_path: string | null;
  logo_alt_path: string | null;
  logo_file_id: string | null;
  logo_alt_file_id: string | null;
  estilo: string | null;
  regras: string | null;
  tom: string | null;
  contexto_extra: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUNAS =
  "id, client_id, project_id, nome, principal, ordem, paleta, logo_path, logo_alt_path, logo_file_id, logo_alt_file_id, estilo, regras, tom, contexto_extra";

/** Linha do banco em forma segura (paleta sempre lista, ordem sempre número). */
export function normalizarMarca(bruta: any): MarcaDoCliente | null {
  if (!bruta || typeof bruta !== "object" || !UUID.test(String(bruta.id || ""))) return null;
  return {
    id: String(bruta.id),
    client_id: String(bruta.client_id || ""),
    project_id: bruta.project_id ? String(bruta.project_id) : null,
    nome: String(bruta.nome || "Marca").slice(0, 80),
    principal: bruta.principal === true,
    ordem: typeof bruta.ordem === "number" && isFinite(bruta.ordem) ? bruta.ordem : 0,
    paleta: Array.isArray(bruta.paleta) ? bruta.paleta : [],
    logo_path: bruta.logo_path || null,
    logo_alt_path: bruta.logo_alt_path || null,
    logo_file_id: bruta.logo_file_id || null,
    logo_alt_file_id: bruta.logo_alt_file_id || null,
    estilo: bruta.estilo || null,
    regras: bruta.regras || null,
    tom: bruta.tom || null,
    contexto_extra: bruta.contexto_extra || null,
  };
}

/** Principal primeiro, depois pela ordem e pelo nome. */
export function ordenarMarcas(marcas: MarcaDoCliente[]): MarcaDoCliente[] {
  return marcas.slice().sort((a, b) => {
    if (a.principal !== b.principal) return a.principal ? -1 : 1;
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** Lê as marcas do cliente. Sem a tabela (SQL ainda não aplicado) ou com erro: lista vazia. */
export async function lerMarcasDoCliente(clientId: string): Promise<MarcaDoCliente[]> {
  if (!UUID.test(clientId)) return [];
  try {
    const { data, error } = await (supabase as any).from("cliente_marcas").select(COLUNAS).eq("client_id", clientId);
    if (error) return [];
    const lista = ((data || []) as any[]).map(normalizarMarca).filter((m): m is MarcaDoCliente => !!m && m.client_id === clientId);
    return ordenarMarcas(lista);
  } catch {
    return [];
  }
}

export const chaveDasMarcas = (clientId: string) => ["mesa", "marcas", clientId] as const;

/** Marcas do cliente (vai para o cache do navegador: a casca abre já com o seletor). */
export function useMarcasDoCliente(clientId: string) {
  return useQuery({
    queryKey: chaveDasMarcas(clientId),
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: () => lerMarcasDoCliente(clientId),
  });
}

/**
 * A marca aberta: a do endereço quando é do cliente; senão a principal;
 * senão a primeira. Com menos de 2 marcas não há escolha: null (tudo como antes).
 */
export function marcaEscolhida(marcas: MarcaDoCliente[], idDoEndereco: string | null | undefined): MarcaDoCliente | null {
  if (marcas.length < 2) return null;
  const pedida = idDoEndereco ? marcas.find((m) => m.id === idDoEndereco) : undefined;
  return pedida || marcas.find((m) => m.principal) || marcas[0];
}

/**
 * Projetos da marca: a que não é principal fica só com o projeto dela; a
 * principal com todos os outros (os que não são de nenhuma outra marca).
 * Sem marca: null (sem filtro). Mesma regra de supabase/functions/_shared/marca.ts.
 */
export function projetosDaMarca(marca: MarcaDoCliente | null, marcas: MarcaDoCliente[]): { so: string[] } | { menos: string[] } | null {
  if (!marca) return null;
  if (!marca.principal) return { so: marca.project_id ? [marca.project_id] : [] };
  return { menos: marcas.filter((m) => m.id !== marca.id && m.project_id).map((m) => m.project_id as string) };
}

/** O item (tarefa) é da marca? Sem marca, sempre. */
export function itemDaMarca(projectId: string | null | undefined, filtro: ReturnType<typeof projetosDaMarca>): boolean {
  if (!filtro) return true;
  const p = projectId || "";
  if ("so" in filtro) return filtro.so.indexOf(p) >= 0;
  return filtro.menos.indexOf(p) < 0;
}

/** Projetos (da lista de projetos do cliente) que são da marca; sem filtro, a mesma lista. */
export function projetosDaListaNaMarca<T extends { id: string }>(projetos: T[], filtro: ReturnType<typeof projetosDaMarca>): T[] {
  if (!filtro) return projetos;
  return projetos.filter((p) => itemDaMarca(p.id, filtro));
}

/** Filtra uma lista de itens com project_id pela marca (mesmo array quando não há filtro). */
export function filtrarPorMarca<T extends { project_id?: string | null }>(itens: T[], filtro: ReturnType<typeof projetosDaMarca>): T[] {
  if (!filtro) return itens;
  return itens.filter((i) => itemDaMarca(i.project_id, filtro));
}

/**
 * Agenda do mês só da marca: itens pelo projeto; post ligado a item fica com
 * a marca do item; post sem item conhecido fica só na principal (é onde
 * sempre esteve). Sem filtro, o mesmo objeto.
 */
export function agendaDaMarca<A extends { itens: { id: string; project_id?: string | null }[]; posts: { task_id: string | null }[] }>(
  agenda: A,
  filtro: ReturnType<typeof projetosDaMarca>,
): A {
  if (!filtro) return agenda;
  const ficam: Record<string, true> = {};
  const saem: Record<string, true> = {};
  for (const i of agenda.itens) {
    if (itemDaMarca(i.project_id, filtro)) ficam[i.id] = true;
    else saem[i.id] = true;
  }
  const principal = "menos" in filtro;
  return {
    ...agenda,
    itens: agenda.itens.filter((i) => ficam[i.id] === true),
    posts: agenda.posts.filter((p) => (p.task_id && ficam[p.task_id] === true) || (principal && !(p.task_id && saem[p.task_id] === true))),
  };
}

// ------------------------------------------------------ marca das chamadas

let atual: { clientId: string; marcaId: string; principal: boolean; dono: object } | null = null;

/**
 * Guarda a marca escolhida na casca para as chamadas às funções da Mesa.
 * `dono` é a casca que definiu: ao sair, ela só limpa se ainda for a dona
 * (a mesa nova monta antes da antiga desmontar).
 */
export function definirMarcaAtual(clientId: string, marca: Pick<MarcaDoCliente, "id" | "principal"> | null, dono: object) {
  atual = clientId && marca ? { clientId, marcaId: marca.id, principal: marca.principal, dono } : atual && atual.dono !== dono ? atual : null;
}

export function limparMarcaAtual(dono: object) {
  if (atual && atual.dono === dono) atual = null;
}

export function marcaAtual(): { clientId: string; marcaId: string } | null {
  return atual ? { clientId: atual.clientId, marcaId: atual.marcaId } : null;
}

/** Funções que entendem marca_id (supabase/functions/_shared/marca.ts). */
const FUNCOES_COM_MARCA = ["estudio-arte", "agente-calendario", "mesa-ads", "mesa-foto"];

/**
 * Corpo com marca_id quando há marca escolhida e a função entende: não troca
 * o que a tela já mandou nem manda a marca de um cliente para outro.
 */
export function corpoComMarca(funcao: string, corpo: Record<string, unknown>): Record<string, unknown> {
  const m = atual;
  if (!m || FUNCOES_COM_MARCA.indexOf(funcao) < 0) return corpo;
  if (corpo.marca_id !== undefined) return corpo;
  if (typeof corpo.client_id === "string" && corpo.client_id && corpo.client_id !== m.clientId) return corpo;
  return { ...corpo, marca_id: m.marcaId };
}

/**
 * marca_id da marca aberta para gravar direto numa linha nova do cliente
 * (referência enviada ou ligada): só quando é outra marca, não a principal.
 */
export function marcaParaGravarAgora(clientId: string): { marca_id: string } | Record<string, never> {
  const m = atual;
  return m && !m.principal && m.clientId === clientId ? { marca_id: m.marcaId } : {};
}

/**
 * A referência é da marca aberta? Sem marca, todas; principal, as do cliente
 * (sem marca) e as dela; outra marca, só as dela.
 */
export function referenciaDaMarca(marcaIdDaLinha: string | null | undefined, marca: Pick<MarcaDoCliente, "id" | "principal"> | null): boolean {
  if (!marca) return true;
  if (marca.principal) return !marcaIdDaLinha || marcaIdDaLinha === marca.id;
  return marcaIdDaLinha === marca.id;
}

/** marca_id para gravar direto numa linha nova (referência, fonte): só de marca que não é a principal. */
export function marcaParaGravar(clientId: string, marca: MarcaDoCliente | null): { marca_id: string } | Record<string, never> {
  return marca && !marca.principal && marca.client_id === clientId ? { marca_id: marca.id } : {};
}
