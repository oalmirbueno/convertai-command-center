/**
 * Clones: edição depois de criado (pedido do dono, 25/09 à noite: "quando
 * estou criando o clone ele limita a só aquelas fotos; às vezes quero mudar
 * uma foto porque não ficou tão parecido, excluir, trocar de fotos para gerar
 * novamente, e ele não deixa; também apagar, clonar e tal"). Regras puras
 * (sem rede, sem banco, sem Deno): clones.ts usa e o teste do painel importa.
 *
 * - Fotos de origem editáveis a qualquer momento, com o mesmo limite e a
 *   mesma qualidade mínima da criação (validarFotosDeOrigem é usada nos dois).
 * - Folha "feita com as fotos antigas": a vista guarda as fotos reais que
 *   foram ao gerador (fontes); se uma delas saiu, ou se entrou foto nova
 *   depois que a vista nasceu, ela fica desatualizada. Continua guardada, mas
 *   não vai mais ao gerador como identidade.
 * - Apagar é arquivar (com desfazer): vista marcada, variação inativa no
 *   acervo, clone com status arquivada. Nada de exclusão definitiva.
 * - Duplicar mantém as fotos de origem e a MESMA autorização, conferida de
 *   novo (sem autorização válida não nasce clone, nem cópia).
 */

import { ErroDeRegra, limpo, UUID } from "./calculos.ts";
import { lerAutorizacaoDoClone, lerFotosReais, MAX_FOTOS_REAIS, type AutorizacaoDoClone } from "./clones-regras.ts";

/** Lado menor mínimo de uma foto de origem (abaixo disso o rosto não tem detalhe para servir de identidade). */
export const LADO_MINIMO_FOTO_REAL = 256;

export type EntradaReal = { imagem_id: string; client_id: string; principal: boolean; adicionada_em?: string | null };

export type FotoParaOrigem = {
  id: string;
  gerada?: boolean | null;
  modo?: string | null;
  tags?: string[] | null;
  ativa?: boolean | null;
  largura?: number | null;
  altura?: number | null;
};

/** Por que esta foto não serve de origem do clone (null = serve). A tela usa a mesma regra. */
export function problemaDaFotoDeOrigem(f: FotoParaOrigem): string | null {
  if (f.gerada === true || f.modo === "clone") return "foto gerada por IA não vira identidade";
  if ((f.tags ?? []).includes("referencia_web")) return "foto da internet não vira identidade";
  if (f.ativa === false) return "foto arquivada no acervo";
  if (f.largura && f.altura && Math.min(f.largura, f.altura) < LADO_MINIMO_FOTO_REAL) return `foto pequena demais (menos de ${LADO_MINIMO_FOTO_REAL} px no lado menor)`;
  return null;
}

/**
 * Fotos de origem (criação e edição): 1 a 4 ids únicos, todas do acervo do
 * cliente, reais (nem gerada nem da internet), ativas e com tamanho mínimo.
 * Devolve os ids na ordem pedida.
 */
export function validarFotosDeOrigem(bruto: unknown, achadas: FotoParaOrigem[]): string[] {
  const ids = lerFotosReais(bruto);
  const faltando = ids.filter((id) => !achadas.some((a) => a.id === id));
  if (faltando.length) throw new ErroDeRegra(404, "imagem_fora_do_cliente", "Há foto que não está no acervo deste cliente.", { imagem_ids: faltando });
  const ruins = ids
    .map((id) => {
      const a = achadas.find((x) => x.id === id)!;
      return { id, motivo: problemaDaFotoDeOrigem(a), gerada: a.gerada === true || a.modo === "clone" || (a.tags ?? []).includes("referencia_web") };
    })
    .filter((x) => x.motivo);
  if (ruins.some((r) => r.gerada)) {
    throw new ErroDeRegra(422, "foto_nao_e_real", "O clone nasce só de fotos REAIS da pessoa: foto gerada por IA ou da internet não vira identidade.", { imagem_ids: ruins.filter((r) => r.gerada).map((r) => r.id) });
  }
  if (ruins.length) {
    throw new ErroDeRegra(422, "foto_de_origem_invalida", `Esta foto não serve de origem: ${ruins[0].motivo}.`, { imagem_ids: ruins.map((r) => r.id) });
  }
  return ids;
}

export type MudancaDasFotos = {
  identidade: EntradaReal[];
  entraram: string[];
  sairam: string[];
  principal_mudou: boolean;
  /** Entrou ou saiu foto (a folha pode ficar desatualizada). */
  mudou_fotos: boolean;
  /** Nada mudou (nem foto, nem principal, nem ordem). */
  igual: boolean;
};

/**
 * A nova identidade real a partir dos ids pedidos (já validados): quem fica
 * mantém a data em que entrou; quem entra ganha a data de agora. A principal
 * é a pedida (se estiver entre as fotos) ou a primeira.
 */
export function novaIdentidadeReal(atual: EntradaReal[], ids: string[], principalPedido: unknown, clientId: string, agora: string): MudancaDasFotos {
  const antes = atual.map((r) => r.imagem_id);
  const principal = UUID.test(String(principalPedido ?? "")) && ids.indexOf(String(principalPedido)) >= 0 ? String(principalPedido) : ids[0];
  const identidade = ids.map((id) => {
    const ja = atual.find((r) => r.imagem_id === id);
    return { imagem_id: id, client_id: clientId, principal: id === principal, adicionada_em: ja ? ja.adicionada_em ?? null : agora };
  });
  const entraram = ids.filter((id) => antes.indexOf(id) < 0);
  const sairam = antes.filter((id) => ids.indexOf(id) < 0);
  const principalAntes = (atual.find((r) => r.principal) ?? atual[0])?.imagem_id ?? null;
  const principal_mudou = principalAntes !== principal;
  const mesmaOrdem = antes.length === ids.length && antes.every((id, i) => ids[i] === id);
  return { identidade, entraram, sairam, principal_mudou, mudou_fotos: entraram.length > 0 || sairam.length > 0, igual: mesmaOrdem && !principal_mudou };
}

export type VistaComFontes = { fontes?: unknown; criado_em?: string | null };

/** Fotos reais que foram ao gerador nesta vista (fontes tipo foto_real). */
export function fotosReaisDaVista(v: VistaComFontes): string[] {
  const lista = Array.isArray(v.fontes) ? v.fontes : [];
  return lista
    .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
    .filter((f) => f.tipo === "foto_real" || f.tipo === "real")
    .map((f) => String(f.id ?? ""))
    .filter(Boolean);
}

/**
 * A vista foi feita com as fotos antigas: usou uma foto real que já não é de
 * origem, ou entrou foto de origem nova depois que ela nasceu. Sem fontes
 * (vista antiga sem registro) não dá para afirmar: não marca.
 */
export function vistaDesatualizada(v: VistaComFontes, identidade: EntradaReal[]): boolean {
  const usadas = fotosReaisDaVista(v);
  if (!usadas.length) return false;
  const atuais = identidade.map((r) => r.imagem_id);
  if (usadas.some((id) => atuais.indexOf(id) < 0)) return true;
  const nasceu = v.criado_em ? Date.parse(v.criado_em) : NaN;
  if (!isFinite(nasceu)) return false;
  return identidade.some((r) => {
    const entrou = r.adicionada_em ? Date.parse(r.adicionada_em) : NaN;
    return isFinite(entrou) && entrou > nasceu;
  });
}

// ------------------------------------------------------------------ apagar (arquivar) vista

/** Marca de vista arquivada em avisos (vale sem a coluna arquivada_em; ver Z-clones-edicao.sql). */
export const MARCA_ARQUIVADA = "arquivada_em:";

export type VistaArquivavel = { arquivada_em?: string | null; avisos?: string[] | null };

export const vistaArquivada = (v: VistaArquivavel): boolean => !!v.arquivada_em || (v.avisos ?? []).some((a) => String(a).indexOf(MARCA_ARQUIVADA) === 0);

export function avisosArquivados(avisos: string[] | null | undefined, agora: string): string[] {
  return (avisos ?? []).filter((a) => String(a).indexOf(MARCA_ARQUIVADA) !== 0).concat([`${MARCA_ARQUIVADA}${agora}`]);
}

export const avisosRestaurados = (avisos: string[] | null | undefined): string[] => (avisos ?? []).filter((a) => String(a).indexOf(MARCA_ARQUIVADA) !== 0);

/** Erro de coluna que ainda não existe (SQL Z não aplicado): a função segue sem ela. */
export const colunaQueFalta = (e: unknown): boolean => {
  const x = (e ?? {}) as { code?: unknown; message?: unknown };
  return /PGRST204|42703|column|coluna/i.test(`${x.code ?? ""} ${x.message ?? ""}`);
};

// ------------------------------------------------------------------ gerar escolhendo as fotos

/**
 * Fotos de origem escolhidas para UMA geração (vista ou variação): ids que
 * são de origem do clone, pelo menos 1. Sem escolha (nulo ou vazio), todas.
 */
export function fotosEscolhidasParaGerar(bruto: unknown, identidade: EntradaReal[]): string[] | null {
  if (bruto == null || (Array.isArray(bruto) && bruto.length === 0)) return null;
  if (!Array.isArray(bruto)) throw new ErroDeRegra(400, "fotos_da_geracao_invalidas", "fotos_reais_ids precisa ser uma lista.");
  const ids = Array.from(new Set(bruto.map((x) => String(x ?? "").trim()).filter(Boolean)));
  const atuais = identidade.map((r) => r.imagem_id);
  const fora = ids.filter((id) => atuais.indexOf(id) < 0);
  if (fora.length) throw new ErroDeRegra(409, "foto_fora_do_clone", "Escolha só entre as fotos de origem deste clone.", { imagem_ids: fora });
  if (!ids.length) throw new ErroDeRegra(400, "fotos_da_geracao_invalidas", "Escolha pelo menos 1 foto de origem.");
  return ids.slice(0, MAX_FOTOS_REAIS);
}

// ------------------------------------------------------------------ gerar de novo uma variação

/** Arquivo ao lado da variação com o pedido que a gerou (para "Gerar de novo"). */
export const caminhoDoPedido = (storagePath: string) => `${storagePath}.pedido.json`;

/**
 * Pedido de uma variação antiga sem o arquivo do pedido: o que a descrição
 * guardou ("Mudou: ...") vira pedido livre; o preset sai do nome
 * ("(variação: Café)"). Sem nada, null (a tela pede para montar de novo).
 */
export function pedidoDaDescricao(descricao: string | null | undefined, nome: string | null | undefined, presets: { id: string; rotulo: string }[]): Record<string, unknown> | null {
  const d = String(descricao ?? "");
  const m = d.match(/Mudou: ([^.]+)\./);
  const rotulo = String(nome ?? "").match(/\(varia[cç][aã]o: ([^)]+)\)/);
  const preset = rotulo ? presets.find((p) => p.rotulo === rotulo[1].trim()) ?? null : null;
  const livre = m ? limpo(m[1], 1500) : "";
  if (!preset && !livre) return null;
  return { preset: preset ? preset.id : null, livre };
}

/** Formato da variação pela medida da foto (a mais perto entre 4:5, 1:1, 9:16 e 16:9); sem medida, 4:5. */
export function formatoPelaMedida(largura: number | null | undefined, altura: number | null | undefined): string {
  if (!largura || !altura || largura <= 0 || altura <= 0) return "4:5";
  const r = largura / altura;
  const opcoes: [string, number][] = [["4:5", 0.8], ["1:1", 1], ["9:16", 9 / 16], ["16:9", 16 / 9]];
  return opcoes.reduce((melhor, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(melhor[1] / r)) ? o : melhor))[0];
}

// ------------------------------------------------------------------ duplicar

export function nomeDaCopia(nome: string, pedido?: unknown): string {
  const dado = limpo(pedido, 80);
  if (dado) return dado;
  const base = String(nome || "Clone").replace(/\s*\(c[oó]pia(?: \d+)?\)\s*$/i, "").trim() || "Clone";
  return `${base} (cópia)`.slice(0, 80);
}

/**
 * A autorização da cópia é a MESMA da pessoa, conferida de novo (quem, data,
 * finalidade, sabe que é IA, adulta, validade). Revogada ou vencida: recusa.
 */
export function autorizacaoDaCopia(a: Partial<AutorizacaoDoClone> | null | undefined, origemId: string, hoje?: string): AutorizacaoDoClone & { herdada_de: string } {
  if (!a || a.confirmada !== true) throw new ErroDeRegra(422, "autorizacao_obrigatoria", "Este clone não tem autorização registrada: registre antes de duplicar.");
  if (a.revogada_em) throw new ErroDeRegra(422, "autorizacao_invalida", "A autorização desta pessoa foi revogada: não dá para duplicar.");
  const lida = lerAutorizacaoDoClone(a, hoje);
  return { ...lida, registrada_por: a.registrada_por ?? null, registrada_em: a.registrada_em ?? null, herdada_de: origemId };
}
