import {
  AREAS_DO_TEMPLATE,
  DIMENSOES_DA_COMBINACAO,
  DIMENSOES_DO_TEMPLATE,
  FORMATOS_DO_TEMPLATE,
  ROTULOS_DAS_AREAS,
  ROTULOS_DAS_DIMENSOES,
  ROTULOS_DOS_FORMATOS,
  type CorpoDoTemplate,
  type DeOnde,
  type FormatoDoTemplate,
} from "../../../supabase/functions/_shared/templates-de-design";
import { PARTES_DA_LAMINA, ROTULOS_DAS_PARTES } from "../../../supabase/functions/_shared/referencia-de-carrossel";
import { ROTULOS_DA_CONTINUIDADE } from "../../../supabase/functions/_shared/continuidade-do-carrossel";
import { FIDELIDADES, ROTULO_DA_FIDELIDADE } from "../../../supabase/functions/_shared/fidelidade-da-referencia";
import { chamarEstilo } from "./estiloApi";

/**
 * Tela dos templates de design e das referências de carrossel (frente T).
 * Tipos do que a função agente-estilo devolve e as chamadas. Os campos, os
 * rótulos e o mapa de lâminas vêm dos módulos puros do servidor, os mesmos
 * que a geração usa.
 */

export {
  AREAS_DO_TEMPLATE,
  DIMENSOES_DA_COMBINACAO,
  DIMENSOES_DO_TEMPLATE,
  FIDELIDADES,
  FORMATOS_DO_TEMPLATE,
  PARTES_DA_LAMINA,
  ROTULO_DA_FIDELIDADE,
  ROTULOS_DA_CONTINUIDADE,
  ROTULOS_DAS_AREAS,
  ROTULOS_DAS_DIMENSOES,
  ROTULOS_DAS_PARTES,
  ROTULOS_DOS_FORMATOS,
};
export type { CorpoDoTemplate, DeOnde, FormatoDoTemplate };

export interface ImagemNaTela {
  id: string;
  nome: string;
  papel: string;
  url: string;
  mini: string;
  origem?: string;
  partes?: Record<string, string>;
}

export interface TesteDoTemplateNaTela {
  id: string;
  tema: string;
  versao: number;
  status: "novo" | "aprovado" | "descartado";
  url: string;
  mini: string;
}

export interface TemplateNaTela {
  id: string;
  tipo: "template" | "referencia_carrossel";
  escopo: "cliente" | "agencia";
  nome: string;
  formato: FormatoDoTemplate;
  status: "ativo" | "arquivado";
  origem: string;
  versao_atual: number;
  corpo: CorpoDoTemplate | null;
  versoes: Array<{ numero: number; origem: string; nota: string; criado_em: string; de_onde: DeOnde[] }>;
  gostos: Array<{ id: string; quem: "cliente" | "dono"; tipo: "gostou" | "nao_gostou"; texto: string; em: string }>;
  testes: TesteDoTemplateNaTela[];
  ancoras: ImagemNaTela[];
  laminas: ImagemNaTela[];
}

export interface EstadoDosTemplates {
  guardado_em: "tabela" | "arquivo";
  aviso: string | null;
  templates: TemplateNaTela[];
}

export const chaveDosTemplates = (clientId: string, marcaId: string | null | undefined, arquivados = false) => ["estilo-templates", clientId, marcaId || "cliente", arquivados ? "todos" : "ativos"];

const lista = (v: any) => (Array.isArray(v) ? v : []);

/** Estado normalizado (listas sempre listas): resposta parcial ou vazia não quebra a tela. */
export function normalizarEstadoDosTemplates(d: any): EstadoDosTemplates {
  const templates: TemplateNaTela[] = lista(d && d.templates)
    .filter((t: any) => t && typeof t.id === "string")
    .map((t: any) => ({
      id: t.id,
      tipo: t.tipo === "referencia_carrossel" ? "referencia_carrossel" : "template",
      escopo: t.escopo === "agencia" ? "agencia" : "cliente",
      nome: String(t.nome || "Template"),
      formato: FORMATOS_DO_TEMPLATE.indexOf(t.formato) >= 0 ? t.formato : "post",
      status: t.status === "arquivado" ? "arquivado" : "ativo",
      origem: String(t.origem || ""),
      versao_atual: typeof t.versao_atual === "number" ? t.versao_atual : 0,
      corpo: t.corpo && typeof t.corpo === "object" ? (t.corpo as CorpoDoTemplate) : null,
      versoes: lista(t.versoes).map((v: any) => ({ ...v, de_onde: lista(v && v.de_onde) })),
      gostos: lista(t.gostos),
      testes: lista(t.testes),
      ancoras: lista(t.ancoras),
      laminas: lista(t.laminas),
    }));
  return {
    guardado_em: d && d.guardado_em === "arquivo" ? "arquivo" : "tabela",
    aviso: d && typeof d.aviso === "string" ? d.aviso : null,
    templates,
  };
}

export function chamarTemplates<T = any>(acao: string, clientId: string, marcaId: string | null | undefined, corpo: Record<string, unknown> = {}): Promise<T> {
  return chamarEstilo<T>(acao, clientId, marcaId, corpo);
}

/** Mover um item da lista (reordenar lâminas antes de guardar ou de gravar a ordem nova). */
export function mover<T>(itens: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= itens.length || para >= itens.length) return itens.slice();
  const copia = itens.slice();
  const [x] = copia.splice(de, 1);
  copia.splice(para, 0, x);
  return copia;
}

export const rotuloDoTipo = (t: Pick<TemplateNaTela, "tipo" | "formato" | "escopo">) =>
  `${t.tipo === "referencia_carrossel" ? "Referência de carrossel" : ROTULOS_DOS_FORMATOS[t.formato]}${t.escopo === "agencia" ? " · agência" : ""}`;

/** A primeira imagem que representa o template na lista (miniatura própria, nunca transform). */
export function capaDoTemplate(t: TemplateNaTela): string {
  const a = t.laminas[0] || t.ancoras[0] || t.testes.find((x) => x.status === "aprovado") || t.testes[0];
  return a ? a.mini || a.url || "" : "";
}
