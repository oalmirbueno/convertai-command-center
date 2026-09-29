/**
 * Preencher com IA na tela (frente PIA, 30/09): a ponte com a função
 * `preencher-ia`. Os tipos são os MESMOS do servidor
 * (supabase/functions/_shared/preencher-com-ia.ts), reexportados aqui.
 * A peça visual é src/components/sistema/PreencherComIA.tsx.
 */
import { chamarFuncao } from "@/lib/mesa/api";
import type {
  CampoParaPreencher,
  FonteDoPreenchimento,
  ResultadoDoPreenchimento,
  TipoDoCampo,
} from "../../../supabase/functions/_shared/preencher-com-ia";

export type { CampoParaPreencher, FonteDoPreenchimento, ResultadoDoPreenchimento, TipoDoCampo };

export const FONTES_DO_PREENCHIMENTO: FonteDoPreenchimento[] = ["contexto", "briefing", "dossie", "arquivos", "conversa", "web"];
export const FONTES_PADRAO: FonteDoPreenchimento[] = ["contexto", "briefing", "dossie"];

export const ROTULO_DA_FONTE: Record<FonteDoPreenchimento, string> = {
  contexto: "Contexto",
  briefing: "Briefing",
  dossie: "Dossiê",
  arquivos: "Arquivos",
  conversa: "Conversa",
  web: "Web",
};

export type EstimativaDoPreenchimento = {
  partes: Array<{ nome: string; custo_usd: number; tokens?: number }>;
  custo_usd: number;
  modelo_id: string;
  modelo_nome: string;
  campos_a_preencher: number;
};

export type PedidoDoPreenchimento = {
  papel: string;
  clientId: string;
  marcaId?: string | null;
  modeloId?: string | null;
  campos: CampoParaPreencher[];
  fontes: FonteDoPreenchimento[];
  contexto?: string;
  instrucao?: string;
  substituir?: boolean;
};

/** Só o que o servidor usa de cada campo (valor atual vai inteiro: é referência e decide "só vazios"). */
function camposParaEnviar(campos: CampoParaPreencher[]) {
  return campos.map((c) => ({
    chave: c.chave,
    rotulo: c.rotulo,
    tipo: c.tipo,
    ...(c.opcoes ? { opcoes: c.opcoes } : {}),
    ...(c.valorAtual !== undefined ? { valorAtual: c.valorAtual } : {}),
    ...(c.dica ? { dica: c.dica } : {}),
    ...(c.maximo ? { maximo: c.maximo } : {}),
  }));
}

/** Custo antes (sem IA). */
export function estimarPreenchimento(p: PedidoDoPreenchimento): Promise<EstimativaDoPreenchimento> {
  return chamarFuncao<EstimativaDoPreenchimento>("preencher-ia", {
    acao: "estimar",
    papel: p.papel,
    client_id: p.clientId,
    modelo_id: p.modeloId || null,
    campos: camposParaEnviar(p.campos),
    fontes: p.fontes,
    substituir: !!p.substituir,
    instrucao: p.instrucao || "",
    contexto: p.contexto || "",
  });
}

/** Preenche (com IA): devolve a prévia; nada é gravado. */
export function preencherComIA(p: PedidoDoPreenchimento): Promise<ResultadoDoPreenchimento & { saldo_usd?: number }> {
  return chamarFuncao<ResultadoDoPreenchimento & { saldo_usd?: number }>("preencher-ia", {
    acao: "preencher",
    papel: p.papel,
    client_id: p.clientId,
    // null explícito = sem marca; undefined deixa a casca mandar a marca aberta (corpoComMarca).
    ...(p.marcaId !== undefined ? { marca_id: p.marcaId } : {}),
    modelo_id: p.modeloId || null,
    campos: camposParaEnviar(p.campos),
    fontes: p.fontes,
    contexto: p.contexto || "",
    instrucao: p.instrucao || "",
    substituir: !!p.substituir,
  });
}

/** Valor para a prévia (antes e depois), em uma linha legível. */
export function valorParaLer(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valorParaLer).filter(Boolean).join("; ");
  if (typeof v === "object") {
    return Object.keys(v as Record<string, unknown>)
      .map((k) => {
        const t = valorParaLer((v as Record<string, unknown>)[k]);
        return t ? `${k}: ${t}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}
