import type { CandidatoDeLead } from "./maquinaApi";

/**
 * Saúde e nota do candidato da Máquina de leads (04/11/2026, dono: "cores como saudável e nota").
 * Saúde é regra fixa e olha só os dados que já vieram: dá para falar com ele e o negócio parece vivo?
 * A nota de encaixe é outra coisa e vem do Jev.
 */

export type NivelDaSaude = "saudavel" | "atencao" | "fraco";
export type Saude = { nivel: NivelDaSaude; rotulo: string; porque: string };

const ROTULO: Record<NivelDaSaude, string> = { saudavel: "Saudável", atencao: "Atenção", fraco: "Fraco" };

/** Cores de cada nível: verde, âmbar e vermelho, as mesmas na saúde, na nota e na lista. */
export const COR_DO_NIVEL: Record<NivelDaSaude, string> = {
  saudavel: "bg-success/15 text-success",
  atencao: "bg-warning/15 text-warning",
  fraco: "bg-destructive/15 text-destructive",
};

const evidencia = (c: Pick<CandidatoDeLead, "evidencias">, campo: string) =>
  (c.evidencias || []).filter((e) => e.campo === campo)[0]?.valor || null;

/** O que o Google Maps trouxe, lido das evidências; busca antiga ou de outra fonte devolve vazio. */
export function dadosDoLugar(c: Pick<CandidatoDeLead, "evidencias">) {
  const bruto = evidencia(c, "avaliacoes") || "";
  const m = /^([\d.,]+)\s*\((\d+)/.exec(bruto);
  const numero = (campo: string) => {
    const v = Number(evidencia(c, campo));
    return Number.isFinite(v) ? v : 0;
  };
  return {
    estrelas: m ? Number(m[1].replace(",", ".")) : null,
    avaliacoes: m ? Number(m[2]) : 0,
    dor: numero("nota_dor"),
    oportunidade: numero("nota_oportunidade"),
    whatsappProvavel: evidencia(c, "whatsapp_provavel"),
    bairro: evidencia(c, "bairro"),
    horario: evidencia(c, "horario"),
    facebook: evidencia(c, "facebook"),
    linkedin: evidencia(c, "linkedin"),
  };
}

export function saudeDoCandidato(c: CandidatoDeLead): Saude {
  const lugar = dadosDoLugar(c);
  const motivos: string[] = [];
  let pontos = 0;
  if (c.whatsapp) { pontos += 3; motivos.push("tem WhatsApp"); }
  else if (c.telefone) { pontos += 2; motivos.push(lugar.whatsappProvavel ? "celular, talvez WhatsApp" : "só telefone"); }
  else motivos.push("sem telefone");
  if (c.site) { pontos += 1; motivos.push("tem site"); } else motivos.push("sem site");
  if (c.email) { pontos += 1; motivos.push("tem e-mail"); }
  if (c.instagram) { pontos += 1; motivos.push("tem Instagram"); }
  if (lugar.estrelas != null) {
    if (lugar.estrelas >= 4 && lugar.avaliacoes >= 10) { pontos += 1; motivos.push("bem avaliado"); }
    if (lugar.estrelas < 3.5 && lugar.avaliacoes >= 10) { pontos -= 1; motivos.push("avaliação baixa"); }
  }
  const nivel: NivelDaSaude = pontos >= 4 ? "saudavel" : pontos >= 2 ? "atencao" : "fraco";
  return { nivel, rotulo: ROTULO[nivel], porque: motivos.join(", ") };
}

/** A nota de encaixe do Jev nas mesmas cores: 7 ou mais é verde, de 4 a 7 âmbar, abaixo de 4 vermelho. */
export const nivelDaNota = (nota: number): NivelDaSaude => (nota >= 7 ? "saudavel" : nota >= 4 ? "atencao" : "fraco");

export type OrdemDosCandidatos = "recentes" | "nota" | "saude" | "avaliacoes" | "nome";
export const ORDENS: Array<{ id: OrdemDosCandidatos; rotulo: string }> = [
  { id: "recentes", rotulo: "Mais recentes" },
  { id: "nota", rotulo: "Melhor nota" },
  { id: "saude", rotulo: "Mais saudáveis" },
  { id: "avaliacoes", rotulo: "Mais avaliados" },
  { id: "nome", rotulo: "Nome (A a Z)" },
];

const PESO: Record<NivelDaSaude, number> = { saudavel: 2, atencao: 1, fraco: 0 };

export function ordenarCandidatos<T extends CandidatoDeLead & { created_at?: string }>(lista: T[], ordem: OrdemDosCandidatos): T[] {
  const copia = lista.slice();
  if (ordem === "nome") return copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (ordem === "nota") return copia.sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
  if (ordem === "saude") return copia.sort((a, b) => PESO[saudeDoCandidato(b).nivel] - PESO[saudeDoCandidato(a).nivel]);
  if (ordem === "avaliacoes") return copia.sort((a, b) => dadosDoLugar(b).avaliacoes - dadosDoLugar(a).avaliacoes);
  return copia.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export type FiltroDeContato = "todos" | "whatsapp" | "telefone" | "email" | "site" | "sem_site";
export const FILTROS_DE_CONTATO: Array<{ id: FiltroDeContato; rotulo: string }> = [
  { id: "todos", rotulo: "Qualquer contato" },
  { id: "whatsapp", rotulo: "Com WhatsApp" },
  { id: "telefone", rotulo: "Com telefone" },
  { id: "email", rotulo: "Com e-mail" },
  { id: "site", rotulo: "Com site" },
  { id: "sem_site", rotulo: "Sem site" },
];

export const passaNoContato = (c: CandidatoDeLead, f: FiltroDeContato) =>
  f === "todos" ? true
    : f === "whatsapp" ? !!c.whatsapp
    : f === "telefone" ? !!(c.telefone || c.whatsapp)
    : f === "email" ? !!c.email
    : f === "site" ? !!c.site
    : !c.site;

/** O que a busca paga pode gastar, no máximo: o mesmo cálculo do motor (workers/leads/apify.py). */
export const tetoDoGoogleEmDolar = (limite: number) => Math.max(0.5, Math.round(limite * 0.008 * 100) / 100);
