import type { Tone } from "@/components/ds";
import { diaLegivel, diasAte, ROTULO_DO_ESTADO, type ContaNaCasa, type EstadoDaConta } from "@/lib/produto/api";

/**
 * O estado de uma empresa do produto, igual em todas as telas da casa (Visão geral, Empresas,
 * Faturamento e a janela da empresa): o tom do Chip, a frase curta e a chave da lista.
 */

export const chaveDasContas = ["produto", "casa", "contas"] as const;

/** O tom do Chip de cada estado. */
export const TOM_DO_ESTADO: Record<EstadoDaConta, Tone> = {
  teste: "info",
  ativa: "success",
  atrasada: "warning",
  suspensa: "danger",
  cancelada: "neutral",
  cortesia: "accent",
};

/** As classes da etiqueta antiga (quem ainda usa `etiqueta` em vez do Chip). */
export const COR_DO_ESTADO: Record<EstadoDaConta, string> = {
  teste: "bg-muted text-muted-foreground",
  ativa: "bg-accent-soft text-primary",
  atrasada: "bg-warning-soft text-warning",
  suspensa: "bg-danger-soft text-destructive",
  cancelada: "bg-muted text-muted-foreground",
  cortesia: "bg-muted text-foreground",
};

/** O CRM desta empresa é cobrado no plano do cliente da Aceleriq (extra de CRM), e não no cartão. */
export const pelaPlano = (c: object): boolean => (c as { cobranca_por?: string }).cobranca_por === "plano";

/** A linha de situação de uma empresa, para a lista. */
export function situacaoDaConta(c: ContaNaCasa, agora = Date.now()): string {
  if (c.estado === "teste") {
    const dias = diasAte(c.teste_ate, agora);
    return c.liberada ? `teste, ${dias} ${dias === 1 ? "dia" : "dias"}` : "teste vencido";
  }
  if (c.estado === "atrasada") return c.liberada ? "atrasada, ainda com acesso" : "atrasada, sem acesso";
  if (c.estado === "cancelada" && c.liberada) return `cancelada, acesso até ${diaLegivel(c.acesso_ate)}`;
  return ROTULO_DO_ESTADO[c.estado].toLowerCase() + (pelaPlano(c) ? ", pelo plano do cliente" : "");
}

/** O tom do estado, olhando também o acesso (teste vencido e atraso sem acesso pesam mais). */
export function tomDaConta(c: Pick<ContaNaCasa, "estado" | "liberada">): Tone {
  if (c.estado === "teste" && !c.liberada) return "warning";
  if (c.estado === "atrasada" && !c.liberada) return "danger";
  return TOM_DO_ESTADO[c.estado];
}

/** Primeira letra maiúscula (o Chip mostra "Teste, 3 dias"). */
export const comMaiuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** "R$ 12 mil", "R$ 1,2 mi" ou o valor inteiro: o mesmo atalho do painel do cliente. */
export const reaisCurto = (v: number, reais: (n: number) => string) =>
  v >= 1000000 ? `R$ ${(v / 1000000).toFixed(1).replace(".", ",")} mi` : v >= 10000 ? `R$ ${Math.round(v / 1000)} mil` : reais(v);

/**
 * As cores das etapas do funil, as mesmas do painel do cliente (produto.css só vale dentro do
 * app do cliente; aqui elas entram como variáveis no elemento de fora).
 */
export const CORES_DAS_ETAPAS: Record<string, string> = {
  "--etapa-novo": "hsl(205 85% 55%)",
  "--etapa-contato": "hsl(188 80% 45%)",
  "--etapa-diagnostico": "hsl(258 75% 66%)",
  "--etapa-proposta": "hsl(40 92% 52%)",
  "--etapa-negociacao": "hsl(24 92% 56%)",
  "--etapa-ganho": "hsl(var(--primary))",
  "--etapa-perdido": "hsl(0 72% 58%)",
};
