/**
 * Ações que o agente da Mesa Roteiros propõe e a equipe confirma (contrato
 * comum em ../_shared/acoes-do-agente.ts: apelido em vez de UUID, cartão
 * Confirmar/Cancelar, item a item, Desfazer, travas e auditoria).
 *
 * Pedidos do dono que viram operação:
 * - "refaça o gancho"            -> refazer_gancho (roteiro r1..; para = pedido extra)
 * - "mude o tom"                 -> mudar_tom (roteiro; para = o tom pedido)
 * - "gere os roteiros das 4 peças de vídeo da semana" -> gerar_roteiro (peça p1..; para = tipo)
 * - "arquive este roteiro"       -> arquivar_roteiro (roteiro)
 * As três primeiras usam IA: o custo estimado vai no cartão antes de confirmar.
 * Todas têm Desfazer: a IA deixa a versão anterior como atual de novo (a nova
 * fica no histórico) ou arquiva o roteiro criado; arquivar volta a desarquivar.
 *
 * Sem import de Deno: o Vitest lê este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { ehTipoDeRoteiro, modoDoTipo, ROTULO_DO_FORMATO, ROTULO_DO_STATUS, type StatusDoRoteiro, type TipoDeRoteiro } from "../_shared/roteiro-modelo.ts";

export const OPERACOES_DOS_ROTEIROS = ["refazer_gancho", "mudar_tom", "gerar_roteiro", "arquivar_roteiro"];
/** Operações que chamam o roteirista (custam IA). */
export const OPERACOES_COM_IA = ["refazer_gancho", "mudar_tom", "gerar_roteiro"];

export const ESQUEMA_DAS_ACOES_DOS_ROTEIROS = esquemaDasAcoes(OPERACOES_DOS_ROTEIROS);

export type RoteiroParaAcao = {
  id: string;
  titulo: string;
  tipo: TipoDeRoteiro;
  status: StatusDoRoteiro;
  versao_atual: number;
  arquivado: boolean;
  data_da_peca?: string | null;
};

export type PecaParaAcao = {
  /** id da tarefa da agenda. */
  id: string;
  titulo: string;
  formato: string;
  data: string | null;
  /** Status do roteiro vivo da peça, quando já existe. */
  roteiro_status?: StatusDoRoteiro | null;
};

type AlvoDosRoteiros = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

const dataCurta = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}` : "";
};

export function alvosDosRoteiros(roteiros: RoteiroParaAcao[]): Array<AlvoComApelido<AlvoDosRoteiros>> {
  const ordenados = roteiros.slice(0, 60);
  return comApelido(
    ordenados.map((r) => ({
      id: r.id,
      titulo: r.titulo,
      detalhe: [r.arquivado ? "arquivado" : ROTULO_DO_STATUS[r.status] || r.status, `v${r.versao_atual}`, modoDoTipo(r.tipo).rotulo, r.data_da_peca ? `peça de ${dataCurta(r.data_da_peca)}` : ""]
        .filter(Boolean)
        .join(" · "),
      dados: { status: r.status, arquivado: r.arquivado, tipo: r.tipo },
    })),
    "r",
  );
}

export function alvosDasPecas(pecas: PecaParaAcao[]): Array<AlvoComApelido<AlvoDosRoteiros>> {
  return comApelido(
    pecas.slice(0, 40).map((p) => ({
      id: p.id,
      titulo: p.titulo,
      detalhe: [ROTULO_DO_FORMATO[p.formato] || p.formato, dataCurta(p.data), p.roteiro_status ? `roteiro ${ROTULO_DO_STATUS[p.roteiro_status].toLowerCase()}` : "sem roteiro"].filter(Boolean).join(" · "),
      dados: { roteiro_status: p.roteiro_status || null },
    })),
    "p",
  );
}

/** Tipo pedido em palavras ("tutorial", "história", "ugc"...) para o valor da mesa. */
export function tipoPedido(bruto: unknown): TipoDeRoteiro | null {
  const t = String(bruto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!t) return "fala_camera";
  if (ehTipoDeRoteiro(t)) return t;
  if (/tutorial|passo/.test(t)) return "tutorial";
  if (/ugc|depoimento|anuncio|conversao/.test(t)) return "ugc";
  if (/cinema|historia|cinematograf|narrativ/.test(t)) return "cinema";
  if (/fala|camera|talking|explica/.test(t)) return "fala_camera";
  return null;
}

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

const travaDoRoteiro = (alvo: AlvoComApelido<AlvoDosRoteiros>): string | null => {
  const d = alvo.dados || {};
  if (d.arquivado === true) return "Roteiro arquivado. Desarquive antes.";
  if (d.status === "gravado") return "Roteiro já gravado. Volte para aprovado antes de mexer.";
  return null;
};

export function regrasDosRoteiros(): Record<string, RegraDaOperacao<AlvoDosRoteiros>> {
  return {
    refazer_gancho: {
      rotulo: "refazer o gancho de",
      alvos: ["r"],
      para: (bruto) => umaLinha(bruto, 300) || "sem pedido extra",
      trava: (alvo) => travaDoRoteiro(alvo),
    },
    mudar_tom: {
      rotulo: "mudar o tom de",
      alvos: ["r"],
      para: (bruto) => {
        const t = umaLinha(bruto, 160);
        return t.length >= 3 ? t : null;
      },
      trava: (alvo) => travaDoRoteiro(alvo),
    },
    gerar_roteiro: {
      rotulo: "gerar o roteiro de",
      alvos: ["p"],
      para: (bruto) => tipoPedido(bruto),
      trava: (alvo) => {
        const s = alvo.dados ? alvo.dados.roteiro_status : null;
        if (s === "aprovado" || s === "gravado") return "A peça já tem roteiro aprovado. Peça uma mudança no roteiro dela.";
        return null;
      },
    },
    arquivar_roteiro: {
      rotulo: "arquivar",
      alvos: ["r"],
      trava: (alvo) => (alvo.dados && alvo.dados.arquivado === true ? "Já está arquivado." : null),
    },
  };
}

export const DESCRICOES_DOS_ROTEIROS: Record<string, string> = {
  refazer_gancho: "três ganchos novos, de mecanismos diferentes, para o roteiro (ref r..). para: o que a equipe pediu (ex.: 'mais direto'), ou vazio.",
  mudar_tom: "reescreve as falas do roteiro (ref r..) no tom pedido, mantendo fatos, estrutura e tempos. para: o tom (ex.: 'mais leve e próximo').",
  gerar_roteiro: "gera o roteiro de uma peça de vídeo da agenda (ref p..). para: fala_camera, tutorial, ugc ou cinema (vazio: fala_camera). Pedido de 'peças da semana' vale para as peças com data nos próximos 7 dias.",
  arquivar_roteiro: "arquiva o roteiro (ref r..). Dá para desarquivar. para vazio.",
};

/** Bloco do prompt com as listas (apelidos, nunca id) e a regra das ações. */
export function blocoDasAcoesDosRoteiros(roteiros: RoteiroParaAcao[], pecas: PecaParaAcao[]): string {
  return `${blocoDosAlvos("ROTEIROS DO CLIENTE", alvosDosRoteiros(roteiros), "nenhum ainda.")}${blocoDosAlvos("PEÇAS DE VÍDEO DA AGENDA", alvosDasPecas(pecas), "nenhuma no período.")}\n${regraDasAcoes(DESCRICOES_DOS_ROTEIROS)}`;
}

/**
 * Lê as ações do modelo e troca apelido por alvo. Custo estimado = custo de
 * uma geração vezes os itens que usam IA (o cartão mostra antes de confirmar).
 */
export function normalizarAcoesDosRoteiros(
  bruto: unknown,
  roteiros: RoteiroParaAcao[],
  pecas: PecaParaAcao[],
  clientId: string,
  custoPorGeracaoUsd: number,
  id?: string,
): AcaoDoAgente | null {
  const alvos = [...alvosDosRoteiros(roteiros), ...alvosDasPecas(pecas)];
  const acao = normalizarAcaoDoAgente(bruto, alvos, regrasDosRoteiros(), {
    agente: "roteiros",
    id: id || `roteiros-${Date.now().toString(36)}`,
    contexto: { client_id: clientId },
    rotuloDoPara: (operacao, para) => {
      if (operacao === "gerar_roteiro" && typeof para === "string") return modoDoTipo(para).rotulo;
      if (operacao === "refazer_gancho" && para === "sem pedido extra") return null;
      return null;
    },
  });
  if (!acao) return null;
  const comIa = acao.itens.filter((i) => OPERACOES_COM_IA.indexOf(i.operacao) >= 0).length;
  acao.custo_estimado_usd = comIa ? Math.round(comIa * Math.max(0, custoPorGeracaoUsd) * 1e6) / 1e6 : 0;
  return acao;
}

/** Peças com data nos próximos N dias (a "semana" do pedido), a partir de hoje. */
export function pecasDaSemana<T extends { data: string | null }>(pecas: T[], hoje: string, dias = 7): T[] {
  const inicio = new Date(`${hoje.slice(0, 10)}T00:00:00Z`).getTime();
  const fim = inicio + dias * 86400000;
  return pecas.filter((p) => {
    if (!p.data) return false;
    const t = new Date(`${p.data.slice(0, 10)}T00:00:00Z`).getTime();
    return t >= inicio && t < fim;
  });
}
