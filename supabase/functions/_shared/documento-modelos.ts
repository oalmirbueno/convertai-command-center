/**
 * Documento de entrega, segunda leva (frente BRF2, 30/09/2026): modelos por
 * tipo de trabalho, o rascunho que a equipe edita antes do PDF (texto de cada
 * seção, provas escolhidas e na ordem, números com fonte, próximos passos,
 * capa com a identidade do cliente), a mensagem pronta do envio e a agenda
 * dos documentos mensais automáticos.
 *
 * Regras:
 * - O rascunho só guarda escolhas sobre o que aconteceu de verdade: prova é
 *   um evento real (id do evento); número real vem da coleta; número que a
 *   equipe acrescenta à mão só entra com a fonte escrita.
 * - O texto da equipe é dela: a conferência vira aviso, não corta frase.
 * - A agenda mensal só monta o rascunho (sem IA, sem custo) e avisa a equipe;
 *   gerar o PDF e mandar ao cliente continuam com Confirmar na tela.
 *
 * Puro: sem Deno e sem npm. Sem travessão.
 */

import {
  type EventoReal,
  FONTES,
  type NumeroReal,
  type Prova,
  resumoSemAgente,
  type TipoDeEntrega,
} from "./registro-de-entrega.ts";

// ------------------------------------------------------------------ modelos

export const MODELOS_DE_DOCUMENTO = ["mensal", "projeto", "campanha", "site", "identidade"] as const;
export type ModeloDeDocumento = typeof MODELOS_DE_DOCUMENTO[number];

export type SecaoDoModelo = { id: string; titulo: string; dica: string };

export type DefinicaoDoModelo = {
  id: ModeloDeDocumento;
  nome: string;
  tipoPadrao: TipoDeEntrega;
  /** Rótulo da capa do PDF. */
  capa: string;
  secoes: SecaoDoModelo[];
};

const s = (id: string, titulo: string, dica: string): SecaoDoModelo => ({ id, titulo, dica });

export const DEFINICOES_DE_DOCUMENTO: Record<ModeloDeDocumento, DefinicaoDoModelo> = {
  mensal: {
    id: "mensal",
    nome: "Mensal",
    tipoPadrao: "mes_de_pautas",
    capa: "Relatório do mês",
    secoes: [
      s("destaques", "Destaques do mês", "O que mais importou no mês, em 2 a 4 frases, só com o que está no painel."),
      s("aprendizados", "O que aprendemos", "O que funcionou e o que vamos mudar. Sem prometer resultado."),
    ],
  },
  projeto: {
    id: "projeto",
    nome: "Projeto",
    tipoPadrao: "projeto",
    capa: "Conclusão do projeto",
    secoes: [
      s("objetivo", "Objetivo do projeto", "O que o projeto precisava resolver, nas palavras do briefing."),
      s("entregas", "O que foi entregue", "As entregas principais, em linguagem de cliente."),
    ],
  },
  campanha: {
    id: "campanha",
    nome: "Campanha",
    tipoPadrao: "periodo",
    capa: "Relatório da campanha",
    secoes: [
      s("objetivo", "Objetivo da campanha", "O que a campanha queria alcançar e para quem."),
      s("pecas", "Peças e canais", "Quais peças rodaram e onde."),
      s("aprendizados", "O que aprendemos", "Leitura dos números com a fonte ao lado. Nada de número sem fonte."),
    ],
  },
  site: {
    id: "site",
    nome: "Site",
    tipoPadrao: "projeto",
    capa: "Entrega do site",
    secoes: [
      s("estrutura", "Páginas e estrutura", "As páginas publicadas e o caminho do visitante."),
      s("publicacao", "Publicação e acessos", "Domínio, onde está hospedado e o que o cliente recebeu. Nunca senha."),
      s("cuidados", "Cuidados daqui para frente", "Atualização, backup e o que pedir à equipe."),
    ],
  },
  identidade: {
    id: "identidade",
    nome: "Identidade visual",
    tipoPadrao: "projeto",
    capa: "Entrega da identidade",
    secoes: [
      s("conceito", "Conceito", "A ideia por trás da marca, em poucas frases."),
      s("elementos", "Elementos entregues", "Logo e versões, paleta, tipografia, aplicações."),
      s("uso", "Como usar", "Regras principais de uso e o que evitar."),
    ],
  },
};

export const ehModeloDeDocumento = (v: unknown): v is ModeloDeDocumento => typeof v === "string" && (MODELOS_DE_DOCUMENTO as readonly string[]).indexOf(v) >= 0;

/** Modelo sugerido para o tipo da entrega. */
export function modeloDoTipo(tipo: TipoDeEntrega): ModeloDeDocumento {
  return tipo === "mes_de_pautas" ? "mensal" : tipo === "periodo" ? "campanha" : "projeto";
}

// ------------------------------------------------------------------ rascunho

export type SecaoDoRascunho = { id: string; titulo: string; texto: string };
export type ProvaDoRascunho = { evento_id: string; incluir: boolean; legenda: string };
export type NumeroDoRascunho = { rotulo: string; valor: number; fonte: string; formato?: "inteiro" | "percentual"; incluir: boolean; manual?: boolean };

export type RascunhoDoDocumento = {
  modelo: ModeloDeDocumento;
  titulo: string;
  resumo: string;
  secoes: SecaoDoRascunho[];
  provas: ProvaDoRascunho[];
  numeros: NumeroDoRascunho[];
  proximos: string[];
  capa: { identidade_do_cliente: boolean };
};

export const MAX_PROVAS_NO_RASCUNHO = 12;
export const MAX_NUMEROS_NO_RASCUNHO = 12;

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s*[\u2013\u2014]\s*/g, ", ").trim().slice(0, max) : "");
const UUID_OU_EVENTO = /^[a-z_]{2,40}:[0-9A-Za-z.-]{1,80}$/;

/** Rascunho vindo da tela ou do banco, limpo (o que não for reconhecido sai). */
export function normalizarRascunho(bruto: unknown, modeloPadrao: ModeloDeDocumento = "mensal"): RascunhoDoDocumento {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const modelo = ehModeloDeDocumento(o.modelo) ? o.modelo : modeloPadrao;
  const def = DEFINICOES_DE_DOCUMENTO[modelo];
  const secoesBrutas = Array.isArray(o.secoes) ? o.secoes : [];
  const secoes: SecaoDoRascunho[] = [];
  secoesBrutas.slice(0, 10).forEach((x) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const id = txt(r.id, 40).replace(/[^a-z0-9_]/gi, "") || `secao${secoes.length + 1}`;
    if (secoes.some((y) => y.id === id)) return;
    const titulo = txt(r.titulo, 80) || (def.secoes.find((d) => d.id === id) || { titulo: "Seção" }).titulo;
    secoes.push({ id, titulo, texto: txt(r.texto, 3000) });
  });
  // As seções do modelo sempre aparecem (vazias quando a equipe ainda não escreveu).
  def.secoes.forEach((d) => {
    if (!secoes.some((x) => x.id === d.id)) secoes.push({ id: d.id, titulo: d.titulo, texto: "" });
  });
  const provas: ProvaDoRascunho[] = [];
  (Array.isArray(o.provas) ? o.provas : []).slice(0, 40).forEach((x) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const id = String(r.evento_id || "");
    if (!UUID_OU_EVENTO.test(id) || provas.some((p) => p.evento_id === id)) return;
    provas.push({ evento_id: id, incluir: r.incluir !== false, legenda: txt(r.legenda, 200) });
  });
  const numeros: NumeroDoRascunho[] = [];
  (Array.isArray(o.numeros) ? o.numeros : []).slice(0, 30).forEach((x) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const valor = Number(r.valor);
    const rotulo = txt(r.rotulo, 60);
    const fonte = txt(r.fonte, 160);
    if (!rotulo || !Number.isFinite(valor)) return;
    numeros.push({ rotulo, valor, fonte, formato: r.formato === "percentual" ? "percentual" : "inteiro", incluir: r.incluir !== false, manual: r.manual === true });
  });
  return {
    modelo,
    titulo: txt(o.titulo, 140),
    resumo: txt(o.resumo, 1800),
    secoes,
    provas,
    numeros,
    proximos: (Array.isArray(o.proximos) ? o.proximos : []).map((p) => txt(p, 240)).filter(Boolean).slice(0, 6),
    capa: { identidade_do_cliente: !(o.capa && typeof o.capa === "object" && (o.capa as Record<string, unknown>).identidade_do_cliente === false) },
  };
}

/** O rascunho de partida, só com o que aconteceu (sem IA): resumo por contagem, provas na ordem padrão e números reais. */
export function rascunhoInicial(modelo: ModeloDeDocumento, p: { titulo: string; eventos: EventoReal[]; numeros: NumeroReal[]; candidatos: EventoReal[] }): RascunhoDoDocumento {
  const def = DEFINICOES_DE_DOCUMENTO[modelo];
  return {
    modelo,
    titulo: p.titulo,
    resumo: p.eventos.length ? resumoSemAgente(p.eventos) : "",
    secoes: def.secoes.map((d) => ({ id: d.id, titulo: d.titulo, texto: "" })),
    provas: p.candidatos.slice(0, MAX_PROVAS_NO_RASCUNHO).map((c, i) => ({ evento_id: c.id, incluir: i < 8, legenda: c.detalhe || FONTES[c.fonte].grupo })),
    numeros: p.numeros.slice(0, MAX_NUMEROS_NO_RASCUNHO).map((n) => ({ rotulo: n.rotulo, valor: n.valor, fonte: n.fonte, formato: n.formato, incluir: true })),
    proximos: [],
    capa: { identidade_do_cliente: true },
  };
}

/** Novos candidatos que chegaram depois do rascunho entram no fim, desmarcados (a escolha da equipe fica). */
export function juntarCandidatos(r: RascunhoDoDocumento, candidatos: EventoReal[]): RascunhoDoDocumento {
  const ja = r.provas.map((p) => p.evento_id);
  const novos = candidatos.filter((c) => ja.indexOf(c.id) < 0).map((c) => ({ evento_id: c.id, incluir: false, legenda: c.detalhe || FONTES[c.fonte].grupo }));
  return { ...r, provas: r.provas.concat(novos).slice(0, 40) };
}

/**
 * As provas do PDF na ordem da equipe: só as marcadas e que ainda são
 * eventos reais com imagem. A legenda da equipe vence a automática.
 */
export function provasDoRascunho(candidatos: EventoReal[], r: RascunhoDoDocumento, max = 8): Prova[] {
  const saida: Prova[] = [];
  r.provas.forEach((p) => {
    if (!p.incluir || saida.length >= max) return;
    const c = candidatos.find((x) => x.id === p.evento_id);
    if (!c || !c.imagem) return;
    saida.push({ evento_id: c.id, titulo: c.titulo, legenda: p.legenda || c.detalhe || FONTES[c.fonte].grupo, quando: c.quando, link: c.link || null, imagem: c.imagem, nota: null });
  });
  return saida;
}

/**
 * Números do PDF: os reais que a equipe deixou marcados (pelo rótulo e a
 * fonte) e os manuais que têm fonte escrita. Manual sem fonte sai, com aviso.
 */
export function numerosDoRascunho(reais: NumeroReal[], r: RascunhoDoDocumento): { numeros: NumeroReal[]; avisos: string[] } {
  const avisos: string[] = [];
  const numeros: NumeroReal[] = [];
  const marcado = (n: NumeroReal) => {
    const noRascunho = r.numeros.find((x) => !x.manual && x.rotulo === n.rotulo && x.fonte === n.fonte);
    return !noRascunho || noRascunho.incluir;
  };
  reais.forEach((n) => {
    if (marcado(n)) numeros.push(n);
  });
  r.numeros.filter((x) => x.manual && x.incluir).forEach((x) => {
    if (!x.fonte || x.fonte.length < 3) {
      avisos.push(`O número "${x.rotulo}" ficou de fora: número só entra com a fonte ao lado.`);
      return;
    }
    numeros.push({ rotulo: x.rotulo, valor: x.valor, fonte: `${x.fonte} (informado pela equipe)`, formato: x.formato });
  });
  return { numeros: numeros.slice(0, MAX_NUMEROS_NO_RASCUNHO), avisos };
}

/** Seções com texto, na ordem, para o PDF. */
export function secoesDoRascunho(r: RascunhoDoDocumento): Array<{ titulo: string; texto: string }> {
  return r.secoes.filter((x) => x.texto.trim()).map((x) => ({ titulo: x.titulo, texto: x.texto.trim() }));
}

// ------------------------------------------------------------------ envio

/** Mensagem pronta para mandar ao cliente (WhatsApp ou grupo). Sem travessão, sem exclamação. */
export function mensagemDoDocumento(p: { cliente?: string | null; titulo: string; numero?: number | null; itens: number; provas: number; url: string; grupo?: boolean; aprovar?: boolean }): string {
  const nome = String(p.cliente || "").trim().slice(0, 80);
  const saudacao = p.grupo ? "Olá, pessoal." : nome ? `Olá, ${nome}.` : "Olá.";
  const n = p.numero ? ` (nº ${("000" + p.numero).slice(-4)})` : "";
  const conta = [
    p.itens ? `${p.itens} ${p.itens === 1 ? "item feito" : "itens feitos"}` : "",
    p.provas ? `${p.provas} ${p.provas === 1 ? "prova" : "provas"} com imagem` : "",
  ].filter(Boolean).join(" e ");
  return [
    saudacao,
    `O registro "${p.titulo}"${n} está no seu painel${conta ? `, com ${conta}` : ""}. Tudo o que está lá aconteceu e ficou registrado.`,
    p.aprovar ? "Quando puder, confira e aprove por lá. Se algo não bater com o que você viu, é só responder aqui." : "Quando puder, dê uma olhada. Qualquer dúvida, é só responder aqui.",
    p.url,
  ].join("\n\n");
}

// ------------------------------------------------------------------ agenda mensal

/** O mês de referência ("2026-09") anterior ao dia dado, no horário de São Paulo. */
export function mesAnterior(agora: Date = new Date()): string {
  const sp = new Date(agora.getTime() - 3 * 3_600_000);
  let ano = sp.getUTCFullYear();
  let mes = sp.getUTCMonth(); // 0-11: o mês atual; o anterior é mes - 1
  if (mes === 0) {
    ano -= 1;
    mes = 12;
  }
  return `${ano}-${mes < 10 ? `0${mes}` : String(mes)}`;
}

/**
 * Qual mês a agenda deve preparar agora: o anterior, a partir do dia marcado
 * (1 a 28, horário de São Paulo), uma vez só por mês. null = nada a fazer.
 */
export function mesParaGerar(agora: Date, dia: number, ultimoMes: string | null | undefined): string | null {
  const d = Math.max(1, Math.min(28, Math.round(Number(dia) || 1)));
  const sp = new Date(agora.getTime() - 3 * 3_600_000);
  if (sp.getUTCDate() < d) return null;
  const alvo = mesAnterior(agora);
  return ultimoMes === alvo ? null : alvo;
}

const MESES_POR_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-09" vira "setembro de 2026". */
export function rotuloDoMesDeReferencia(ref: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ref || ""));
  if (!m) return String(ref || "");
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MESES_POR_EXTENSO[i]} de ${m[1]}` : String(ref);
}
