/**
 * Pontuação do lead (14/11/2026, rodada 3): regras fixas que cada empresa ajusta na tela.
 * Arquivo puro (sem Deno, sem rede), usado pelo servidor, pela tela e pelos testes.
 *
 * O lead responde o formulário da Meta (bem, valor da carta, parcela, prazo, lance) e, depois, o robô do
 * WhatsApp completa com o que a Meta não deixa perguntar no formulário (renda e capacidade de pagamento).
 * A nota vai de 0 a 100 e vira uma faixa: quente, morno ou frio. Frio vai para a nutrição.
 *
 * As regras são gerais: "consórcio" é só o padrão de um ramo. Outro ramo troca os critérios na tela.
 */

export type Faixa = "quente" | "morno" | "frio";

/** Um critério: de qual resposta sai, e quantos pontos vale cada caso. */
export interface CriterioDeOpcao {
  tipo: "opcao";
  /** A chave da resposta já normalizada (ex.: "bem", "prazo", "lance"). */
  campo: string;
  rotulo: string;
  /** valor normalizado -> pontos. */
  pontos: Record<string, number>;
  /** Valores que mandam direto para a nutrição, qualquer que seja a nota (ex.: prazo "menos_de_3_meses"). */
  nutricao?: string[];
}

export interface CriterioDeFaixa {
  tipo: "faixa";
  /** A chave de uma resposta numérica (ex.: "valor_carta", "parcela", "renda"). */
  campo: string;
  rotulo: string;
  /** Do menor para o maior: até `ate` (inclusive) vale `pontos`. O último sem `ate` cobre o resto. */
  faixas: Array<{ ate?: number; pontos: number }>;
}

export type Criterio = CriterioDeOpcao | CriterioDeFaixa;

export interface RegrasDePontuacao {
  criterios: Criterio[];
  /** Nota mínima de cada faixa. Abaixo de `morno` é frio. */
  cortes: { quente: number; morno: number };
}

export interface ResultadoDaPontuacao {
  nota: number;
  faixa: Faixa;
  /** Frases curtas que explicam a nota, para o vendedor ler ("Imóvel: 30", "Tem lance: 20"). */
  motivos: string[];
  /** Algum critério mandou para a nutrição. */
  forcouNutricao: boolean;
}

/** O padrão do ramo consórcio. A soma máxima é 100. */
export const REGRAS_DO_CONSORCIO: RegrasDePontuacao = {
  criterios: [
    { tipo: "opcao", campo: "bem", rotulo: "Bem", pontos: { imovel: 25, carro: 20, moto: 12, pesados: 20, servicos: 10, outros: 10 } },
    { tipo: "faixa", campo: "valor_carta", rotulo: "Valor da carta", faixas: [{ ate: 40000, pontos: 5 }, { ate: 150000, pontos: 12 }, { pontos: 20 }] },
    { tipo: "faixa", campo: "parcela", rotulo: "Parcela que cabe no bolso", faixas: [{ ate: 300, pontos: 0 }, { ate: 800, pontos: 10 }, { ate: 2000, pontos: 16 }, { pontos: 20 }] },
    { tipo: "opcao", campo: "prazo", rotulo: "Prazo para usar", pontos: { menos_de_3_meses: 0, de_3_a_12_meses: 15, mais_de_12_meses: 20 }, nutricao: ["menos_de_3_meses"] },
    { tipo: "opcao", campo: "lance", rotulo: "Lance ou entrada", pontos: { sim: 15, nao: 5 } },
  ],
  cortes: { quente: 65, morno: 40 },
};

/** O padrão de quem não é de consórcio: valor e urgência. */
export const REGRAS_GERAIS: RegrasDePontuacao = {
  criterios: [
    { tipo: "faixa", campo: "valor", rotulo: "Valor do negócio", faixas: [{ ate: 500, pontos: 10 }, { ate: 5000, pontos: 25 }, { pontos: 40 }] },
    { tipo: "opcao", campo: "prazo", rotulo: "Quando quer fechar", pontos: { agora: 40, este_mes: 30, sem_pressa: 10 } },
    { tipo: "opcao", campo: "decisor", rotulo: "É quem decide", pontos: { sim: 20, nao: 5 } },
  ],
  cortes: { quente: 65, morno: 40 },
};

export const regrasDoRamo = (nicho: string | null | undefined): RegrasDePontuacao => (nicho === "consorcio" ? REGRAS_DO_CONSORCIO : REGRAS_GERAIS);

const numeroLimpo = (v: unknown, min: number, max: number, padrao: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : padrao;
};
const chaveLimpa = (v: unknown): string => String(v === null || v === undefined ? "" : v).trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);

/** Lê as regras como vieram do banco, sem confiar no formato. Vazio ou inválido cai no padrão do ramo. */
export function lerRegras(bruto: unknown, nicho?: string | null): RegrasDePontuacao {
  const padrao = regrasDoRamo(nicho);
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lista = Array.isArray(o.criterios) ? (o.criterios as unknown[]) : [];
  const criterios: Criterio[] = [];
  lista.slice(0, 12).forEach((item) => {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const campo = chaveLimpa(c.campo);
    const rotulo = String(c.rotulo || campo).trim().slice(0, 40);
    if (!campo) return;
    if (c.tipo === "faixa" && Array.isArray(c.faixas)) {
      const faixas = (c.faixas as unknown[]).slice(0, 8).map((f) => {
        const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        const ate = x.ate === undefined || x.ate === null || x.ate === "" ? undefined : numeroLimpo(x.ate, 0, 999999999, 0);
        return { ...(ate === undefined ? {} : { ate }), pontos: numeroLimpo(x.pontos, 0, 100, 0) };
      });
      if (faixas.length) criterios.push({ tipo: "faixa", campo, rotulo, faixas: faixas.sort((a, b) => (a.ate === undefined ? 1 : b.ate === undefined ? -1 : a.ate - b.ate)) });
    } else if (c.tipo === "opcao" && c.pontos && typeof c.pontos === "object") {
      const pontos: Record<string, number> = {};
      Object.keys(c.pontos as Record<string, unknown>).slice(0, 16).forEach((k) => {
        const chave = chaveLimpa(k);
        if (chave) pontos[chave] = numeroLimpo((c.pontos as Record<string, unknown>)[k], 0, 100, 0);
      });
      const nutricao = Array.isArray(c.nutricao) ? (c.nutricao as unknown[]).map(chaveLimpa).filter((k) => k && k in pontos) : [];
      if (Object.keys(pontos).length) criterios.push({ tipo: "opcao", campo, rotulo, pontos, ...(nutricao.length ? { nutricao } : {}) });
    }
  });
  if (!criterios.length) return padrao;
  const cortes = (o.cortes && typeof o.cortes === "object" ? o.cortes : {}) as Record<string, unknown>;
  const quente = numeroLimpo(cortes.quente, 1, 100, padrao.cortes.quente);
  const morno = Math.min(numeroLimpo(cortes.morno, 0, 100, padrao.cortes.morno), quente - 1);
  return { criterios, cortes: { quente, morno: Math.max(0, morno) } };
}

/** A nota máxima que as regras permitem (para a tela mostrar "de quanto"). */
export function notaMaxima(regras: RegrasDePontuacao): number {
  return regras.criterios.reduce((soma, c) => soma + (c.tipo === "faixa" ? Math.max(0, ...c.faixas.map((f) => f.pontos)) : Math.max(0, ...Object.keys(c.pontos).map((k) => c.pontos[k]))), 0);
}

/**
 * Pontua as respostas já normalizadas. Resposta que falta não soma e não tira: o robô pergunta depois.
 * A nota é proporcional ao máximo das regras (sempre de 0 a 100), para a empresa poder mexer nos pontos
 * sem refazer os cortes.
 */
export function pontuar(respostas: Record<string, unknown>, regras: RegrasDePontuacao): ResultadoDaPontuacao {
  let soma = 0;
  let forcouNutricao = false;
  const motivos: string[] = [];
  regras.criterios.forEach((c) => {
    const v = respostas ? respostas[c.campo] : undefined;
    if (v === undefined || v === null || v === "") return;
    if (c.tipo === "faixa") {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
      if (!isFinite(n)) return;
      const f = c.faixas.filter((x) => x.ate === undefined || n <= x.ate)[0] || c.faixas[c.faixas.length - 1];
      soma += f.pontos;
      motivos.push(`${c.rotulo}: ${f.pontos}`);
    } else {
      const chave = chaveLimpa(v === true ? "sim" : v === false ? "nao" : v);
      if (!(chave in c.pontos)) return;
      soma += c.pontos[chave];
      if (c.nutricao && c.nutricao.indexOf(chave) >= 0) {
        forcouNutricao = true;
        motivos.push(`${c.rotulo}: vai para a nutrição`);
      } else motivos.push(`${c.rotulo}: ${c.pontos[chave]}`);
    }
  });
  const maximo = notaMaxima(regras);
  // Nenhuma resposta pontuável (formulário comum, de outro ramo): não dá para chamar de frio quem não foi
  // perguntado. Entra como morno, com a nota no corte, e o robô do WhatsApp faz as perguntas.
  if (!motivos.length) return { nota: regras.cortes.morno, faixa: "morno", motivos: ["Sem respostas para pontuar ainda"], forcouNutricao: false };
  const nota = maximo > 0 ? Math.max(0, Math.min(100, Math.round((soma / maximo) * 100))) : 0;
  const faixa: Faixa = forcouNutricao ? "frio" : nota >= regras.cortes.quente ? "quente" : nota >= regras.cortes.morno ? "morno" : "frio";
  return { nota, faixa, motivos, forcouNutricao };
}

/** O que ainda falta responder (o robô do WhatsApp pergunta nesta ordem). */
export function faltamResponder(respostas: Record<string, unknown>, regras: RegrasDePontuacao): string[] {
  return regras.criterios.filter((c) => respostas[c.campo] === undefined || respostas[c.campo] === null || respostas[c.campo] === "").map((c) => c.campo);
}
