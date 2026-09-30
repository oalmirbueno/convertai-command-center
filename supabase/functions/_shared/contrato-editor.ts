/**
 * Editor de modelos de contrato na tela (frente CON2, 30/09/2026).
 *
 * Versão publicada nunca muda: editar é publicar a versão N+1 (a anterior é
 * desligada no mesmo passo, pela RPC contrato_modelo_publicar). Os contratos
 * já montados guardam a versão que usaram; o congelado não depende do modelo.
 *
 * Aqui ficam as regras puras que a tela e a função conferem antes de publicar:
 * chave e título de cada cláusula, tamanho do texto, {{variáveis}} que existem,
 * condições que apontam para variáveis do modelo, e o resumo do que mudou.
 *
 * Puro: sem Deno, sem npm, sem Supabase. Compatível com Safari 11. Sem travessão.
 */
import { type ClausulaDoModelo, type ModeloDeContrato, type TipoDeVariavel, type VariavelDoModelo, variaveisDoTexto } from "./contrato-modelo.ts";
import { VALORES_DO_SISTEMA_NO_ADITIVO } from "../contratos/modulos/contrato-modelo-extras-v1.ts";

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

export const TIPOS_DE_VARIAVEL: TipoDeVariavel[] = ["texto", "textoLongo", "moeda", "inteiro", "percentual", "data", "escolha"];
const CHAVE = /^[a-z][a-z0-9_]{1,39}$/;

export type RascunhoDoModelo = {
  chave: string;
  nome: string;
  clausulas: ClausulaDoModelo[];
  variaveis: VariavelDoModelo[];
  revisao_juridica: string;
};

/** Lê o que a tela mandou, sem confiar no formato. */
export function lerRascunhoDoModelo(bruto: unknown, base: ModeloDeContrato): RascunhoDoModelo {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const clausulas = (Array.isArray(o.clausulas) ? o.clausulas : []).map((c) => {
    const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const quando = x.quando && typeof x.quando === "object" ? (x.quando as ClausulaDoModelo["quando"]) : undefined;
    return {
      chave: txt(x.chave).toLowerCase(),
      titulo: txt(x.titulo).slice(0, 160),
      texto: String(x.texto == null ? "" : x.texto).replace(/\r\n/g, "\n").trim(),
      ...(quando && quando.variavel ? { quando: { variavel: txt(quando.variavel), ...(quando.igual !== undefined ? { igual: txt(quando.igual) } : {}), ...(quando.diferente !== undefined ? { diferente: txt(quando.diferente) } : {}), ...(typeof quando.preenchida === "boolean" ? { preenchida: quando.preenchida } : {}) } } : {}),
    } as ClausulaDoModelo;
  });
  const variaveis = Array.isArray(o.variaveis) ? (o.variaveis as VariavelDoModelo[]).map((v) => ({ ...v, nome: txt(v && v.nome).toLowerCase(), rotulo: txt(v && v.rotulo).slice(0, 160) })) : base.variaveis;
  return {
    chave: base.chave,
    nome: txt(o.nome).slice(0, 120) || base.nome,
    clausulas,
    variaveis,
    revisao_juridica: txt(o.revisao_juridica).slice(0, 120) || base.revisao_juridica,
  };
}

export type ConferenciaDoModelo = { erros: string[]; avisos: string[] };

/**
 * Confere o rascunho. `geral` são as condições gerais ativas (as variáveis
 * delas valem nos blocos e nas extras). Erro impede publicar; aviso só avisa.
 */
export function conferirRascunhoDoModelo(r: RascunhoDoModelo, base: ModeloDeContrato, geral: ModeloDeContrato | null): ConferenciaDoModelo {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (!r.clausulas.length) erros.push("O modelo precisa de pelo menos uma cláusula.");
  if (r.clausulas.length > 80) erros.push("No máximo 80 cláusulas por modelo.");
  const nomes: Record<string, VariavelDoModelo> = {};
  const vistasVar: Record<string, boolean> = {};
  r.variaveis.forEach((v, i) => {
    if (!CHAVE.test(v.nome)) erros.push(`Variável ${i + 1}: nome só com letras minúsculas, números e _.`);
    if (vistasVar[v.nome]) erros.push(`Variável ${v.nome} repetida.`);
    vistasVar[v.nome] = true;
    if (TIPOS_DE_VARIAVEL.indexOf(v.tipo) < 0) erros.push(`Variável ${v.nome}: tipo desconhecido.`);
    if (v.tipo === "escolha" && !(v.opcoes && v.opcoes.length)) erros.push(`Variável ${v.nome}: escolha sem opções.`);
    if (v.tipo === "escolha" && v.padrao && !(v.opcoes || []).some((o) => o.valor === v.padrao)) erros.push(`Variável ${v.nome}: o padrão não é uma das opções.`);
    if (!v.rotulo) erros.push(`Variável ${v.nome}: falta o rótulo.`);
    nomes[v.nome] = v;
  });
  (geral && geral.chave !== r.chave ? geral.variaveis : []).forEach((v) => {
    if (!nomes[v.nome]) nomes[v.nome] = v;
  });
  const conhecida = (n: string) => !!nomes[n] || n.indexOf("agencia_") === 0 || (base.tipo === "aditivo" && VALORES_DO_SISTEMA_NO_ADITIVO.indexOf(n) >= 0);
  const vistas: Record<string, boolean> = {};
  r.clausulas.forEach((c, i) => {
    const onde = `Cláusula ${i + 1}${c.titulo ? ` (${c.titulo})` : ""}`;
    if (!CHAVE.test(c.chave)) erros.push(`${onde}: a chave precisa ter de 2 a 40 letras minúsculas, números ou _.`);
    if (vistas[c.chave]) erros.push(`${onde}: chave repetida (${c.chave}).`);
    vistas[c.chave] = true;
    if (c.titulo.length < 2) erros.push(`${onde}: falta o título.`);
    if (c.texto.length < 10 || c.texto.length > 6000) erros.push(`${onde}: o texto precisa ter de 10 a 6.000 caracteres.`);
    if (/[—–]/.test(c.texto) || /[—–]/.test(c.titulo)) erros.push(`${onde}: sem travessão no texto do contrato.`);
    variaveisDoTexto(c.texto).forEach((n) => {
      if (!conhecida(n)) erros.push(`${onde}: a variável {{${n}}} não existe neste modelo.`);
    });
    if (c.quando && !conhecida(c.quando.variavel)) erros.push(`${onde}: a condição usa ${c.quando.variavel}, que não existe.`);
    if (/lei\s*5\.?988/i.test(c.texto)) erros.push(`${onde}: a Lei 5.988/73 foi revogada (use a Lei 9.610/1998).`);
    if (/senha/i.test(c.texto) && !/nenhuma senha|sem receber senha|não .*senha|nunca .*senha/i.test(c.texto)) avisos.push(`${onde}: o texto fala de senha. O padrão é acesso por convite, nunca senha.`);
  });
  base.variaveis.forEach((v) => {
    if (!vistasVar[v.nome] && r.variaveis !== base.variaveis) avisos.push(`A variável ${v.nome} saiu do modelo: contratos novos não terão esse campo.`);
  });
  const m = resumoDaMudanca(base, r);
  if (!m.alteradas.length && !m.novas.length && !m.removidas.length && !m.variaveis.length && r.nome === base.nome) erros.push("Nada mudou em relação à versão publicada.");
  if (m.alteradas.length || m.novas.length || m.removidas.length) avisos.push("Texto de contrato mudou: a versão nova fica marcada como revisão jurídica pendente até o advogado conferir.");
  return { erros, avisos };
}

export type ResumoDaMudanca = { alteradas: string[]; novas: string[]; removidas: string[]; variaveis: string[] };

export function resumoDaMudanca(base: ModeloDeContrato, r: RascunhoDoModelo): ResumoDaMudanca {
  const antes: Record<string, ClausulaDoModelo> = {};
  base.clausulas.forEach((c) => (antes[c.chave] = c));
  const depois: Record<string, ClausulaDoModelo> = {};
  r.clausulas.forEach((c) => (depois[c.chave] = c));
  const alteradas = r.clausulas.filter((c) => antes[c.chave] && (antes[c.chave].texto.trim() !== c.texto.trim() || antes[c.chave].titulo !== c.titulo || JSON.stringify(antes[c.chave].quando || null) !== JSON.stringify(c.quando || null))).map((c) => c.chave);
  const novas = r.clausulas.filter((c) => !antes[c.chave]).map((c) => c.chave);
  const removidas = base.clausulas.filter((c) => !depois[c.chave]).map((c) => c.chave);
  const vAntes: Record<string, string> = {};
  base.variaveis.forEach((v) => (vAntes[v.nome] = JSON.stringify(v)));
  const variaveis = r.variaveis.filter((v) => vAntes[v.nome] !== JSON.stringify(v)).map((v) => v.nome).concat(base.variaveis.filter((v) => !r.variaveis.some((x) => x.nome === v.nome)).map((v) => v.nome));
  const ordemMudou = !alteradas.length && !novas.length && !removidas.length && base.clausulas.map((c) => c.chave).join(",") !== r.clausulas.map((c) => c.chave).join(",");
  return { alteradas: ordemMudou ? ["(ordem das cláusulas)"] : alteradas, novas, removidas, variaveis };
}

/** A marca de revisão da versão nova: texto mudou, volta a "revisão jurídica pendente". */
export function revisaoDaVersaoNova(versao: number, textoMudou: boolean, pedida: string): string {
  if (textoMudou) return `v${versao} · revisão jurídica pendente`;
  return txt(pedida) || `v${versao} · revisão jurídica pendente`;
}
