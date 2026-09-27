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
  type CaminhoDoAgente,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../_shared/mapa-do-painel.ts";
import { ehTipoDeRoteiro, modoDoTipo, ROTULO_DO_FORMATO, ROTULO_DO_STATUS, type StatusDoRoteiro, type TipoDeRoteiro } from "../_shared/roteiro-modelo.ts";
import { DESCRICOES_DE_EDICAO, OPERACOES_DE_EDICAO, regrasDeEdicao } from "./acoes-de-edicao.ts";

// Frente AG (26/09): as de edição sem IA (editar_texto, aprovar_roteiro, marcar_gravado) moram em acoes-de-edicao.ts.
export const OPERACOES_DOS_ROTEIROS = ["refazer_gancho", "mudar_tom", "gerar_roteiro", "arquivar_roteiro", ...OPERACOES_DE_EDICAO];
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

/** Peças que o agente enxerga: 40 na janela padrão; até 120 quando o pedido cita meses ou datas à frente. */
export const MAX_PECAS_NA_JANELA = 40;
export const MAX_PECAS_NA_JANELA_ESTENDIDA = 120;

const somarDiasIso = (data: string, n: number) => {
  const d = new Date(`${data}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MESES_DO_ANO = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const primeiroDoMes = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;
const primeiroDoMesSeguinte = (a: number, m: number) => (m === 12 ? primeiroDoMes(a + 1, 1) : primeiroDoMes(a, m + 1));

/**
 * Janela das peças de vídeo que o agente vê (anti-bug 26/09, o mesmo do Mês):
 * de 7 dias atrás a 40 à frente; o pedido que cita um mês ("roteiros de
 * dezembro", "mês que vem") ou uma data AAAA-MM-DD estica a janela até lá (no
 * máximo um ano). `ate` é exclusivo. Mês citado que já passou neste ano é o do
 * ano seguinte, a não ser que o ano venha junto ("agosto de 2026").
 */
export function janelaDasPecas(mensagem: string, hoje: string): { de: string; ate: string; estendida: boolean } {
  const baseDe = somarDiasIso(hoje, -7);
  const baseAte = somarDiasIso(hoje, 40);
  const teto = somarDiasIso(hoje, 366);
  let de = baseDe;
  let ate = baseAte;
  const t = String(mensagem || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const anoHoje = Number(hoje.slice(0, 4));
  const mesHoje = Number(hoje.slice(5, 7));
  const incluirMes = (a: number, m: number) => {
    const ini = primeiroDoMes(a, m);
    const fim = primeiroDoMesSeguinte(a, m);
    if (ini < de) de = ini;
    if (fim > ate) ate = fim;
  };
  MESES_DO_ANO.forEach((nome, i) => {
    const re = new RegExp(`\\b${nome}\\b(?:\\s+de\\s+(\\d{4}))?`, "g");
    let achado: RegExpExecArray | null;
    while ((achado = re.exec(t))) {
      const m = i + 1;
      const a = achado[1] ? Number(achado[1]) : m < mesHoje ? anoHoje + 1 : anoHoje;
      incluirMes(a, m);
    }
  });
  if (/\b(mes que vem|proximo mes)\b/.test(t)) incluirMes(mesHoje === 12 ? anoHoje + 1 : anoHoje, mesHoje === 12 ? 1 : mesHoje + 1);
  for (const d of t.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []) {
    if (d > hoje && somarDiasIso(d, 1) > ate) ate = somarDiasIso(d, 1);
  }
  if (ate > teto) ate = teto;
  // Janela para trás só dentro do mês citado deste ano (roteiro de peça que já passou continua visível).
  if (de < somarDiasIso(hoje, -62)) de = somarDiasIso(hoje, -62);
  return { de, ate, estendida: de !== baseDe || ate !== baseAte };
}

export function alvosDasPecas(pecas: PecaParaAcao[], max = MAX_PECAS_NA_JANELA): Array<AlvoComApelido<AlvoDosRoteiros>> {
  return comApelido(
    pecas.slice(0, max).map((p) => ({
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
    ...regrasDeEdicao(),
  };
}

export const DESCRICOES_DOS_ROTEIROS: Record<string, string> = {
  refazer_gancho: "três ganchos novos, de mecanismos diferentes, para o roteiro (ref r..). para: o que a equipe pediu (ex.: 'mais direto'), ou vazio.",
  mudar_tom: "reescreve as falas do roteiro (ref r..) no tom pedido, mantendo fatos, estrutura e tempos. para: o tom (ex.: 'mais leve e próximo').",
  gerar_roteiro: "gera o roteiro de uma peça de vídeo da agenda (ref p..). para: fala_camera, tutorial, ugc ou cinema (vazio: fala_camera). Pedido de 'peças da semana' vale para as peças com data nos próximos 7 dias.",
  arquivar_roteiro: "arquiva o roteiro (ref r..). Dá para desarquivar. para vazio.",
  ...DESCRICOES_DE_EDICAO,
};

/** Bloco do prompt com as listas (apelidos, nunca id) e a regra das ações. */
export function blocoDasAcoesDosRoteiros(
  roteiros: RoteiroParaAcao[],
  pecas: PecaParaAcao[],
  janela?: { de: string; ate: string; estendida: boolean },
  totalDePecas?: number,
): string {
  const max = janela && janela.estendida ? MAX_PECAS_NA_JANELA_ESTENDIDA : MAX_PECAS_NA_JANELA;
  // O período vai escrito: "nenhuma" sem dizer onde fazia o agente afirmar que não havia peça em dezembro.
  const periodo = janela ? `de ${dataCurta(janela.de)} a ${dataCurta(somarDiasIso(janela.ate, -1))}` : null;
  const vazio = periodo ? `nenhuma ${periodo}.` : "nenhuma no período.";
  const total = Math.max(pecas.length, totalDePecas ?? 0);
  const corte = total > max ? `\n(Mostrando ${max} de ${total} peças${periodo ? ` ${periodo}` : ""}. Para as outras, a equipe pode pedir por mês.)` : "";
  const periodoNoBloco = periodo ? `\n(Peças com data ${periodo}.)` : "";
  return `${blocoDosAlvos("ROTEIROS DO CLIENTE", alvosDosRoteiros(roteiros), "nenhum ainda.")}${blocoDosAlvos("PEÇAS DE VÍDEO DA AGENDA", alvosDasPecas(pecas, max), vazio)}${periodoNoBloco}${corte}\n${regraDasAcoes(DESCRICOES_DOS_ROTEIROS)}`;
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
  // Mesmo conjunto do bloco: na janela estendida o agente vê até 120 peças (p1..p120).
  const alvos = [...alvosDosRoteiros(roteiros), ...alvosDasPecas(pecas, MAX_PECAS_NA_JANELA_ESTENDIDA)];
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

/**
 * O "Ir para" dos roteiros (dono, 27/09: "quando termina ele dá o caminho pra
 * mim apertar e ir e já fica tudo certinho"). Conta só o que deu certo (ou,
 * antes de fazer, o que foi pedido):
 * - um roteiro gerado: abre ele na etapa Roteiro;
 * - um roteiro mudado (gancho, tom, texto, aprovado, gravado): abre na Revisão,
 *   que mostra a versão nova ao lado da anterior (a prova do antes e depois);
 * - vários: a Revisão com a lista; só arquivados ou nada aberto: a Agenda.
 */
export function caminhoDosRoteiros(
  clientId: string,
  acao: Pick<AcaoDoAgente, "itens" | "resultados">,
  opcoes: { abrirSozinho?: boolean } = {},
): CaminhoDoAgente | null {
  const feitos = acao.resultados && acao.resultados.length ? acao.resultados.filter((r) => r.ok) : null;
  const ids: string[] = [];
  let gerado = false;
  for (const i of acao.itens) {
    if (i.operacao === "arquivar_roteiro") continue;
    const r = feitos ? feitos.find((x) => x.ref === i.ref && x.operacao === i.operacao) : null;
    if (feitos && !r) continue;
    const id = i.operacao === "gerar_roteiro" ? String((r && r.desfazer && r.desfazer.roteiro_id) || "") : i.alvo_id;
    if (i.operacao === "gerar_roteiro") gerado = true;
    if (id && ids.indexOf(id) < 0) ids.push(id);
  }
  const base = { clientId, abrirSozinho: opcoes.abrirSozinho };
  if (ids.length === 1) {
    return gerado
      ? caminhoNaArea("mesa_roteiros", { ...base, etapa: "roteiro", estado: { roteiro: ids[0] }, rotulo: "Abrir o roteiro" })
      : caminhoNaArea("mesa_roteiros", { ...base, etapa: "revisao", estado: { roteiro: ids[0] }, rotulo: "Ver o roteiro na Revisão" });
  }
  if (ids.length > 1) return caminhoNaArea("mesa_roteiros", { ...base, etapa: "revisao", rotulo: `Ver os ${ids.length} roteiros` });
  if (gerado) return caminhoNaArea("mesa_roteiros", { ...base, etapa: "agenda", rotulo: "Ver na Agenda de roteiros" });
  return caminhoNaArea("mesa_roteiros", { ...base, etapa: "agenda", rotulo: "Abrir a Mesa Roteiros" });
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
