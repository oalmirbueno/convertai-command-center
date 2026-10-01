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
import { lerBaseDoPara, modeloValidadoPorId, ROTULO_DO_OBJETIVO } from "./modulos/roteiros-validados.ts";
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
import { DESCRICOES_DE_EDICAO, idDoComentario, lerIdDoComentario, OPERACOES_DE_EDICAO, regrasDeEdicao } from "./acoes-de-edicao.ts";
// Frente AG2 (29/09): "esse roteiro", "a segunda peça", "todos da semana" (só o tipo; a chamada ao Jev fica no index).
import type { ItemReferivel } from "../_shared/conversa-das-mesas.ts";

// Frente AG (26/09): as de edição sem IA (editar_texto, aprovar_roteiro, marcar_gravado) moram em acoes-de-edicao.ts.
export const OPERACOES_DOS_ROTEIROS = ["refazer_gancho", "mudar_tom", "gerar_roteiro", "arquivar_roteiro", "gerar_pdf", ...OPERACOES_DE_EDICAO];
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

/** Comentário da equipe no roteiro aberto (alvo c1..cN do agente). */
export type ComentarioParaAcao = { roteiro_id: string; id: string; texto: string; autor: string | null; resolvido: boolean; bloco_id?: string | null };

/** Máximo de comentários que o agente vê (os mais novos, abertos primeiro). */
export const MAX_COMENTARIOS_PARA_O_AGENTE = 20;

export function alvosDosComentarios(comentarios: ComentarioParaAcao[]): Array<AlvoComApelido<AlvoDosRoteiros>> {
  return comApelido(
    comentarios.slice(0, MAX_COMENTARIOS_PARA_O_AGENTE).map((c) => ({
      id: idDoComentario(c.roteiro_id, c.id),
      titulo: umaLinha(c.texto, 140) || "comentário",
      detalhe: [c.resolvido ? "resolvido" : "aberto", c.autor ? `de ${c.autor}` : "", c.bloco_id ? `bloco ${c.bloco_id}` : ""].filter(Boolean).join(" · "),
      dados: { resolvido: c.resolvido },
    })),
    "c",
  );
}

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

/**
 * Frente ROT: o para do gerar_roteiro. Sem base, só o tipo (como antes);
 * com base pedida, "tipo@objetivo" ou "tipo@id_do_modelo". Base que não se
 * lê é ignorada (o código escolhe pelo contexto), tipo que não se lê recusa.
 */
export function paraDoGerar(bruto: unknown): string | null {
  const s = String(bruto == null ? "" : bruto);
  const i = s.indexOf("@");
  const tipo = tipoPedido(i >= 0 ? s.slice(0, i) : s);
  if (!tipo) return null;
  if (i < 0) return tipo;
  const base = lerBaseDoPara(`${tipo}@${s.slice(i + 1)}`);
  if (base.modeloId) return modeloValidadoPorId(base.modeloId) || /^[0-9a-f-]{36}$/i.test(base.modeloId) ? `${tipo}@${base.modeloId}` : tipo;
  return base.objetivo ? `${tipo}@${base.objetivo}` : tipo;
}

/** Como o cartão mostra o para do gerar_roteiro ("Fala para câmera · base: Autoridade"). */
export function rotuloDoGerar(para: string): string {
  const b = lerBaseDoPara(para);
  const tipo = modoDoTipo(b.tipo).rotulo;
  if (b.objetivo) return `${tipo} · base: ${ROTULO_DO_OBJETIVO[b.objetivo]}`;
  if (b.modeloId) {
    const m = modeloValidadoPorId(b.modeloId);
    return `${tipo} · base: ${m ? m.nome : "modelo próprio"}`;
  }
  return tipo;
}

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
      // Frente ROT: "tipo" ou "tipo@objetivo" / "tipo@modelo" (a base que a equipe pediu).
      para: (bruto) => paraDoGerar(bruto),
      trava: (alvo) => {
        const s = alvo.dados ? alvo.dados.roteiro_status : null;
        if (s === "aprovado" || s === "gravado") return "A peça já tem roteiro aprovado. Peça uma mudança no roteiro dela.";
        return null;
      },
    },
    arquivar_roteiro: {
      rotulo: "arquivar",
      alvos: ["r"],
      // Frente AG2: sem custo e com Desfazer (desarquivar): pedido claro vai direto.
      direta: true,
      trava: (alvo) => (alvo.dados && alvo.dados.arquivado === true ? "Já está arquivado." : null),
    },
    // Frente AG2: o PDF de gravação (o mesmo caminho do botão Compartilhar da etapa PDF). Sem IA, mas
    // sai da mesa: vai para Arquivos e pede a revisão da agência. Sempre com Confirmar e sem Desfazer.
    gerar_pdf: {
      rotulo: "gerar o PDF de",
      alvos: ["r"],
      trava: (alvo) => {
        const d = alvo.dados || {};
        if (d.arquivado === true) return "Roteiro arquivado. Desarquive antes.";
        if (d.status !== "aprovado" && d.status !== "gravado") return "Só roteiro aprovado vai para o PDF. Aprove antes.";
        return null;
      },
    },
    ...regrasDeEdicao(),
  };
}

export const DESCRICOES_DOS_ROTEIROS: Record<string, string> = {
  refazer_gancho: "três ganchos novos, de mecanismos diferentes, para o roteiro (ref r..). para: o que a equipe pediu (ex.: 'mais direto'), ou vazio.",
  mudar_tom: "reescreve as falas do roteiro (ref r..) no tom pedido, mantendo fatos, estrutura e tempos. para: o tom (ex.: 'mais leve e próximo').",
  gerar_roteiro: "gera o roteiro de uma peça de vídeo da agenda (ref p..), sempre seguindo um modelo da biblioteca Roteiros validados. para: fala_camera, tutorial, ugc ou cinema (vazio: fala_camera); com objetivo ou modelo pedido, junte com @ (fala_camera@autoridade, fala_camera@produto, fala_camera@presenca_de_marca, fala_camera@venda, fala_camera@conexao, fala_camera@engajamento ou fala_camera@id_do_modelo). Pedido de 'peças da semana' vale para as peças com data nos próximos 7 dias.",
  arquivar_roteiro: "arquiva o roteiro (ref r..). Dá para desarquivar. para vazio.",
  gerar_pdf: "gera UM PDF de gravação com os roteiros aprovados ou gravados pedidos (ref r.., um item por roteiro, até 12) e manda para Arquivos com a revisão da agência. Não aprova nada. para vazio.",
  ...DESCRICOES_DE_EDICAO,
};

/** Bloco do prompt com as listas (apelidos, nunca id) e a regra das ações. */
export function blocoDasAcoesDosRoteiros(
  roteiros: RoteiroParaAcao[],
  pecas: PecaParaAcao[],
  janela?: { de: string; ate: string; estendida: boolean },
  totalDePecas?: number,
  comentarios: ComentarioParaAcao[] = [],
): string {
  const max = janela && janela.estendida ? MAX_PECAS_NA_JANELA_ESTENDIDA : MAX_PECAS_NA_JANELA;
  // O período vai escrito: "nenhuma" sem dizer onde fazia o agente afirmar que não havia peça em dezembro.
  const periodo = janela ? `de ${dataCurta(janela.de)} a ${dataCurta(somarDiasIso(janela.ate, -1))}` : null;
  const vazio = periodo ? `nenhuma ${periodo}.` : "nenhuma no período.";
  const total = Math.max(pecas.length, totalDePecas ?? 0);
  const corte = total > max ? `\n(Mostrando ${max} de ${total} peças${periodo ? ` ${periodo}` : ""}. Para as outras, a equipe pode pedir por mês.)` : "";
  const periodoNoBloco = periodo ? `\n(Peças com data ${periodo}.)` : "";
  const blocoComentarios = comentarios.length ? blocoDosAlvos("COMENTÁRIOS DA EQUIPE NO ROTEIRO ABERTO", alvosDosComentarios(comentarios)) : "";
  return `${blocoDosAlvos("ROTEIROS DO CLIENTE", alvosDosRoteiros(roteiros), "nenhum ainda.")}${blocoDosAlvos("PEÇAS DE VÍDEO DA AGENDA", alvosDasPecas(pecas, max), vazio)}${periodoNoBloco}${corte}${blocoComentarios}\n${regraDasAcoes(DESCRICOES_DOS_ROTEIROS)}`;
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
  comentarios: ComentarioParaAcao[] = [],
): AcaoDoAgente | null {
  // Mesmo conjunto do bloco: na janela estendida o agente vê até 120 peças (p1..p120).
  const alvos = [...alvosDosRoteiros(roteiros), ...alvosDasPecas(pecas, MAX_PECAS_NA_JANELA_ESTENDIDA), ...alvosDosComentarios(comentarios)];
  const acao = normalizarAcaoDoAgente(bruto, alvos, regrasDosRoteiros(), {
    agente: "roteiros",
    id: id || `roteiros-${Date.now().toString(36)}`,
    contexto: { client_id: clientId },
    rotuloDoPara: (operacao, para) => {
      if (operacao === "gerar_roteiro" && typeof para === "string") return rotuloDoGerar(para);
      if (operacao === "refazer_gancho" && para === "sem pedido extra") return null;
      return null;
    },
  });
  if (!acao) return null;
  juntarPdfs(acao);
  // Só PDF: não há o que desfazer pelo cartão (o arquivo fica em Arquivos).
  if (acao.itens.length && acao.itens.every((i) => i.operacao === "gerar_pdf")) acao.sem_desfazer = true;
  const comIa = acao.itens.filter((i) => OPERACOES_COM_IA.indexOf(i.operacao) >= 0).length;
  acao.custo_estimado_usd = comIa ? Math.round(comIa * Math.max(0, custoPorGeracaoUsd) * 1e6) / 1e6 : 0;
  return acao;
}

/** Até quantos roteiros vão num PDF (o mesmo limite do pdf_compartilhar). */
export const MAX_ROTEIROS_NO_PDF = 12;

/**
 * Vários gerar_pdf viram UM item (um PDF só com todos, na ordem pedida): o
 * alvo leva os ids separados por vírgula e o cartão mostra os títulos. Acima
 * de 12, o resto vai para acima_do_teto (a tela avisa).
 */
export function juntarPdfs(acao: AcaoDoAgente): AcaoDoAgente {
  const pdfs = acao.itens.filter((i) => i.operacao === "gerar_pdf");
  if (!pdfs.length) return acao;
  const vao = pdfs.slice(0, MAX_ROTEIROS_NO_PDF);
  const fora = pdfs.length - vao.length;
  const primeiro = vao[0];
  const unico = {
    ...primeiro,
    alvo_id: vao.map((i) => i.alvo_id).join(","),
    titulo: vao.length === 1 ? primeiro.titulo : umaLinha(`${vao.length} roteiros: ${vao.map((i) => i.titulo).join("; ")}`, 200),
    detalhe: vao.length === 1 ? primeiro.detalhe : "um PDF só, na ordem pedida",
    para: null,
  };
  const idx = acao.itens.indexOf(primeiro);
  acao.itens = acao.itens.filter((i) => i.operacao !== "gerar_pdf");
  acao.itens.splice(Math.min(idx, acao.itens.length), 0, unico);
  if (fora) acao.acima_do_teto = (acao.acima_do_teto || 0) + fora;
  return acao;
}

/** Os ids de roteiro de um item gerar_pdf (os que não são UUID saem). */
export function idsDoPdf(alvoId: unknown): string[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(new Set(String(alvoId == null ? "" : alvoId).split(",").map((x) => x.trim()).filter((x) => uuid.test(x)))).slice(0, MAX_ROTEIROS_NO_PDF);
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
  let pdf = false;
  for (const i of acao.itens) {
    if (i.operacao === "arquivar_roteiro") continue;
    const r = feitos ? feitos.find((x) => x.ref === i.ref && x.operacao === i.operacao) : null;
    if (feitos && !r) continue;
    if (i.operacao === "gerar_pdf") {
      pdf = true;
      continue;
    }
    const comentario = i.operacao === "resolver_comentario" ? lerIdDoComentario(i.alvo_id) : null;
    const id = i.operacao === "gerar_roteiro" ? String((r && r.desfazer && r.desfazer.roteiro_id) || "") : comentario ? comentario.roteiroId : i.alvo_id;
    if (i.operacao === "gerar_roteiro") gerado = true;
    if (id && ids.indexOf(id) < 0) ids.push(id);
  }
  const base = { clientId, abrirSozinho: opcoes.abrirSozinho };
  if (pdf && !ids.length) return caminhoNaArea("mesa_roteiros", { ...base, etapa: "pdf", rotulo: "Ver o PDF" });
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

// ------------------------------------------------------------------ "esse roteiro", "a segunda", "todos da semana"

const semAcentoMin = (t: unknown) => String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * A lista que o Jev usa para resolver "essa", "a segunda", "todas" (frente
 * AG2), na ORDEM DA TELA e com os apelidos que o modelo vê:
 * - fala de comentário: os comentários do roteiro aberto (c..);
 * - fala de peça, agenda ou "gerar os da semana": as peças (p..), por data
 *   (como na Agenda); com "semana", só as dos próximos 7 dias;
 * - senão, os roteiros (r..) como a Revisão mostra (mais recentes primeiro,
 *   sem os arquivados, a não ser que o pedido fale deles); com "semana", só os
 *   de peça dos próximos 7 dias.
 * `selecionados` = o roteiro aberto na tela ("esse roteiro").
 */
export function itensDaReferencia(
  mensagem: string,
  roteirosNaTela: RoteiroParaAcao[],
  roteirosComApelido: RoteiroParaAcao[],
  pecas: PecaParaAcao[],
  hoje: string,
  abertoId: string | null,
  comentarios: ComentarioParaAcao[] = [],
): { itens: ItemReferivel[]; selecionados: string[]; lista: "roteiros" | "pecas" | "comentarios" } {
  const t = semAcentoMin(mensagem);
  const refDoRoteiro: Record<string, string> = {};
  alvosDosRoteiros(roteirosComApelido).forEach((a) => {
    refDoRoteiro[a.id] = a.ref;
  });
  const selecionados = abertoId && refDoRoteiro[abertoId] ? [refDoRoteiro[abertoId]] : [];
  const semana = /\bsemana\b/.test(t);
  if (/\bcomentari/.test(t) && comentarios.length) {
    return { itens: alvosDosComentarios(comentarios).map((a) => ({ ref: a.ref, titulo: a.titulo, detalhe: a.detalhe || null })), selecionados, lista: "comentarios" };
  }
  if (/\b(pecas?|agenda|posts?|publicac)/.test(t) || (semana && /\b(ger[ae]|escrev|cri[ae]|faca|fazer|monte)/.test(t))) {
    const refDaPeca: Record<string, string> = {};
    alvosDasPecas(pecas, MAX_PECAS_NA_JANELA_ESTENDIDA).forEach((a) => {
      refDaPeca[a.id] = a.ref;
    });
    const lista = semana ? pecasDaSemana(pecas, hoje) : pecas;
    const itens = alvosDasPecas(lista, MAX_PECAS_NA_JANELA_ESTENDIDA)
      .filter((a) => !!refDaPeca[a.id])
      .map((a) => ({ ref: refDaPeca[a.id], titulo: a.titulo, detalhe: a.detalhe || null }));
    return { itens, selecionados: [], lista: "pecas" };
  }
  const comArquivados = /arquivad/.test(t);
  let lista = roteirosNaTela.filter((r) => comArquivados || !r.arquivado);
  if (semana) lista = lista.filter((r) => !!r.data_da_peca && pecasDaSemana([{ data: r.data_da_peca }], hoje).length > 0);
  const itens = alvosDosRoteiros(lista)
    .filter((a) => !!refDoRoteiro[a.id])
    .map((a) => ({ ref: refDoRoteiro[a.id], titulo: a.titulo, detalhe: a.detalhe || null }));
  return { itens, selecionados, lista: "roteiros" };
}

/** A resposta promete fazer sem trazer a lista? ("vou gerar", "vou preparar"...). */
export function respostaPromete(resposta: unknown): boolean {
  return /\b(vou|irei|vamos) (j[aá] )?(gerar|preparar|fazer|criar|escrever|refazer|mudar|trocar|aprovar|arquivar|montar|ajustar|resolver|marcar)\b/i.test(String(resposta == null ? "" : resposta));
}
