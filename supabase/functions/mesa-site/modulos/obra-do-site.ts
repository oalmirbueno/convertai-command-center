/**
 * A obra do site (Gravyx, 19/10/2026): as regras puras que o worker do motor,
 * as funções (mesa-site e motor-codigo) e a tela dividem.
 *
 * - Fases do trabalho: entendendo o pedido, escrevendo, compilando,
 *   conferindo, pronto. O worker marca a fase no evento (`dados.fase`); o
 *   evento antigo, sem marca, cai na leitura pelo texto.
 * - Rascunho x versão salva: o motor escreve num rascunho (ramo "rascunho"
 *   no git do worker); a prévia mostra o rascunho; Salvar leva à versão
 *   salva (ramo "main") e Descartar volta a ela. A versão guarda a origem
 *   (edição, importação, restauração), os modelos e de qual veio.
 * - Conferência no navegador (computador 1440x900 e celular 390x844): erro de
 *   execução, imagem quebrada, conteúdo vazando para o lado e texto cortado.
 *   Problema grave trava o Publicar até a equipe marcar "publicar mesmo
 *   assim". A correção é UMA passada pedida no botão, nunca em laço (regra do
 *   dono "sem laço de correção").
 * - Gerar e publicar nunca no mesmo turno: publicar junto subiria a versão
 *   anterior.
 *
 * Puro: sem Deno, sem npm e sem banco. Sem lookbehind, \p{} ou grupo nomeado
 * (a tela importa este arquivo).
 */

import type { TrabalhoDoMotor } from "../../_shared/motor-codigo.ts";

type TrabalhoLido = Pick<TrabalhoDoMotor, "id" | "tipo" | "estado" | "resultado" | "commit" | "criado_em" | "terminado_em" | "modelo" | "instrucao">;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const ABERTOS = ["na_fila", "executando", "parando"];
const aberto = (t: Pick<TrabalhoDoMotor, "estado">) => ABERTOS.indexOf(t.estado) >= 0;

// ------------------------------------------------------------------ fases

export const FASES = ["entendendo", "escrevendo", "compilando", "conferindo", "pronto"] as const;
export type Fase = (typeof FASES)[number];

export const ROTULO_DA_FASE: Record<Fase, string> = {
  entendendo: "Entendendo o pedido",
  escrevendo: "Escrevendo",
  compilando: "Compilando",
  conferindo: "Conferindo",
  pronto: "Pronto",
};

/** Os tipos que passam pelas fases (o zip, o conteúdo e o publicar são outra conversa). */
export const TIPOS_COM_FASES = ["construir", "ajustar", "corrigir", "textos", "desfazer", "revisar", "salvar", "descartar"];

export const ehFase = (v: unknown): v is Fase => typeof v === "string" && (FASES as readonly string[]).indexOf(v) >= 0;

export type EventoDaFase = { tipo: string; resumo: string; dados?: Record<string, unknown> | null };

/** A fase que o evento marca (null: o evento não muda a fase). */
export function faseDoEvento(ev: EventoDaFase): Fase | null {
  const marcada = ev && ev.dados ? ev.dados.fase : null;
  if (ehFase(marcada)) return marcada;
  if (!ev) return null;
  if (ev.tipo === "fim") return "pronto";
  const r = String(ev.resumo || "");
  if (ev.tipo === "arquivo" || ev.tipo === "comando") return "escrevendo";
  if (/^(Construindo|Ajustando|Corrigindo|Trocando) /.test(r)) return "escrevendo";
  if (/build|compil|tipos/i.test(r)) return "compilando";
  if (/^(Revis[aã]o|UX|Confer)/.test(r)) return "conferindo";
  return null;
}

export type PassoDaFase = { id: Fase; rotulo: string; estado: "feita" | "agora" | "falta" | "parou" };
export type FasesDoTrabalho = { atual: Fase; naFila: boolean; terminou: boolean; parou: boolean; passos: PassoDaFase[] };

/** As fases de um trabalho a partir dos eventos (do mais velho ao mais novo). */
export function fasesDoTrabalho(t: Pick<TrabalhoDoMotor, "estado">, eventos: EventoDaFase[]): FasesDoTrabalho {
  let atual: Fase = "entendendo";
  for (const ev of eventos || []) {
    const f = faseDoEvento(ev);
    if (f) atual = f;
  }
  const feito = t.estado === "feito";
  const parou = t.estado === "falhou" || t.estado === "parado" || t.estado === "cancelado";
  if (feito) atual = "pronto";
  if (parou && atual === "pronto") atual = "conferindo";
  const i = FASES.indexOf(atual);
  const passos: PassoDaFase[] = FASES.map((id, n) => ({
    id,
    rotulo: ROTULO_DA_FASE[id],
    estado: feito ? "feita" : n < i ? "feita" : n === i ? (parou ? "parou" : "agora") : "falta",
  }));
  return { atual, naFila: t.estado === "na_fila", terminou: feito || parou, parou, passos };
}

// ------------------------------------------------------------------ rascunho x versão salva

/** Os trabalhos que escrevem no rascunho (abrem um se não houver). */
export const TIPOS_DO_RASCUNHO = ["construir", "ajustar", "corrigir", "textos", "desfazer"];
/** Os que mexem no rascunho ou na versão salva: com um deles aberto, o rascunho está "em andamento". */
const TIPOS_QUE_MEXEM = TIPOS_DO_RASCUNHO.concat(["salvar", "descartar"]);

export type EstadoDoRascunho = {
  /** Há um rascunho com trocas ainda não salvas (ou um trabalho escrevendo nele). */
  aberto: boolean;
  /** O motor ainda está mexendo (na fila ou rodando): Salvar e Descartar esperam. */
  emAndamento: boolean;
  /** Os trabalhos do rascunho, do mais novo ao mais velho. */
  trabalhos: TrabalhoLido[];
  /** O commit da versão salva de onde o rascunho saiu. */
  base: string | null;
};

const ramoDe = (t: TrabalhoLido) => {
  const r = obj(t.resultado).ramo;
  return r === "rascunho" || r === "main" ? r : null;
};

/** O estado do rascunho pela lista de trabalhos do site (mais novo primeiro). */
export function estadoDoRascunho(trabalhos: TrabalhoLido[]): EstadoDoRascunho {
  const emAndamento = trabalhos.some((t) => aberto(t) && TIPOS_QUE_MEXEM.indexOf(t.tipo) >= 0);
  const doRascunho: TrabalhoLido[] = [];
  let abertoPeloRamo = false;
  let base: string | null = null;
  let achouRamo = false;
  for (const t of trabalhos) {
    if (aberto(t)) {
      if (TIPOS_DO_RASCUNHO.indexOf(t.tipo) >= 0) doRascunho.push(t);
      continue;
    }
    const ramo = ramoDe(t);
    if (!ramo) continue;
    if (!achouRamo) {
      achouRamo = true;
      abertoPeloRamo = ramo === "rascunho";
    }
    if (ramo !== "rascunho") break;
    if (TIPOS_DO_RASCUNHO.indexOf(t.tipo) >= 0) doRascunho.push(t);
    const b = obj(obj(t.resultado).rascunho).base;
    if (typeof b === "string" && b) base = b;
  }
  const algumAbertoNoRascunho = trabalhos.some((t) => aberto(t) && TIPOS_DO_RASCUNHO.indexOf(t.tipo) >= 0);
  return { aberto: abertoPeloRamo || algumAbertoNoRascunho, emAndamento, trabalhos: doRascunho, base };
}

/** Salvar e Descartar: só com rascunho aberto e o motor parado nele. */
export function podeMexerNoRascunho(e: EstadoDoRascunho): { ok: boolean; motivo: string | null } {
  if (!e.aberto) return { ok: false, motivo: "Não há rascunho: as trocas já estão na versão salva." };
  if (e.emAndamento) return { ok: false, motivo: "O motor ainda está mexendo no rascunho. Espere terminar (ou pare o trabalho)." };
  return { ok: true, motivo: null };
}

export const ORIGENS_DA_VERSAO = ["edicao", "importacao", "restauracao"] as const;
export type OrigemDaVersao = (typeof ORIGENS_DA_VERSAO)[number];
export const ROTULO_DA_ORIGEM: Record<OrigemDaVersao, string> = { edicao: "Edição", importacao: "Importação", restauracao: "Restauração" };

/** O que o worker guarda do rascunho (fora do git do site, em .git/aceleriq-rascunho.json). */
export type RegistroDoRascunho = { base: string | null; aberto_em: string; trabalhos: Array<{ id: string; tipo: string; modelo: string | null; origem: OrigemDaVersao }> };

/** A versão que o Salvar grava: origem, modelos e de qual versão veio. */
export function versaoDoRascunho(r: RegistroDoRascunho | null, commit: string, agora: string): VersaoSalva {
  const ts = r ? r.trabalhos : [];
  const origens = ts.map((x) => x.origem);
  const origem: OrigemDaVersao = origens.length && origens.every((o) => o === "restauracao") ? "restauracao" : origens.indexOf("importacao") >= 0 ? "importacao" : "edicao";
  const modelos = ts.map((x) => x.modelo).filter((m): m is string => !!m).filter((m, i, l) => l.indexOf(m) === i);
  return { commit, de: r ? r.base : null, origem, modelos, trabalhos: ts.map((x) => x.id), em: agora };
}

export type VersaoSalva = { commit: string; de: string | null; origem: OrigemDaVersao; modelos: string[]; trabalhos: string[]; em: string };

/** As versões salvas (trabalhos "salvar" feitos), da mais nova à mais velha. */
export function versoesSalvas(trabalhos: TrabalhoLido[]): Array<VersaoSalva & { trabalho_id: string }> {
  const saida: Array<VersaoSalva & { trabalho_id: string }> = [];
  for (const t of trabalhos) {
    if (t.tipo !== "salvar" || t.estado !== "feito") continue;
    const v = obj(obj(t.resultado).versao);
    if (typeof v.commit !== "string" || !v.commit) continue;
    const origem = (ORIGENS_DA_VERSAO as readonly string[]).indexOf(String(v.origem)) >= 0 ? (v.origem as OrigemDaVersao) : "edicao";
    saida.push({
      trabalho_id: t.id,
      commit: v.commit,
      de: typeof v.de === "string" ? v.de : null,
      origem,
      modelos: lista(v.modelos).map((m) => umaLinha(m, 80)).filter(Boolean),
      trabalhos: lista(v.trabalhos).map((x) => String(x)),
      em: typeof v.em === "string" ? v.em : t.terminado_em || t.criado_em,
    });
  }
  return saida;
}

// ------------------------------------------------------------------ conferência no navegador

export const APARELHOS_DA_CONFERENCIA = [
  { id: "computador" as const, largura: 1440, altura: 900 },
  { id: "celular" as const, largura: 390, altura: 844 },
];
export type AparelhoDaConferencia = "computador" | "celular";

export type TipoDaConferencia = "execucao" | "imagem" | "vazando" | "cortado" | "tipos" | "pagina";

export const ROTULO_DA_CONFERENCIA: Record<TipoDaConferencia, string> = {
  execucao: "Erro de execução",
  imagem: "Imagem quebrada",
  vazando: "Conteúdo vazando para o lado",
  cortado: "Texto cortado",
  tipos: "Erro de tipo no código",
  pagina: "Página que não abriu",
};

export type ProblemaDaConferencia = {
  tipo: TipoDaConferencia;
  grave: boolean;
  texto: string;
  aparelho: AparelhoDaConferencia | null;
  pagina: string | null;
  caminho: string | null;
  secao: string | null;
};

export type ConferenciaDoSite = {
  estado: "pronto" | "sem_ambiente" | "erro";
  motivo: string | null;
  em: string;
  paginas: string[];
  problemas: ProblemaDaConferencia[];
  graves: number;
  /** A capa do site (print do computador), no Storage. */
  capa: { bucket: string; path: string } | null;
};

/** O que a conferência NÃO olha (o texto honesto do resultado). */
export const NAO_VERIFICADO = "Formulários, serviços externos e a qualidade estética não foram verificados.";

/** O que o script da página mede (o worker roda no Chromium; a regra de grave fica aqui). */
export type MedicaoDaPagina = {
  carregou: boolean;
  status: number | null;
  largura_da_tela: number;
  largura_da_pagina: number;
  vazando: Array<{ caminho: string | null; secao: string | null; texto: string; direita: number }>;
  imagens: Array<{ src: string; caminho: string | null; secao: string | null }>;
  cortados: Array<{ caminho: string | null; secao: string | null; texto: string }>;
  erros: string[];
};

/** Erro de console que não é do site (ruído do navegador). */
export const erroDeRuido = (msg: string) => /favicon|DevTools|third-party cookie|Download the React|Failed to load resource/i.test(msg);

const curto = (s: string, max = 70) => {
  const t = umaLinha(s, 400);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A medição de uma página num aparelho vira a lista de problemas. */
export function problemasDaMedicao(m: MedicaoDaPagina, aparelho: AparelhoDaConferencia, pagina: string): ProblemaDaConferencia[] {
  const saida: ProblemaDaConferencia[] = [];
  const base = { aparelho, pagina };
  const onde = aparelho === "celular" ? "no celular" : "no computador";
  if (!m.carregou || (m.status !== null && m.status >= 400)) {
    saida.push({ ...base, tipo: "pagina", grave: true, texto: `A página ${pagina} não abriu ${onde}${m.status ? ` (resposta ${m.status})` : ""}.`, caminho: null, secao: null });
    return saida;
  }
  const erros = (m.erros || []).map((e) => umaLinha(e, 300)).filter((e) => e && !erroDeRuido(e)).filter((e, i, l) => l.indexOf(e) === i);
  for (const e of erros.slice(0, 3)) saida.push({ ...base, tipo: "execucao", grave: true, texto: `Erro de execução: ${curto(e, 160)}`, caminho: null, secao: null });
  for (const i of (m.imagens || []).slice(0, 4)) {
    const nome = String(i.src || "").split("?")[0].split("/").pop() || "imagem";
    saida.push({ ...base, tipo: "imagem", grave: true, texto: `A imagem ${curto(nome, 50)} não carregou ${onde}.`, caminho: i.caminho, secao: i.secao });
  }
  const sobra = Math.round(m.largura_da_pagina - m.largura_da_tela);
  if (sobra > 1) {
    const culpados = (m.vazando || []).slice(0, 3);
    if (!culpados.length) saida.push({ ...base, tipo: "vazando", grave: true, texto: `A página fica ${sobra}px mais larga que a tela ${onde} (rolagem para o lado).`, caminho: null, secao: null });
    for (const v of culpados) {
      saida.push({ ...base, tipo: "vazando", grave: true, texto: `${v.texto ? `"${curto(v.texto, 50)}"` : "Um elemento"} passa ${Math.max(1, Math.round(v.direita - m.largura_da_tela))}px da borda ${onde}.`, caminho: v.caminho, secao: v.secao });
    }
  }
  for (const c of (m.cortados || []).slice(0, 4)) saida.push({ ...base, tipo: "cortado", grave: false, texto: `Texto cortado ${onde}: "${curto(c.texto, 60)}".`, caminho: c.caminho, secao: c.secao });
  return saida;
}

/** Junta as listas (graves primeiro, sem repetir o mesmo ponto no mesmo aparelho), no máximo 30. */
export function juntarProblemas(listas: ProblemaDaConferencia[][]): ProblemaDaConferencia[] {
  const vistos: string[] = [];
  const todos: ProblemaDaConferencia[] = [];
  for (const l of listas) {
    for (const p of l) {
      // O mesmo erro de execução nos dois aparelhos é um problema só.
      const chave = `${p.tipo}|${p.tipo === "execucao" ? "" : p.aparelho || ""}|${p.pagina || ""}|${p.caminho || p.texto}`;
      if (vistos.indexOf(chave) >= 0) continue;
      vistos.push(chave);
      todos.push(p);
    }
  }
  return todos.filter((p) => p.grave).concat(todos.filter((p) => !p.grave)).slice(0, 30);
}

/** Lê a conferência gravada no resultado do trabalho sem confiar em nada. */
export function lerConferencia(v: unknown): ConferenciaDoSite | null {
  const o = obj(v);
  if (o.estado !== "pronto" && o.estado !== "sem_ambiente" && o.estado !== "erro") return null;
  const problemas = lista(o.problemas)
    .map(obj)
    .filter((p) => typeof p.tipo === "string" && typeof p.texto === "string" && Object.prototype.hasOwnProperty.call(ROTULO_DA_CONFERENCIA, String(p.tipo)))
    .map((p) => ({
      tipo: p.tipo as TipoDaConferencia,
      grave: p.grave === true,
      texto: umaLinha(p.texto, 300),
      aparelho: p.aparelho === "celular" || p.aparelho === "computador" ? (p.aparelho as AparelhoDaConferencia) : null,
      pagina: typeof p.pagina === "string" ? umaLinha(p.pagina, 120) : null,
      caminho: typeof p.caminho === "string" ? p.caminho : null,
      secao: typeof p.secao === "string" ? p.secao : null,
    }))
    .slice(0, 30);
  const capa = obj(o.capa);
  return {
    estado: o.estado,
    motivo: typeof o.motivo === "string" ? umaLinha(o.motivo, 300) : null,
    em: String(o.em || ""),
    paginas: lista(o.paginas).map((x) => umaLinha(x, 120)).filter(Boolean).slice(0, 12),
    problemas,
    graves: problemas.filter((p) => p.grave).length,
    capa: typeof capa.bucket === "string" && typeof capa.path === "string" ? { bucket: capa.bucket, path: capa.path } : null,
  };
}

/**
 * Os trabalhos que compilam o site e conferem no fim (a conferência sai deles).
 * O publicar compila a versão salva sem mudar o código: a conferência que
 * vale continua a de antes dele.
 */
export const TIPOS_QUE_CONFEREM = ["construir", "ajustar", "corrigir", "textos", "desfazer", "revisar", "salvar", "descartar"];

/**
 * A conferência que vale agora: a do último trabalho terminado que compilou o
 * site (o código mudou depois de uma conferência sem outra = nenhuma vale).
 */
export function conferenciaAtual(trabalhos: TrabalhoLido[]): { trabalho: TrabalhoLido; conferencia: ConferenciaDoSite } | null {
  for (const t of trabalhos) {
    if (aberto(t) || TIPOS_QUE_CONFEREM.indexOf(t.tipo) < 0) continue;
    const r = obj(t.resultado);
    if (!r.build) continue;
    const c = lerConferencia(r.conferencia);
    return c ? { trabalho: t, conferencia: c } : null;
  }
  return null;
}

// ------------------------------------------------------------------ publicar

export const MOTIVO_GERAR_E_PUBLICAR = "Gerar e publicar na mesma resposta subiria a versão anterior. Publique num pedido à parte, depois que o trabalho terminar e a versão for salva.";

export type TravaDaPublicacao = { ok: boolean; codigo: string | null; motivo: string | null; graves: number };

/**
 * Pode publicar agora? Nada gerando (publicar junto subiria a versão
 * anterior), nenhum rascunho sem salvar (o que sobe é a versão salva) e a
 * conferência sem problema grave, a não ser com "publicar mesmo assim".
 */
export function travaDaPublicacao(trabalhos: TrabalhoLido[], op: { mesmoAssim?: boolean } = {}): TravaDaPublicacao {
  if (trabalhos.some((t) => aberto(t) && TIPOS_QUE_MEXEM.indexOf(t.tipo) >= 0)) {
    return { ok: false, codigo: "geracao_em_andamento", motivo: `O motor ainda está mexendo no site. ${MOTIVO_GERAR_E_PUBLICAR}`, graves: 0 };
  }
  const r = estadoDoRascunho(trabalhos);
  if (r.aberto) return { ok: false, codigo: "rascunho_aberto", motivo: "Há um rascunho não salvo. Salve a versão (ou descarte o rascunho) antes de publicar: o que sobe é a versão salva.", graves: 0 };
  const c = conferenciaAtual(trabalhos);
  const graves = c ? c.conferencia.graves : 0;
  if (graves > 0 && op.mesmoAssim !== true) {
    return { ok: false, codigo: "conferencia_com_problemas", motivo: `A conferência no navegador achou ${graves} ${graves === 1 ? "problema grave" : "problemas graves"}. Corrija ou marque "publicar mesmo assim".`, graves };
  }
  return { ok: true, codigo: null, motivo: null, graves };
}

/** As operações do diretor de site que geram ou mudam o site (publicar nunca vai junto delas). */
export const OPERACOES_QUE_GERAM = [
  "construir_secao", "ajustar_secao", "trocar_secao", "gerar_conteudo", "gerar_imagem", "gerar_imagens_dos_slots",
  "montar_mapa", "adicionar_secao", "remover_secao", "escolher_copy", "escolher_preset", "desfazer_trabalho",
];

/** Separa o publicar quando vem junto de uma geração na mesma resposta (o publicar é recusado). */
export function separarPublicarDaGeracao<T extends { operacao: string }>(itens: T[]): { itens: T[]; recusados: T[] } {
  const gera = itens.some((i) => OPERACOES_QUE_GERAM.indexOf(i.operacao) >= 0);
  if (!gera) return { itens, recusados: [] };
  return { itens: itens.filter((i) => i.operacao !== "publicar_site"), recusados: itens.filter((i) => i.operacao === "publicar_site") };
}

// ------------------------------------------------------------------ correção (uma rodada)

export const MAX_PROBLEMAS_NA_CORRECAO = 12;

/**
 * Pode pedir a correção desta conferência? Uma vez só por conferência, nunca
 * de uma conferência que já veio de uma correção (sem laço), nunca com o
 * motor mexendo no site.
 */
export function podeCorrigir(trabalhos: TrabalhoLido[], conferenciaDe: string): { ok: boolean; motivo: string | null; problemas: ProblemaDaConferencia[] } {
  const t = trabalhos.find((x) => x.id === conferenciaDe);
  const c = t ? lerConferencia(obj(t.resultado).conferencia) : null;
  if (!t || !c) return { ok: false, motivo: "Essa conferência não foi achada neste site.", problemas: [] };
  if (!c.problemas.length) return { ok: false, motivo: "A conferência não achou nada para corrigir.", problemas: [] };
  if (t.tipo === "corrigir") return { ok: false, motivo: "Esta conferência já é a de uma correção. Outra rodada automática não entra: peça o ajuste pontual ao diretor de site.", problemas: [] };
  if (trabalhos.some((x) => x.tipo === "corrigir" && x.estado !== "cancelado" && obj(x.resultado).conferencia_de === conferenciaDe)) {
    return { ok: false, motivo: "A correção desta conferência já foi pedida uma vez. A próxima decisão é da equipe.", problemas: [] };
  }
  if (trabalhos.some((x) => aberto(x) && TIPOS_QUE_MEXEM.indexOf(x.tipo) >= 0)) return { ok: false, motivo: "O motor ainda está mexendo no site. Peça a correção quando ele terminar.", problemas: [] };
  const graves = c.problemas.filter((p) => p.grave);
  const outros = c.problemas.filter((p) => !p.grave);
  return { ok: true, motivo: null, problemas: graves.concat(outros).slice(0, MAX_PROBLEMAS_NA_CORRECAO) };
}

/** A instrução da correção (vai para o trabalho e para o agente). */
export function instrucaoDaCorrecao(problemas: ProblemaDaConferencia[]): string {
  const linhas = problemas.slice(0, MAX_PROBLEMAS_NA_CORRECAO).map((p, i) => {
    const onde = [p.pagina ? `página ${p.pagina}` : "", p.secao ? `seção ${p.secao}` : "", p.caminho ? `elemento ${p.caminho}` : ""].filter(Boolean).join(", ");
    return `${i + 1}. [${ROTULO_DA_CONFERENCIA[p.tipo]}${p.grave ? ", grave" : ""}] ${p.texto}${onde ? ` (${onde})` : ""}`;
  });
  return `Corrigir o que a conferência no navegador achou:\n${linhas.join("\n")}`.slice(0, 3900);
}

/** O pedido ao agente na passada de correção (o worker manda; uma passada só). */
export function promptDaCorrecao(problemas: ProblemaDaConferencia[], cliente: string): string {
  return [
    `CORREÇÃO DO SITE de ${cliente || "o cliente"}: uma passada só, sobre o que a conferência no navegador achou (computador 1440x900 e celular 390x844).`,
    instrucaoDaCorrecao(problemas),
    "Corrija só esses pontos, na seção onde cada um aparece. Não redesenhe, não troque texto nem imagem que não esteja na lista e não mexa na casca da casa.",
    "Conteúdo vazando: largura máxima de 100%, min-w-0 nos filhos de flex e grid, quebra de palavra longa. Texto cortado: tire a altura fixa ou o corte, ou deixe o texto quebrar. Imagem quebrada: use só arquivos que existem em public/. Erro de execução e de tipo: conserte o código que o causa.",
    "Ao terminar, rode `npm run checar`. Se algo da lista não tiver conserto seguro, diga na resposta e deixe como está.",
  ].join("\n\n");
}
