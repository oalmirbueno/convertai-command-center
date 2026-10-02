/**
 * Peças de foto do mês (02/10/2026). O dono pediu: "quando eu abrir a Mesa
 * Foto, apareça a esteira do que está pronto para fazer, já puxando a
 * direção de foto certa". O planejamento do mês (calendario_propostas, feito
 * no agente-calendario) grava em cada item de formato "foto" a direção:
 *
 *   item.foto = { assunto, objetivo, angulos[], cenario, luz, pessoa,
 *                 quantidade, texto_na_foto, referencias[] }
 *
 * mais data, tema ou titulo e, depois de gravar na agenda, task_id. Este
 * módulo lê as propostas do mês atual e do próximo (gravadas primeiro; a
 * pronta que ainda não foi gravada entra marcada "não gravado") e devolve a
 * lista em forma fixa, com padrão sensato para o que faltar.
 *
 * Puro (sem Deno, sem banco, sem React): a função mesa-foto usa na ação
 * pecas_de_foto e a tela usa para conferir de novo o que chegou. Sem
 * travessão.
 */

export type DirecaoDaFoto = {
  assunto: string;
  objetivo: string;
  angulos: string[];
  cenario: string;
  luz: string;
  pessoa: string | null;
  quantidade: number;
  texto_na_foto: string | null;
  referencias: string[];
};

export type PecaDeFoto = {
  /** "<proposta_id>:<indice>" (o mesmo do endereço ?peca=). */
  chave: string;
  proposta_id: string;
  indice: number;
  /** A proposta já foi gravada na agenda (status "gravada"). */
  gravada: boolean;
  task_id: string | null;
  data: string | null;
  titulo: string;
  tema: string;
  foto: DirecaoDaFoto;
};

export const UUID_DA_PECA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ângulos quando o planejamento não disse nenhum. */
export const ANGULOS_PADRAO = ["Frontal", "3/4", "Detalhe"];
export const LUZ_PADRAO = "Natural";
export const MAX_FOTOS_DA_PECA = 12;
export const MAX_PECAS = 60;

const texto = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" && isFinite(v) ? String(v) : "");
const textoOuNulo = (v: unknown, max = 400): string | null => texto(v, max) || null;

function listaDeTextos(v: unknown, max: number, tamanho = 200): string[] {
  const bruta = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : [];
  const saida: string[] = [];
  for (const x of bruta) {
    const t = texto(x, tamanho);
    if (t && saida.indexOf(t) < 0) saida.push(t);
    if (saida.length >= max) break;
  }
  return saida;
}

/** O item é de foto? (formato "foto", sem diferença de caixa nem espaço) */
export function ehItemDeFoto(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  return texto((item as Record<string, unknown>).formato, 40).toLowerCase() === "foto";
}

/** Dia "AAAA-MM-DD" de um texto de data (ou null). */
export function diaDe(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v, 40));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** A direção de foto do item, com padrão para o que faltar. */
export function normalizarDirecaoDaFoto(bruto: unknown, item: Record<string, unknown> = {}): DirecaoDaFoto {
  const f = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const angulosDitos = listaDeTextos(f.angulos, MAX_FOTOS_DA_PECA, 120);
  const q = Math.floor(Number(f.quantidade));
  const quantidade = isFinite(q) && q > 0 ? Math.min(MAX_FOTOS_DA_PECA, q) : angulosDitos.length || ANGULOS_PADRAO.length;
  const angulos = angulosDitos.length ? angulosDitos : ANGULOS_PADRAO.slice(0, Math.max(1, Math.min(ANGULOS_PADRAO.length, quantidade)));
  return {
    assunto: texto(f.assunto, 400) || texto(item.titulo, 400) || texto(item.tema, 400) || "Foto do mês",
    objetivo: texto(f.objetivo, 400) || texto(item.objetivo, 400),
    angulos,
    cenario: texto(f.cenario, 400),
    luz: texto(f.luz, 200) || LUZ_PADRAO,
    pessoa: textoOuNulo(f.pessoa, 200),
    quantidade,
    texto_na_foto: textoOuNulo(f.texto_na_foto, 200),
    referencias: listaDeTextos(f.referencias, 8, 500),
  };
}

/**
 * Janela das peças: do 1º dia do mês de hoje ao último dia do mês seguinte,
 * no horário de Brasília (UTC-3, sem horário de verão desde 2019).
 */
export function janelaDasPecas(hoje: Date): { inicio: string; fim: string } {
  const local = new Date(hoje.getTime() - 3 * 3600_000);
  const ano = local.getUTCFullYear();
  const mes = local.getUTCMonth();
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  const inicio = `${ano}-${dois(mes + 1)}-01`;
  const ultimo = new Date(Date.UTC(ano, mes + 2, 0));
  const fim = `${ultimo.getUTCFullYear()}-${dois(ultimo.getUTCMonth() + 1)}-${dois(ultimo.getUTCDate())}`;
  return { inicio, fim };
}

/** Uma peça que veio da função (a tela confere de novo). Forma errada: null. */
export function normalizarPecaDeFoto(v: unknown): PecaDeFoto | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const proposta = texto(p.proposta_id, 80);
  const indice = Math.floor(Number(p.indice));
  if (!UUID_DA_PECA.test(proposta) || !isFinite(indice) || indice < 0) return null;
  const task = texto(p.task_id, 80);
  return {
    chave: `${proposta}:${indice}`,
    proposta_id: proposta,
    indice,
    gravada: p.gravada === true,
    task_id: UUID_DA_PECA.test(task) ? task : null,
    data: diaDe(p.data),
    titulo: texto(p.titulo, 200) || "Peça de foto",
    tema: texto(p.tema, 400),
    foto: normalizarDirecaoDaFoto(p.foto, { titulo: p.titulo, tema: p.tema }),
  };
}

type PropostaBruta = { id?: unknown; status?: unknown; itens?: unknown };

/**
 * As peças de foto das propostas: só itens com formato "foto" e data dentro
 * da janela (sem data, entra). Gravadas primeiro, depois pela data. A mesma
 * peça (data e título) numa pronta e numa gravada fica só a gravada.
 */
export function pecasDeFotoDasPropostas(propostas: PropostaBruta[], hoje: Date): PecaDeFoto[] {
  const janela = janelaDasPecas(hoje);
  const todas: PecaDeFoto[] = [];
  for (const prop of Array.isArray(propostas) ? propostas : []) {
    if (!prop || typeof prop !== "object") continue;
    const id = texto(prop.id, 80);
    if (!UUID_DA_PECA.test(id)) continue;
    const status = texto(prop.status, 40);
    if (status !== "gravada" && status !== "pronta") continue;
    const itens = Array.isArray(prop.itens) ? prop.itens : [];
    itens.forEach((bruto, indice) => {
      if (!ehItemDeFoto(bruto)) return;
      const item = bruto as Record<string, unknown>;
      const data = diaDe(item.data);
      if (data && (data < janela.inicio || data > janela.fim)) return;
      const task = texto(item.task_id, 80);
      const titulo = texto(item.titulo, 200) || texto(item.tema, 200) || "Peça de foto";
      todas.push({
        chave: `${id}:${indice}`,
        proposta_id: id,
        indice,
        gravada: status === "gravada",
        task_id: UUID_DA_PECA.test(task) ? task : null,
        data,
        titulo,
        tema: texto(item.tema, 400),
        foto: normalizarDirecaoDaFoto(item.foto, item),
      });
    });
  }
  todas.sort((a, b) => {
    if (a.gravada !== b.gravada) return a.gravada ? -1 : 1;
    if (a.data !== b.data) return !a.data ? 1 : !b.data ? -1 : a.data < b.data ? -1 : 1;
    return a.indice - b.indice;
  });
  const vistas: string[] = [];
  const saida: PecaDeFoto[] = [];
  for (const p of todas) {
    const k = `${p.data || ""}|${p.titulo.toLowerCase()}`;
    if (vistas.indexOf(k) >= 0) continue;
    vistas.push(k);
    saida.push(p);
    if (saida.length >= MAX_PECAS) break;
  }
  return saida;
}

/** "<proposta_id>:<indice>" do endereço (?peca=) ou null. */
export function lerChaveDaPeca(v: unknown): { proposta_id: string; indice: number } | null {
  const m = /^([0-9a-f-]{36}):(\d{1,4})$/i.exec(texto(v, 80));
  if (!m || !UUID_DA_PECA.test(m[1])) return null;
  return { proposta_id: m[1].toLowerCase(), indice: Number(m[2]) };
}
