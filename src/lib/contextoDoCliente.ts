/**
 * Como a Central lê o contexto que foi escrito sobre um cliente.
 *
 * O dossiê é gravado em `project_memory` pela rotina do GPT com milhares de
 * caracteres de substância, e a Central mostrava o TÍTULO dele — que é um
 * rótulo com data, "Dossiê de contexto - 18/08/2026", praticamente igual em
 * toda versão. O efeito para quem usa: atualizava o dossiê, puxava na tela e
 * parecia que nada tinha mudado. O dado estava certo no banco o tempo todo;
 * quem estava errado era a leitura.
 */

export interface EntradaDeContexto {
  kind?: string | null;
  title?: string | null;
  content?: string | null;
  source?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Os tipos de registro que contam história do cliente. */
export const CONTEXTO_KINDS = new Set([
  "decisao", "nota", "marco", "note", "summary", "decision", "fact", "second_brain", "external",
]);

/** Um título que é só rótulo com data, sem informação dentro. */
function ehRotulo(titulo: string): boolean {
  return /^(dossi[êe]|contexto|resumo|atualiza[çc][ãa]o)\b/i.test(titulo.trim());
}

/**
 * Primeira linha só com um cabeçalho de seção ("ONDE ESTAMOS") não informa
 * nada sozinha: entra junto do parágrafo que vem depois.
 */
function ehCabecalho(linha: string): boolean {
  const limpa = linha.trim();
  return limpa.length > 0 && limpa.length <= 40 && limpa === limpa.toUpperCase();
}

/**
 * O trecho que representa a entrada na tela.
 *
 * Prefere o CORPO quando ele tem mais substância que o título. Para uma nota
 * curta o título é a informação; para um dossiê o título é etiqueta e o corpo
 * é tudo. A regra decide por tamanho em vez de por tipo, então serve para os
 * dois sem lista de exceção para manter.
 */
export function trechoDoContexto(entrada: EntradaDeContexto, limite = 160): string {
  const titulo = String(entrada.title || "").trim();
  const corpo = String(entrada.content || "").trim();

  const usarCorpo = corpo.length > titulo.length || (titulo.length > 0 && ehRotulo(titulo));
  const bruto = usarCorpo && corpo.length > 0 ? corpo : titulo;
  if (!bruto) return "";

  const linhas = bruto.split("\n").map((l) => l.trim()).filter(Boolean);
  // O cabeçalho sozinho não vira o trecho inteiro; ele acompanha o texto.
  const comeco = linhas.length > 1 && ehCabecalho(linhas[0]) ? linhas.slice(1) : linhas;
  const texto = comeco.join(" ").replace(/\s+/g, " ").trim();
  return texto.length > limite ? `${texto.slice(0, limite).trimEnd()}…` : texto;
}

/**
 * O dossiê mais recente do cliente.
 *
 * Sem janela de dias: um dossiê de três semanas atrás continua sendo o que se
 * sabe sobre o cliente. Esconder por idade deixaria a tela vazia justamente
 * quando o contexto é mais necessário — a tela diz a idade e quem lê decide.
 */
export function dossieMaisRecente<T extends EntradaDeContexto>(entradas: T[]): T | null {
  const candidatos = (entradas || []).filter(
    (e) => CONTEXTO_KINDS.has(String(e.kind || "")) && String(e.content || "").trim().length > 0,
  );
  if (candidatos.length === 0) return null;
  return candidatos.reduce((melhor, atual) =>
    new Date(atual.created_at || 0).getTime() > new Date(melhor.created_at || 0).getTime()
      ? atual
      : melhor,
  );
}

/** "hoje", "ontem", "há 3 dias" — a idade dita como quem fala. */
export function idadeEmPalavras(iso?: string | null, agora: Date = new Date()): string {
  if (!iso) return "";
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return "";
  const dias = Math.floor((agora.getTime() - quando.getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}
