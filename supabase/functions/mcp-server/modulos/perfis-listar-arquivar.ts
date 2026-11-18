/**
 * MCP 2.29.0 (17/11/2026): listar e arquivar Referências e Concorrentes de
 * Mesa > Contexto > Perfis do Instagram.
 *
 * Puro: sem banco e sem Deno. Normaliza o pedido, decide entre arquivar e
 * "já estava arquivado" e monta a lista por aba com as contagens. Usa o mesmo
 * @ e o mesmo limite da função perfis-instagram e da tela.
 */

import {
  LIMITE_POR_PAPEL,
  normalizarHandle,
  ROTULO_DO_PAPEL,
  type PapelDoPerfil,
} from "../../perfis-instagram/modulos/perfis-instagram.ts";

export type AbaDoPerfil = "referencias" | "concorrentes";

export const ABA_DO_PAPEL: Record<PapelDoPerfil, AbaDoPerfil> = {
  referencia: "referencias",
  concorrente: "concorrentes",
};

/** Colunas lidas de cliente_perfis_instagram pelas duas ferramentas. */
export const COLUNAS_DO_PERFIL =
  "id, client_id, papel, handle, nome, seguidores, monitorar, criado_em, atualizado_em, arquivado_em";

export type LinhaDePerfil = {
  id: string;
  client_id: string;
  papel: string;
  handle: string;
  nome: string | null;
  seguidores: number | null;
  monitorar: boolean;
  criado_em: string;
  atualizado_em: string | null;
  arquivado_em: string | null;
};

export type PerfilDaLista = {
  id: string;
  handle: string;
  nome: string | null;
  seguidores: number | null;
  status: "ativo" | "arquivado";
  criado_em: string;
  atualizado_em: string | null;
  arquivado_em: string | null;
  monitorar: boolean;
};

export type ContagemDaAba = { ativos: number; limite: number; vagas: number };
export type AbaDaLista = ContagemDaAba & { perfis: PerfilDaLista[] };

/** Aceita "referencia", "referencias", "concorrente" e "concorrentes" (sem caixa e sem espaço). */
export function papelDoPedido(valor: unknown): PapelDoPerfil | null {
  const s = String(valor == null ? "" : valor).trim().toLowerCase();
  if (s === "referencia" || s === "referencias") return "referencia";
  if (s === "concorrente" || s === "concorrentes") return "concorrente";
  return null;
}

/**
 * Escopo da idempotency_key de gravar e arquivar: a chave vale por cliente.
 * O replay procura { client_id, idempotency_key } no input auditado, então a
 * mesma chave usada em outro cliente não devolve o replay do primeiro.
 */
export function escopoDaChaveDoCliente(clientId: string): { client_id: string } {
  return { client_id: clientId };
}

export const PAPEIS_ACEITOS = ["referencias", "concorrentes", "referencia", "concorrente"] as const;

export function perfilParaLista(linha: LinhaDePerfil): PerfilDaLista {
  return {
    id: linha.id,
    handle: `@${linha.handle}`,
    nome: linha.nome ?? null,
    seguidores: linha.seguidores == null ? null : Number(linha.seguidores),
    status: linha.arquivado_em ? "arquivado" : "ativo",
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em ?? null,
    arquivado_em: linha.arquivado_em ?? null,
    monitorar: Boolean(linha.monitorar),
  };
}

/** Ativos, limite e vagas de um papel. Arquivado não conta no limite. */
export function contagemDoPapel(linhas: LinhaDePerfil[], papel: PapelDoPerfil): ContagemDaAba {
  const ativos = linhas.filter((l) => l.papel === papel && !l.arquivado_em).length;
  return { ativos, limite: LIMITE_POR_PAPEL, vagas: Math.max(0, LIMITE_POR_PAPEL - ativos) };
}

const tempo = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * Lista por aba. Ativos primeiro, na ordem da tela (mais antigo primeiro);
 * depois os arquivados, o arquivado mais recente primeiro. A contagem sempre
 * olha só os ativos, mesmo quando os arquivados ficam de fora.
 */
export function montarListaPorAba(
  linhas: LinhaDePerfil[],
  opcoes: { papel?: PapelDoPerfil | null; incluirArquivados?: boolean } = {},
): Partial<Record<AbaDoPerfil, AbaDaLista>> {
  const incluirArquivados = opcoes.incluirArquivados !== false;
  const papeis: PapelDoPerfil[] = opcoes.papel ? [opcoes.papel] : ["referencia", "concorrente"];
  const saida: Partial<Record<AbaDoPerfil, AbaDaLista>> = {};
  for (const papel of papeis) {
    const doPapel = linhas.filter((l) => l.papel === papel);
    const ativos = doPapel.filter((l) => !l.arquivado_em)
      .sort((a, b) => tempo(a.criado_em) - tempo(b.criado_em));
    const arquivados = incluirArquivados
      ? doPapel.filter((l) => l.arquivado_em).sort((a, b) => tempo(b.arquivado_em) - tempo(a.arquivado_em))
      : [];
    saida[ABA_DO_PAPEL[papel]] = {
      perfis: [...ativos, ...arquivados].map(perfilParaLista),
      ...contagemDoPapel(linhas, papel),
    };
  }
  return saida;
}

export type PedidoDeArquivar =
  | { por: "id"; perfil_id: string }
  | { por: "handle"; handle: string; papel: PapelDoPerfil };

/** perfil_id ou handle + papel. Os dois juntos não passam, para não arquivar o perfil errado. */
export function normalizarPedidoDeArquivar(
  entrada: { perfil_id?: string | null; handle?: string | null; papel?: string | null },
): { ok: true; pedido: PedidoDeArquivar } | { ok: false; erro: string } {
  const temId = Boolean(entrada.perfil_id && String(entrada.perfil_id).trim());
  const temHandle = Boolean(entrada.handle && String(entrada.handle).trim());
  if (temId && temHandle) return { ok: false, erro: "Informe perfil_id ou handle, não os dois." };
  if (!temId && !temHandle) return { ok: false, erro: "Informe perfil_id ou handle (com papel)." };
  if (temId) return { ok: true, pedido: { por: "id", perfil_id: String(entrada.perfil_id).trim() } };
  const handle = normalizarHandle(entrada.handle);
  if (!handle) {
    return { ok: false, erro: `Handle inválido (${String(entrada.handle).slice(0, 80)}). Use o @ ou o link do perfil.` };
  }
  const papel = papelDoPedido(entrada.papel);
  if (!papel) return { ok: false, erro: "Com handle, informe papel: referencias ou concorrentes." };
  return { ok: true, pedido: { por: "handle", handle, papel } };
}

export const ERRO_PERFIL_NAO_ENCONTRADO = "Perfil não encontrado para este cliente.";

export type DecisaoDeArquivar =
  | { acao: "arquivar"; perfil: LinhaDePerfil }
  | { acao: "ja_arquivado"; perfil: LinhaDePerfil }
  | { acao: "erro"; erro: string };

/**
 * Decide o que fazer com as linhas do cliente que casam com o pedido.
 * As linhas já vêm presas ao client_id; ainda assim a decisão descarta outro
 * cliente, e id de outro cliente dá o mesmo erro de id inexistente.
 */
export function decidirArquivamento(
  clientId: string,
  linhas: LinhaDePerfil[],
  pedido: PedidoDeArquivar,
): DecisaoDeArquivar {
  const doCliente = linhas.filter((l) => l.client_id === clientId);
  if (pedido.por === "id") {
    const perfil = doCliente.find((l) => l.id === pedido.perfil_id);
    if (!perfil) return { acao: "erro", erro: ERRO_PERFIL_NAO_ENCONTRADO };
    return perfil.arquivado_em ? { acao: "ja_arquivado", perfil } : { acao: "arquivar", perfil };
  }
  const mesmos = doCliente.filter((l) => l.handle === pedido.handle && l.papel === pedido.papel);
  const ativo = mesmos.find((l) => !l.arquivado_em);
  if (ativo) return { acao: "arquivar", perfil: ativo };
  const arquivado = mesmos.filter((l) => l.arquivado_em)
    .sort((a, b) => tempo(b.arquivado_em) - tempo(a.arquivado_em))[0];
  if (arquivado) return { acao: "ja_arquivado", perfil: arquivado };
  return {
    acao: "erro",
    erro: `@${pedido.handle} não está em ${ROTULO_DO_PAPEL[pedido.papel]} deste cliente. Confira com aceleriq_perfis_instagram_listar.`,
  };
}
