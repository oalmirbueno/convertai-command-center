/**
 * Briefing da Mesa Identidade (frente IDV, 30/09/2026): a etapa Briefing lê
 * o briefing que o cliente respondeu (tabela briefings; a frente BRF guarda
 * em responses.respostas, os briefings antigos guardam as chaves direto em
 * responses) e completa com o contexto que o painel já tem (kit e contexto da
 * marca). O que falta vira pergunta na tela, nunca invenção.
 *
 * Puro: sem Deno, sem banco. Tela, função e testes usam o mesmo arquivo.
 */

export type CampoDoBriefing =
  | "negocio"
  | "segmento"
  | "publico"
  | "regiao"
  | "personalidade"
  | "concorrentes"
  | "gosta"
  | "evita"
  | "proposito"
  | "missao"
  | "visao"
  | "valores"
  | "slogan"
  | "cores_desejadas"
  | "palavras_do_nome";

export const CAMPOS_DO_BRIEFING: Array<{ campo: CampoDoBriefing; rotulo: string; pergunta: string; lista: boolean; essencial: boolean }> = [
  { campo: "negocio", rotulo: "O que o negócio faz", pergunta: "O que o negócio faz, em uma frase?", lista: false, essencial: true },
  { campo: "segmento", rotulo: "Segmento", pergunta: "Em que segmento a marca vai competir?", lista: false, essencial: false },
  { campo: "publico", rotulo: "Para quem", pergunta: "Quem é o público prioritário e o que ele busca?", lista: false, essencial: true },
  { campo: "regiao", rotulo: "Onde atua", pergunta: "Onde a marca atua (cidade, região, online)?", lista: false, essencial: false },
  { campo: "personalidade", rotulo: "Personalidade", pergunta: "Quais 3 a 5 palavras descrevem a personalidade da marca?", lista: true, essencial: true },
  { campo: "concorrentes", rotulo: "Concorrentes", pergunta: "Quem são os concorrentes diretos?", lista: true, essencial: false },
  { campo: "gosta", rotulo: "Referências que gosta", pergunta: "Que marcas ou referências o cliente admira, e por quê?", lista: true, essencial: false },
  { campo: "evita", rotulo: "O que evitar", pergunta: "O que a marca não pode parecer ou usar (cores, estilos, palavras)?", lista: true, essencial: false },
  { campo: "proposito", rotulo: "Propósito", pergunta: "Por que a marca existe, além de vender?", lista: false, essencial: false },
  { campo: "missao", rotulo: "Missão", pergunta: "Qual é a missão?", lista: false, essencial: false },
  { campo: "visao", rotulo: "Visão", pergunta: "Onde a marca quer chegar?", lista: false, essencial: false },
  { campo: "valores", rotulo: "Valores", pergunta: "Quais são os valores?", lista: true, essencial: false },
  { campo: "slogan", rotulo: "Slogan", pergunta: "Existe slogan ou assinatura?", lista: false, essencial: false },
  { campo: "cores_desejadas", rotulo: "Cores desejadas", pergunta: "Há cores desejadas ou proibidas?", lista: false, essencial: false },
  { campo: "palavras_do_nome", rotulo: "Palavras para o nome", pergunta: "Há palavras, raízes ou idiomas desejados para o nome?", lista: true, essencial: false },
];

/** Chaves que cada campo aceita no briefing respondido (as do modelo antigo e as da frente BRF). */
const SINONIMOS: Record<CampoDoBriefing, string[]> = {
  negocio: ["negocio", "descricao", "historia", "historia_e_descricao", "companyDescription", "produtos_e_servicos"],
  segmento: ["segmento", "segment"],
  publico: ["publico", "perfil_do_cliente", "perfil_cliente", "idealClient", "cliente_ideal"],
  regiao: ["regiao", "region"],
  personalidade: ["personalidade", "atributos", "atributos_da_marca", "eixos", "eixos_de_personalidade"],
  concorrentes: ["concorrentes", "competitors"],
  gosta: ["referencias", "marcas_que_admira", "imagem_em_mente", "gosta"],
  evita: ["evita", "o_que_nao_quer", "nao_quer_ver", "nao_quer_no_nome", "cores_proibidas"],
  proposito: ["proposito"],
  missao: ["missao", "missao_e_valores"],
  visao: ["visao", "visao_de_futuro"],
  valores: ["valores"],
  slogan: ["slogan"],
  cores_desejadas: ["cores_desejadas", "cores"],
  palavras_do_nome: ["palavras_desejadas", "raizes", "palavras_do_nome", "idioma"],
};

/** Contexto do painel que completa cada campo. */
const DO_CONTEXTO: Partial<Record<CampoDoBriefing, string[]>> = {
  negocio: ["negocio"],
  segmento: ["nicho"],
  publico: ["publico"],
  personalidade: ["tom_de_voz"],
  proposito: ["posicionamento"],
};

export type ValorDoBriefing = { valor: string | string[]; fonte: "briefing" | "contexto" | "equipe" };

export type BriefingDaIdentidade = {
  campos: Partial<Record<CampoDoBriefing, ValorDoBriefing>>;
  /** Perguntas do que falta (as essenciais primeiro). */
  lacunas: string[];
  /** Id e data do briefing respondido que foi lido, quando há. */
  origem: { briefing_id: string | null; respondido: boolean };
};

const umaLinha = (v: unknown, max = 800) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Valor do briefing em texto ou lista (escala "Sério 4" vira "Sério: 4 de 5"). */
function lerValor(v: unknown, lista: boolean): string | string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const itens = v.map((x) => (x && typeof x === "object" ? umaLinha((x as Record<string, unknown>).nome || (x as Record<string, unknown>).link || (x as Record<string, unknown>).texto, 200) : umaLinha(x, 200))).filter(Boolean);
    if (!itens.length) return null;
    return lista ? itens.slice(0, 10) : itens.join("; ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const partes = Object.keys(o)
      .map((k) => (typeof o[k] === "number" ? `${k}: ${o[k]} de 5` : umaLinha(o[k], 200) ? `${k}: ${umaLinha(o[k], 200)}` : ""))
      .filter(Boolean);
    if (!partes.length) return null;
    return lista ? partes.slice(0, 10) : partes.join("; ");
  }
  const s = umaLinha(v);
  if (!s) return null;
  return lista ? s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : s;
}

/** As respostas de uma linha de briefings, no formato novo ou no antigo. */
export function respostasDoBriefing(responses: unknown): Record<string, unknown> {
  if (!responses || typeof responses !== "object" || Array.isArray(responses)) return {};
  const r = responses as Record<string, unknown>;
  if (r.respostas && typeof r.respostas === "object" && !Array.isArray(r.respostas)) return r.respostas as Record<string, unknown>;
  return r;
}

export function montarBriefingDaIdentidade(e: {
  respostas?: Record<string, unknown> | null;
  briefingId?: string | null;
  contexto?: Record<string, unknown> | null;
  /** O que a equipe já salvou no projeto (vale acima de tudo). */
  salvo?: Record<string, unknown> | null;
}): BriefingDaIdentidade {
  const respostas = e.respostas || {};
  const contexto = e.contexto || {};
  const salvo = e.salvo || {};
  const campos: Partial<Record<CampoDoBriefing, ValorDoBriefing>> = {};
  for (const c of CAMPOS_DO_BRIEFING) {
    const daEquipe = lerValor(salvo[c.campo], c.lista);
    if (daEquipe && (Array.isArray(daEquipe) ? daEquipe.length : daEquipe)) {
      campos[c.campo] = { valor: daEquipe, fonte: "equipe" };
      continue;
    }
    let achado: string | string[] | null = null;
    for (const k of SINONIMOS[c.campo]) {
      achado = lerValor(respostas[k], c.lista);
      if (achado && (Array.isArray(achado) ? achado.length : achado)) break;
      achado = null;
    }
    if (achado) {
      campos[c.campo] = { valor: achado, fonte: "briefing" };
      continue;
    }
    for (const k of DO_CONTEXTO[c.campo] || []) {
      achado = lerValor(contexto[k], c.lista);
      if (achado && (Array.isArray(achado) ? achado.length : achado)) break;
      achado = null;
    }
    if (achado) campos[c.campo] = { valor: achado, fonte: "contexto" };
  }
  const faltam = CAMPOS_DO_BRIEFING.filter((c) => !campos[c.campo]);
  const lacunas = faltam.filter((c) => c.essencial).concat(faltam.filter((c) => !c.essencial)).map((c) => c.pergunta);
  return { campos, lacunas, origem: { briefing_id: e.briefingId || null, respondido: Object.keys(respostas).length > 0 } };
}

/** Os valores simples (o que vai para idv_projetos.dados.briefing). */
export function valoresDoBriefing(b: BriefingDaIdentidade): Record<string, string | string[]> {
  const saida: Record<string, string | string[]> = {};
  for (const k of Object.keys(b.campos) as CampoDoBriefing[]) {
    const v = b.campos[k];
    if (v) saida[k] = v.valor;
  }
  return saida;
}
