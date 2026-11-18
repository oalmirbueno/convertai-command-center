import { dataEmSP, diaDaSemanaDaData } from "@/lib/diaPrioritario";
import type { FaixaDaEsteira } from "./esteiraLinha";

/*
 * Organização da Esteira (pedido do Almir, 14/11/2026, 21h08): quais faixas
 * aparecem. Tudo puro e testável; a tela só guarda o estado e chama daqui.
 * (O "+N" da célula saiu em 21h55: cada dia passou a rolar por dentro.)
 *
 * O filtro só esconde faixas, nunca reordena: a ordem continua a de
 * montarGrade (nome em pt-BR).
 */

/** Chave do localStorage. Fica só neste aparelho: nada de cookie nem banco. */
export const CHAVE_DO_FILTRO_DE_CLIENTES = "aceleriq:esteira:filtro-clientes";

export type ModoDoFiltro = "todos" | "prioritarios_hoje" | "clientes";

export interface FiltroDeClientes {
  v: 1;
  modo: ModoDoFiltro;
  /** Só tem sentido no modo `clientes`; nos outros modos fica vazio. */
  ids: string[];
}

export const FILTRO_TODOS: FiltroDeClientes = { v: 1, modo: "todos", ids: [] };

const MODOS: ReadonlySet<string> = new Set<ModoDoFiltro>(["todos", "prioritarios_hoje", "clientes"]);

/** Lê o valor guardado. Qualquer coisa estranha (JSON quebrado, versão ou modo desconhecido) vira "Todos". */
export function lerFiltroDeClientes(bruto: string | null | undefined): FiltroDeClientes {
  if (!bruto) return FILTRO_TODOS;
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return FILTRO_TODOS;
  }
  if (!valor || typeof valor !== "object") return FILTRO_TODOS;
  const { v, modo, ids } = valor as Record<string, unknown>;
  if (v !== 1 || typeof modo !== "string" || !MODOS.has(modo)) return FILTRO_TODOS;
  if (modo !== "clientes") return { v: 1, modo: modo as ModoDoFiltro, ids: [] };
  const lista = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  return lista.length > 0 ? { v: 1, modo: "clientes", ids: lista } : FILTRO_TODOS;
}

export const serializarFiltroDeClientes = (filtro: FiltroDeClientes): string =>
  JSON.stringify({ v: 1, modo: filtro.modo, ids: filtro.modo === "clientes" ? filtro.ids : [] });

/** localStorage pode não existir ou estar bloqueado (modo privado): nesses casos, "Todos" sem quebrar. */
export function lerFiltroGuardado(armazenamento: Pick<Storage, "getItem"> | null | undefined): FiltroDeClientes {
  try {
    return lerFiltroDeClientes(armazenamento?.getItem(CHAVE_DO_FILTRO_DE_CLIENTES));
  } catch {
    return FILTRO_TODOS;
  }
}

export function gravarFiltro(armazenamento: Pick<Storage, "setItem"> | null | undefined, filtro: FiltroDeClientes): void {
  try {
    armazenamento?.setItem(CHAVE_DO_FILTRO_DE_CLIENTES, serializarFiltroDeClientes(filtro));
  } catch {
    // Sem espaço ou bloqueado: a seleção vale só nesta aba.
  }
}

/**
 * Tira da seleção os ids que não estão mais na carteira. Se não sobrar
 * nenhum, volta para "Todos" (a grade nunca fica em branco sem explicação).
 */
export function ajustarFiltroACarteira(filtro: FiltroDeClientes, idsDaCarteira: readonly string[]): FiltroDeClientes {
  if (filtro.modo !== "clientes") return filtro;
  const existe = new Set(idsDaCarteira);
  const ids = filtro.ids.filter((id) => existe.has(id));
  if (ids.length === 0) return FILTRO_TODOS;
  return ids.length === filtro.ids.length ? filtro : { v: 1, modo: "clientes", ids };
}

/** Escolher um modo limpa a seleção individual. */
export const escolherModo = (modo: Exclude<ModoDoFiltro, "clientes">): FiltroDeClientes => ({ v: 1, modo, ids: [] });

/**
 * Clique no chip de um cliente: sai de "Todos"/"Só prioritários hoje" e entra
 * na seleção; clicar de novo tira. Seleção vazia volta para "Todos".
 */
export function alternarCliente(filtro: FiltroDeClientes, id: string): FiltroDeClientes {
  const atuais = filtro.modo === "clientes" ? filtro.ids : [];
  const ids = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
  return ids.length === 0 ? FILTRO_TODOS : { v: 1, modo: "clientes", ids };
}

/** Dia da semana de hoje em São Paulo (1 = segunda … 7 = domingo). */
export const diaDaSemanaEmSP = (agora: Date): number => diaDaSemanaDaData(dataEmSP(agora));

/**
 * Quem tem o dia prioritário hoje. Sábado e domingo não são dia prioritário
 * de ninguém (o cadastro só aceita 1 a 5), então a lista fica vazia.
 * Quem está com o dia suspenso (pausa) já chega com `diaPrioritario` nulo.
 */
export const prioritariosDeHoje = <F extends Pick<FaixaDaEsteira, "diaPrioritario">>(faixas: readonly F[], diaDeHoje: number): F[] =>
  faixas.filter((f) => f.diaPrioritario !== null && f.diaPrioritario === diaDeHoje);

/** Aplica o filtro sem mudar a ordem das faixas. */
export function aplicarFiltroDeClientes<F extends Pick<FaixaDaEsteira, "clientId" | "diaPrioritario">>(
  faixas: readonly F[],
  filtro: FiltroDeClientes,
  diaDeHoje: number,
): F[] {
  if (filtro.modo === "prioritarios_hoje") return prioritariosDeHoje(faixas, diaDeHoje);
  if (filtro.modo === "clientes") {
    const escolhidos = new Set(filtro.ids);
    return faixas.filter((f) => escolhidos.has(f.clientId));
  }
  return [...faixas];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Busca do seletor: pelo nome, sem ligar para acento nem caixa. Mantém a ordem. */
export function buscarClientesPeloNome<F extends Pick<FaixaDaEsteira, "nome">>(faixas: readonly F[], termo: string): F[] {
  const alvo = semAcento(termo);
  if (!alvo) return [...faixas];
  return faixas.filter((f) => semAcento(f.nome).includes(alvo));
}

/*
 * Cor de apoio por cliente (o traço lateral da faixa e o ponto do chip).
 * Estável pelo id e fora da paleta das etapas: sem cinza, violeta, âmbar ou
 * verde, para não competir com ESTILO_DA_ETAPA. Classes inteiras para o
 * Tailwind gerar.
 */
export const CORES_DE_APOIO_DO_CLIENTE = [
  { faixa: "border-l-sky-500", ponto: "bg-sky-500" },
  { faixa: "border-l-rose-500", ponto: "bg-rose-500" },
  { faixa: "border-l-indigo-500", ponto: "bg-indigo-500" },
  { faixa: "border-l-cyan-500", ponto: "bg-cyan-500" },
  { faixa: "border-l-pink-500", ponto: "bg-pink-500" },
  { faixa: "border-l-blue-500", ponto: "bg-blue-500" },
  { faixa: "border-l-fuchsia-500", ponto: "bg-fuchsia-500" },
] as const;

export function corDeApoioDoCliente(id: string): (typeof CORES_DE_APOIO_DO_CLIENTE)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CORES_DE_APOIO_DO_CLIENTE[h % CORES_DE_APOIO_DO_CLIENTE.length];
}
