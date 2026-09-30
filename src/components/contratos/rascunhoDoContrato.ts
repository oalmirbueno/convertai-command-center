import type { PayloadDoContrato } from "@/lib/contratos/api";

/**
 * O que a pessoa mudou no rascunho do contrato e ainda não salvou (UXS, 30/09).
 *
 * Antes, o que era digitado em Dados e em Assinantes morava só no componente
 * da parte: trocar de parte, de contrato ou sair da página perdia tudo sem
 * aviso, e o "Congelar e assinar" do cabeçalho congelava a versão salva
 * (ignorando, por exemplo, um preço mudado e não salvo).
 *
 * Agora o DetalheDoContrato guarda aqui, pelo useEstadoDaTela
 * (`contratos:rascunho:<id>`), só o que a pessoa TOCOU: os campos de Dados,
 * os serviços e a lista de quem assina. A tela mostra o servidor com o que
 * foi tocado por cima; o que o agente muda ao lado entra sozinho nos campos
 * não tocados. Campo tocado que o agente também mudou fica com o valor da
 * pessoa, e a barra avisa. Salvar com sucesso limpa o que foi salvo.
 */

export type LinhaDeAssinante = { papel: "contratante" | "testemunha"; nome: string; email: string; documento: string; obrigatorio: boolean };

export type RascunhoDoContrato = {
  /** Campos de Dados tocados: o valor que a pessoa digitou. */
  valores: Record<string, string>;
  /** O valor do servidor quando a pessoa tocou o campo (para saber se o agente mudou depois). */
  origem: Record<string, string>;
  /** Serviços marcados (null: não tocou). */
  servicos: string[] | null;
  servicosOrigem: string[] | null;
  /** Quem assina (null: não tocou). */
  assinantes: LinhaDeAssinante[] | null;
};

export const RASCUNHO_VAZIO: RascunhoDoContrato = { valores: {}, origem: {}, servicos: null, servicosOrigem: null, assinantes: null };

const ehTextos = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).every((k) => typeof (v as Record<string, unknown>)[k] === "string");
const ehListaDeTexto = (v: unknown) => v === null || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const ehLinha = (x: unknown) => {
  const l = x as Record<string, unknown> | null;
  return !!l && (l.papel === "contratante" || l.papel === "testemunha") && typeof l.nome === "string" && typeof l.email === "string" && typeof l.documento === "string" && typeof l.obrigatorio === "boolean";
};

/** O guardado no navegador tem a forma certa? (Valor velho ou de outra versão cai no vazio.) */
export function rascunhoValido(v: unknown): boolean {
  if (v === null) return true;
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return false;
  return ehTextos(r.valores) && ehTextos(r.origem) && ehListaDeTexto(r.servicos) && ehListaDeTexto(r.servicosOrigem) && (r.assinantes === null || (Array.isArray(r.assinantes) && r.assinantes.every(ehLinha)));
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const chaveDosServicos = (l: string[] | null | undefined) => (l || []).slice().sort().join(",");

export function linhasDoServidor(p: PayloadDoContrato): LinhaDeAssinante[] {
  return (p.signatarios || []).map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, documento: s.documento || "", obrigatorio: s.obrigatorio }));
}

/** Os valores que a tela mostra: o do servidor com o que a pessoa tocou por cima. */
export function valoresNaTela(p: PayloadDoContrato, r: RascunhoDoContrato | null): Record<string, string> {
  const saida: Record<string, string> = {};
  Object.keys(p.valores || {}).forEach((k) => (saida[k] = texto(p.valores[k])));
  if (r) Object.keys(r.valores).forEach((k) => (saida[k] = r.valores[k]));
  return saida;
}

export function servicosNaTela(p: PayloadDoContrato, r: RascunhoDoContrato | null): string[] {
  return r && r.servicos ? r.servicos : p.contrato.servicos || [];
}

export function assinantesNaTela(p: PayloadDoContrato, r: RascunhoDoContrato | null): LinhaDeAssinante[] {
  return r && r.assinantes ? r.assinantes : linhasDoServidor(p);
}

export type Pendencias = { valores: string[]; servicos: boolean; assinantes: boolean; total: number };

/** O que ainda não foi salvo (campo tocado igual ao do servidor não conta). */
export function pendencias(p: PayloadDoContrato, r: RascunhoDoContrato | null): Pendencias {
  if (!r) return { valores: [], servicos: false, assinantes: false, total: 0 };
  const nomes: Record<string, true> = {};
  (p.variaveis || []).forEach((v) => (nomes[v.nome] = true));
  const valores = Object.keys(r.valores).filter((k) => nomes[k] && r.valores[k] !== texto(p.valores[k]));
  const servicos = !!r.servicos && chaveDosServicos(r.servicos) !== chaveDosServicos(p.contrato.servicos);
  const assinantes = !!r.assinantes && JSON.stringify(r.assinantes) !== JSON.stringify(linhasDoServidor(p));
  return { valores, servicos, assinantes, total: valores.length + (servicos ? 1 : 0) + (assinantes ? 1 : 0) };
}

/** Campos que a pessoa tocou e que o servidor (o agente ao lado) mudou depois: fica o valor dela. */
export function conflitos(p: PayloadDoContrato, r: RascunhoDoContrato | null): string[] {
  if (!r) return [];
  const saida = Object.keys(r.valores).filter((k) => r.origem[k] !== undefined && texto(p.valores[k]) !== r.origem[k] && r.valores[k] !== texto(p.valores[k]));
  if (r.servicos && r.servicosOrigem && chaveDosServicos(p.contrato.servicos) !== chaveDosServicos(r.servicosOrigem) && chaveDosServicos(r.servicos) !== chaveDosServicos(p.contrato.servicos)) saida.push("servicos");
  return saida;
}

export function vazio(r: RascunhoDoContrato | null): boolean {
  return !r || (!Object.keys(r.valores).length && !r.servicos && !r.assinantes);
}

const ouNulo = (r: RascunhoDoContrato) => (vazio(r) ? null : r);

/** A pessoa mudou um campo de Dados. Voltar ao valor do servidor solta o campo. */
export function comValor(p: PayloadDoContrato, r: RascunhoDoContrato | null, chave: string, valor: string): RascunhoDoContrato | null {
  const base = r || RASCUNHO_VAZIO;
  const servidor = texto(p.valores[chave]);
  const valores = { ...base.valores };
  const origem = { ...base.origem };
  if (valor === servidor) {
    delete valores[chave];
    delete origem[chave];
  } else {
    valores[chave] = valor;
    if (origem[chave] === undefined) origem[chave] = servidor;
  }
  return ouNulo({ ...base, valores, origem });
}

export function comServicos(p: PayloadDoContrato, r: RascunhoDoContrato | null, lista: string[]): RascunhoDoContrato | null {
  const base = r || RASCUNHO_VAZIO;
  const iguais = chaveDosServicos(lista) === chaveDosServicos(p.contrato.servicos);
  return ouNulo({ ...base, servicos: iguais ? null : lista, servicosOrigem: iguais ? null : base.servicosOrigem || (p.contrato.servicos || []).slice() });
}

export function comAssinantes(p: PayloadDoContrato, r: RascunhoDoContrato | null, linhas: LinhaDeAssinante[]): RascunhoDoContrato | null {
  const base = r || RASCUNHO_VAZIO;
  const iguais = JSON.stringify(linhas) === JSON.stringify(linhasDoServidor(p));
  return ouNulo({ ...base, assinantes: iguais ? null : linhas });
}

/** Solta campos de Dados (foram gravados por outro caminho: IA, ficha). Só os que ainda têm o valor salvo, se `salvos` vier. */
export function semValores(r: RascunhoDoContrato | null, chaves: string[], salvos?: Record<string, string>): RascunhoDoContrato | null {
  if (!r) return null;
  const valores = { ...r.valores };
  const origem = { ...r.origem };
  chaves.forEach((k) => {
    if (salvos && valores[k] !== salvos[k]) return; // mudou de novo enquanto salvava: continua pendente
    delete valores[k];
    delete origem[k];
  });
  return ouNulo({ ...r, valores, origem });
}

export function semServicos(r: RascunhoDoContrato | null, salvos?: string[]): RascunhoDoContrato | null {
  if (!r) return null;
  if (salvos && chaveDosServicos(r.servicos) !== chaveDosServicos(salvos)) return r;
  return ouNulo({ ...r, servicos: null, servicosOrigem: null });
}

export function semAssinantes(r: RascunhoDoContrato | null, salvos?: LinhaDeAssinante[]): RascunhoDoContrato | null {
  if (!r) return null;
  if (salvos && JSON.stringify(r.assinantes) !== JSON.stringify(salvos)) return r;
  return ouNulo({ ...r, assinantes: null });
}

/** "3 alterações", "1 alteração". */
export function textoDasPendencias(n: number): string {
  return n === 1 ? "1 alteração" : `${n} alterações`;
}
