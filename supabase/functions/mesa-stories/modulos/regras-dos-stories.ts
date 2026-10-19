/**
 * Regras puras dos Stories da Mesa (20/10/2026). Contrato: docs/mesa/STORIES.md.
 *
 * - caminho pelo adesivo: tem adesivo = pelo app (a API do Instagram não publica
 *   adesivo); sem adesivo = automático (o motor do painel publica no horário);
 * - ordem da sequência, texto curto na tela e o roteiro exato do adesivo;
 * - sem repetição: o plano novo é comparado com as sequências dos últimos 7 dias
 *   (moldes e ganchos usados) e a regra dá os pontos de cada versão (o Jev soma
 *   novidade e clareza quando responde);
 * - horários da sequência no dia e o aviso 5 minutos antes (pelo app);
 * - o agendamento automático (payload de save_editorial_post) com as
 *   dependências injetadas: a função liga no banco, os testes Deno em fakes.
 *
 * Sem Deno e sem banco aqui. Sem travessão.
 */

import { FUSO_PADRAO, localParaIso, problemaNoHorario, uuidEstavel } from "../../estudio-arte/modulos/entrega-na-agenda.ts";
import { ARCO_DA_NOVELA, moldePorChave, OBJETIVOS, type Objetivo, TIPOS_DE_ADESIVO, type TipoDoAdesivo } from "./moldes-de-stories.ts";

// ------------------------------------------------------------------ tipos

export type Adesivo = { tipo: TipoDoAdesivo; pergunta?: string; opcoes?: string[]; url?: string; texto_do_link?: string; quando?: string };
export type Fundo = { tipo: "foto" | "cor"; imagem_id?: string; cor?: string };
export type Caminho = "automatico" | "pelo_app";
export type Situacao = "rascunho" | "arte_pronta" | "agendado" | "postar_pelo_app" | "publicado" | "falhou";
export const SITUACOES: readonly Situacao[] = ["rascunho", "arte_pronta", "agendado", "postar_pelo_app", "publicado", "falhou"];

export type Story = {
  id: string;
  sequencia_id: string | null;
  client_id: string;
  ordem: number;
  molde: string;
  titulo: string;
  texto_na_tela: string;
  adesivo: Adesivo;
  fundo: Fundo;
  horario: string | null;
  caminho: Caminho;
  destaque_id: string | null;
  file_id: string | null;
  editorial_post_id: string | null;
  publicacao_id: string | null;
  situacao: Situacao;
  roteiro_do_adesivo: string | null;
  motivo: string | null;
  aviso_em?: string | null;
  avisado_em?: string | null;
  criado_em?: string;
  atualizado_em?: string;
};

/** O story antes de ir ao banco (o que o agente devolve e o que adaptar_molde mostra). */
export type StoryRascunho = Pick<Story, "ordem" | "molde" | "titulo" | "texto_na_tela" | "adesivo" | "fundo" | "horario" | "caminho" | "roteiro_do_adesivo"> & { papel: string };

export type PlanoDaSequencia = { titulo: string; gancho_de_amanha: string; stories: StoryRascunho[] };

/** Sequência dos últimos 7 dias, do jeito que a regra de repetição precisa. */
export type SequenciaRecente = {
  data: string;
  titulo: string;
  gancho_de_amanha: string | null;
  stories: Array<{ ordem: number; molde: string; texto_na_tela: string }>;
};

// ------------------------------------------------------------------ limites

export const MIN_STORIES = 3;
export const MAX_STORIES = 8;
/** Texto na tela: até 2 linhas curtas. Acima disso a regra tira pontos (e a tela avisa). */
export const TEXTO_CURTO = 90;
export const MAX_TEXTO_NA_TELA = 400;
/** Pelo app: a equipe recebe o aviso 5 minutos antes do horário. */
export const AVISO_ANTES_MIN = 5;
/** Janela da sequência no dia (horário de Brasília). */
export const INICIO_DO_DIA = "09:00";
export const FIM_DO_DIA = "21:00";
export const DIAS_SEM_REPETIR = 7;

// ------------------------------------------------------------------ limpeza

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COR = /^#[0-9a-f]{6}$/i;

export function limpar(v: unknown, max: number): string {
  return (v == null ? "" : String(v)).replace(/[\u2013\u2014]/g, ",").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

export function ehObjetivo(v: unknown): v is Objetivo {
  return typeof v === "string" && (OBJETIVOS as readonly string[]).indexOf(v) >= 0;
}

export function quantidadeValida(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.min(MAX_STORIES, Math.max(MIN_STORIES, n));
}

export function tipoDoAdesivo(v: unknown): TipoDoAdesivo {
  return typeof v === "string" && (TIPOS_DE_ADESIVO as readonly string[]).indexOf(v) >= 0 ? v as TipoDoAdesivo : "nenhum";
}

/** O adesivo só com os campos que o tipo usa (vazios saem). */
export function adesivoLimpo(v: unknown): Adesivo {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const tipo = tipoDoAdesivo(o.tipo);
  if (tipo === "nenhum") return { tipo };
  const a: Adesivo = { tipo };
  const pergunta = limpar(o.pergunta, 120);
  if (pergunta) a.pergunta = pergunta;
  if (tipo === "enquete" || tipo === "quiz") {
    const opcoes = (Array.isArray(o.opcoes) ? o.opcoes : []).map((x) => limpar(x, 40)).filter(Boolean).slice(0, 4);
    if (opcoes.length) a.opcoes = opcoes;
  }
  if (tipo === "link") {
    const url = limpar(o.url, 500);
    if (/^https:\/\/\S+$/i.test(url)) a.url = url;
    const t = limpar(o.texto_do_link, 40);
    if (t) a.texto_do_link = t;
  }
  if (tipo === "contagem") {
    const q = limpar(o.quando, 40);
    if (q) a.quando = q;
  }
  return a;
}

export function fundoLimpo(v: unknown): Fundo {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : { tipo: v };
  if (o.tipo === "foto") {
    const f: Fundo = { tipo: "foto" };
    if (typeof o.imagem_id === "string" && UUID.test(o.imagem_id)) f.imagem_id = o.imagem_id;
    return f;
  }
  const f: Fundo = { tipo: "cor" };
  if (typeof o.cor === "string" && COR.test(o.cor)) f.cor = o.cor.toLowerCase();
  return f;
}

/** Tem adesivo = pelo app; sem adesivo = automático. O banco cobra a mesma regra (CHECK). */
export function caminhoDoAdesivo(adesivo: Pick<Adesivo, "tipo"> | null | undefined): Caminho {
  return adesivo && adesivo.tipo !== "nenhum" ? "pelo_app" : "automatico";
}

/** O que a equipe põe no app, em uma frase exata. Null sem adesivo. */
export function roteiroDoAdesivo(a: Adesivo | null | undefined): string | null {
  if (!a || a.tipo === "nenhum") return null;
  const p = a.pergunta ? `"${a.pergunta}"` : "";
  const ops = a.opcoes && a.opcoes.length ? ` com as opções ${a.opcoes.join(" | ")}` : "";
  let frase: string;
  switch (a.tipo) {
    case "enquete":
      frase = `Enquete ${p || "(escreva a pergunta)"}${ops}`;
      break;
    case "quiz":
      frase = `Quiz ${p || "(escreva a pergunta)"}${ops}${ops ? " (a primeira é a certa)" : ""}`;
      break;
    case "caixinha":
      frase = `Caixinha de perguntas ${p || "\"Me pergunte\""}`;
      break;
    case "link":
      frase = `Link ${a.url || "(cole o link)"} com o texto "${a.texto_do_link || "Saiba mais"}"`;
      break;
    case "contagem":
      frase = `Contagem regressiva ${p || "(nome do evento)"}${a.quando ? ` até ${a.quando}` : ""}, com lembrete ligado`;
      break;
    case "localizacao":
      frase = `Localização ${p || "(marque o lugar)"}`;
      break;
    case "reacao":
      frase = `Reação (emoji deslizante) ${p || "(escreva a pergunta)"}`;
      break;
    case "mencao":
      frase = `Menção ${p || "(marque o perfil)"}`;
      break;
    default:
      return null;
  }
  return `${frase}. Coloque no meio de baixo: a arte deixa essa área livre.`;
}

/** Um story do agente (ou da tela) limpo, com o caminho calculado pelo adesivo. */
export function rascunhoLimpo(v: unknown, ordem: number): StoryRascunho {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const molde = typeof o.molde === "string" && moldePorChave(o.molde) ? o.molde : "livre";
  const adesivo = adesivoLimpo(o.adesivo);
  const papel = typeof o.papel === "string" && (ARCO_DA_NOVELA as readonly string[]).indexOf(o.papel) >= 0 ? o.papel : "desenvolvimento";
  const roteiroDoModelo = limpar(o.roteiro_do_adesivo, 600);
  return {
    ordem,
    papel,
    molde,
    titulo: limpar(o.titulo, 120),
    texto_na_tela: limpar(o.texto_na_tela, MAX_TEXTO_NA_TELA),
    adesivo,
    fundo: fundoLimpo(o.fundo),
    horario: null,
    caminho: caminhoDoAdesivo(adesivo),
    // O roteiro do código é o exato (pergunta e opções); o do modelo completa quando falta o campo.
    roteiro_do_adesivo: adesivo.tipo === "nenhum" ? null : (roteiroDoAdesivo(adesivo) || roteiroDoModelo || null),
  };
}

/** Ordem 1..n na ordem recebida (estável), cortada na quantidade pedida. */
export function emOrdem<T extends { ordem: number }>(lista: T[], max = MAX_STORIES): T[] {
  return lista
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.ordem - b.s.ordem) || (a.i - b.i))
    .slice(0, max)
    .map((x, i) => ({ ...x.s, ordem: i + 1 }));
}

export function planoLimpo(bruto: unknown, quantidade: number): PlanoDaSequencia {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {};
  const lista = (Array.isArray(o.stories) ? o.stories : []).slice(0, MAX_STORIES).map((s, i) => rascunhoLimpo(s, i + 1));
  return {
    titulo: limpar(o.titulo, 200),
    gancho_de_amanha: limpar(o.gancho_de_amanha, 500),
    stories: emOrdem(lista, quantidade).filter((s) => !!s.texto_na_tela),
  };
}

// ------------------------------------------------------------------ sem repetição

const VAZIAS = new Set(["que", "com", "para", "por", "uma", "um", "dos", "das", "nos", "nas", "ele", "ela", "voce", "voces", "isso", "esse", "essa", "hoje", "aqui", "mais", "como", "sobre", "the", "pra"]);

export function palavras(texto: string): Set<string> {
  const sem = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return new Set(sem.split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !VAZIAS.has(p)));
}

export function semelhanca(a: string, b: string): number {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  let comum = 0;
  pa.forEach((p) => { if (pb.has(p)) comum++; });
  return comum / (pa.size + pb.size - comum);
}

/** O gancho de uma sequência: o texto do primeiro story (ou o título). */
export function ganchoDa(s: { titulo: string; stories: Array<{ ordem: number; texto_na_tela: string }> }): string {
  const primeiro = s.stories.slice().sort((a, b) => a.ordem - b.ordem)[0];
  return (primeiro && primeiro.texto_na_tela) || s.titulo || "";
}

/** O que a semana já usou: moldes (sem o 'livre') e ganchos. Vai ao prompt e à regra. */
export function jaUsadoNaSemana(recentes: SequenciaRecente[]): { moldes: string[]; ganchos: string[]; ganchoDeOntem: string | null } {
  const moldes = new Set<string>();
  const ganchos: string[] = [];
  for (const r of recentes) {
    for (const s of r.stories) if (s.molde && s.molde !== "livre") moldes.add(s.molde);
    const g = ganchoDa(r);
    if (g) ganchos.push(g);
  }
  const maisNova = recentes.slice().sort((a, b) => (a.data < b.data ? 1 : -1))[0];
  return { moldes: Array.from(moldes), ganchos, ganchoDeOntem: maisNova?.gancho_de_amanha || null };
}

export type Repeticao = { moldes_repetidos: string[]; gancho_repetido: boolean; frases_repetidas: number };

export function repeticaoDoPlano(plano: PlanoDaSequencia, recentes: SequenciaRecente[]): Repeticao {
  const usado = jaUsadoNaSemana(recentes);
  const moldes = Array.from(new Set(plano.stories.map((s) => s.molde).filter((m) => m !== "livre" && usado.moldes.indexOf(m) >= 0)));
  const gancho = ganchoDa(plano);
  const ganchoRepetido = !!gancho && usado.ganchos.some((g) => semelhanca(gancho, g) >= 0.5);
  const textosAntigos = recentes.flatMap((r) => r.stories.map((s) => s.texto_na_tela)).filter(Boolean);
  const frases = plano.stories.filter((s) => textosAntigos.some((t) => semelhanca(s.texto_na_tela, t) >= 0.7)).length;
  return { moldes_repetidos: moldes, gancho_repetido: ganchoRepetido, frases_repetidas: frases };
}

/** Ritmo da novela: um adesivo a cada 3 ou 4 stories, e o último é o gancho de amanhã. */
export function ritmoDoPlano(plano: PlanoDaSequencia): { adesivos: number; minimo: number; maximo: number; termina_com_gancho: boolean; longos: number } {
  const n = plano.stories.length;
  const adesivos = plano.stories.filter((s) => s.adesivo.tipo !== "nenhum").length;
  const ultimo = plano.stories[n - 1];
  return {
    adesivos,
    minimo: n ? Math.max(1, Math.floor(n / 4)) : 0,
    maximo: Math.ceil(n / 2),
    termina_com_gancho: !!ultimo && (ultimo.papel === "gancho_de_amanha" || !!plano.gancho_de_amanha),
    longos: plano.stories.filter((s) => s.texto_na_tela.length > TEXTO_CURTO).length,
  };
}

export type NotaDoPlano = { novidade: number | null; clareza: number | null };

/** Pontos de uma versão: a regra conta repetição e ritmo; o Jev (0 a 3) soma novidade e clareza quando respondeu. */
export function pontosDoPlano(plano: PlanoDaSequencia, recentes: SequenciaRecente[], jev: NotaDoPlano = { novidade: null, clareza: null }): number {
  if (!plano.stories.length) return -1000;
  const r = repeticaoDoPlano(plano, recentes);
  const ritmo = ritmoDoPlano(plano);
  let pontos = 0;
  pontos -= r.moldes_repetidos.length * 3 + (r.gancho_repetido ? 4 : 0) + r.frases_repetidas * 1.5;
  if (ritmo.adesivos < ritmo.minimo || ritmo.adesivos > ritmo.maximo) pontos -= 2;
  if (!ritmo.termina_com_gancho) pontos -= 2;
  pontos -= ritmo.longos * 0.5;
  if (jev.novidade !== null) pontos += jev.novidade * 2;
  if (jev.clareza !== null) pontos += jev.clareza;
  return Math.round(pontos * 100) / 100;
}

/** Índice da versão de mais pontos (empate: a primeira). */
export function melhorVersao(pontos: number[]): number {
  let melhor = 0;
  for (let i = 1; i < pontos.length; i++) if (pontos[i] > pontos[melhor]) melhor = i;
  return melhor;
}

export const NIVEIS_DE_NOVIDADE_DOS_STORIES = [
  "Repete a semana: o mesmo gancho, os mesmos moldes ou as mesmas frases das sequências anteriores",
  "Quase tudo já apareceu na semana; só um story é novo",
  "Assunto novo, mas abre igual ou reaproveita molde ou frase da semana",
  "Capítulo novo de verdade: gancho, moldes e frases que a semana ainda não usou, retomando o gancho de ontem quando existe",
];

export const NIVEIS_DE_CLAREZA_DOS_STORIES = [
  "Confusa: telas longas, sem fio entre elas, o seguidor não entende o que fazer",
  "Dá para seguir com esforço: textos compridos ou assunto demais na mesma sequência",
  "Clara, mas alguma tela poderia ser mais curta ou o convite mais direto",
  "Cada tela se lê num relance, o fio da novela é claro e o adesivo pede uma ação simples",
];

// ------------------------------------------------------------------ horários

/** Horários da sequência no dia (Brasília), espaçados entre o início e o fim; hoje começa depois de agora. */
export function horariosDaSequencia(data: string, quantidade: number, agora?: Date, inicio = INICIO_DO_DIA, fim = FIM_DO_DIA): string[] {
  const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let ini = minutos(inicio);
  const fi = minutos(fim);
  if (agora) {
    const local = new Date(agora.getTime() - 3 * 60 * 60_000);
    const hoje = local.toISOString().slice(0, 10);
    if (data === hoje) ini = Math.max(ini, Math.ceil((local.getUTCHours() * 60 + local.getUTCMinutes() + 30) / 5) * 5);
  }
  const n = Math.max(1, quantidade);
  const passo = n > 1 && fi > ini ? Math.floor((fi - ini) / (n - 1) / 5) * 5 : 0;
  const saida: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = Math.min(23 * 60 + 55, ini + passo * i);
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const iso = localParaIso(data, hhmm, FUSO_PADRAO);
    if (iso) saida.push(iso);
  }
  return saida;
}

/** Pelo app: quando a equipe é avisada (5 minutos antes). */
export function avisoEm(horario: string): string {
  return new Date(Date.parse(horario) - AVISO_ANTES_MIN * 60_000).toISOString();
}

/** A situação do story pela publicação da Agenda (o motor publica; a aba lê). */
export function situacaoPelaPublicacao(status: string | null | undefined, atual: Situacao): Situacao {
  if (status === "published") return "publicado";
  if (status === "failed") return "falhou";
  if (status === "scheduled") return "agendado";
  if (status === "planned" || status === "cancelled") return atual === "agendado" ? "arte_pronta" : atual;
  return atual;
}

// ------------------------------------------------------------------ agendamento

export type ArquivoDoStory = {
  id: string;
  client_id: string;
  project_id: string | null;
  parent_file_id: string | null;
  archived_at: string | null;
  status: string | null;
  agency_approval_status: string | null;
  locked_at: string | null;
  visibility: string | null;
  approval_status: string | null;
  sha256: string | null;
  storage_path: string | null;
  file_url: string | null;
};

/** Mesma regra de editorial_file_is_publishable (o motor só publica arquivo aprovado). */
export function arquivoPublicavel(f: ArquivoDoStory | null): boolean {
  if (!f || f.parent_file_id || f.archived_at) return false;
  if ((f.status || "ready") !== "ready" || f.agency_approval_status !== "approved" || !f.locked_at) return false;
  return (f.visibility === "approval" && f.approval_status === "approved") || f.visibility === "client_shared";
}

export type ContaDoStory = { id: string; automatica: boolean };

export type DependenciasDoAgendamento = {
  agora: Date;
  lerArquivo: (id: string) => Promise<ArquivoDoStory | null>;
  /** Conta do Instagram ligada ao projeto (a primeira conectada). */
  contaDoProjeto: (projectId: string) => Promise<ContaDoStory | null>;
  /** Projeto do cliente (da marca aberta) com conta do Instagram, para arquivo ainda sem projeto. */
  projetoComConta: () => Promise<{ projectId: string; conta: ContaDoStory } | null>;
  /** Liga o arquivo ao projeto (o motor exige o mesmo projeto do post). Devolve o motivo da recusa ou null. */
  ligarArquivoAoProjeto: (fileId: string, projectId: string) => Promise<string | null>;
  /** save_editorial_post com o JWT de quem chamou. Lança Error com a frase do motivo. */
  salvarPost: (payload: Record<string, unknown>) => Promise<{ post_id: string }>;
  lerPublicacao: (postId: string) => Promise<{ id: string; status: string } | null>;
};

export type Mudanca = Partial<Pick<Story, "situacao" | "motivo" | "roteiro_do_adesivo" | "editorial_post_id" | "publicacao_id" | "aviso_em" | "avisado_em">>;

export const MOTIVO_ESPERANDO_APROVACAO =
  "Na Agenda, esperando a aprovação da arte: o motor só publica arquivo aprovado pela agência e pelo cliente (ou compartilhado com ele). Aprovada antes do horário, sai sozinha.";

/** Payload de save_editorial_post do story automático (mesmo formato do agendador da Mesa). */
export async function payloadDoStory(e: {
  story: Pick<Story, "id" | "client_id" | "titulo" | "texto_na_tela" | "horario" | "ordem">;
  fileId: string;
  projectId: string;
  conta: ContaDoStory;
  aprovado: boolean;
  shaValido: boolean;
}): Promise<Record<string, unknown>> {
  const titulo = limpar(e.story.titulo, 200) || limpar(e.story.texto_na_tela, 80) || "Story";
  const publicacao: Record<string, unknown> = {
    id: null,
    idempotency_key: await uuidEstavel(`mesa-story-publicacao:${e.story.id}:${e.fileId}:${e.conta.id}`),
    external_account_id: e.conta.id,
    // Sem aprovação a Agenda segue o caminho comum (planejada, arquivo pelo post); aprovada, congela e agenda.
    file_id: e.aprovado ? e.fileId : null,
    caption: null,
    first_comment: null,
    alt_text: limpar(e.story.texto_na_tela, 300) || null,
    scheduled_at: e.story.horario,
    scheduled_timezone: FUSO_PADRAO,
  };
  if (e.aprovado) {
    publicacao.delivery_mode = e.conta.automatica && e.shaValido ? "automatic" : "manual";
    publicacao.asset_file_ids = [e.fileId];
  }
  return {
    id: null,
    idempotency_key: await uuidEstavel(`mesa-story:${e.story.id}:${e.fileId}`),
    mutation_id: await uuidEstavel(`mesa-story-mutacao:${e.story.id}:${e.fileId}:${e.story.horario}`),
    client_id: e.story.client_id,
    project_id: e.projectId,
    primary_file_id: e.fileId,
    title: titulo,
    content_type: "story",
    objective: null,
    default_caption: null,
    production_status: "ready",
    task_id: null,
    responsible_id: null,
    internal_notes: `Story da Mesa (story ${e.story.ordem} da sequência), agendado pela aba Stories.`,
    revision_of_post_id: null,
    publications: [publicacao],
  };
}

/**
 * Agenda um story. Pelo app: grava a situação, o aviso (5 minutos antes) e o
 * roteiro do adesivo, sem post. Automático: cria o post (content_type story) e
 * a publicação no horário pelas RPCs da Agenda; o banco decide entre agendada
 * (arte aprovada) e planejada (o promotor agenda quando o cliente aprovar).
 * Nunca lança: o que não deu vira motivo no story.
 */
export async function agendarUm(story: Story, d: DependenciasDoAgendamento): Promise<Mudanca> {
  if (story.situacao === "publicado") return {};
  const problema = problemaNoHorario(story.horario, d.agora);
  if (problema) return { motivo: problema };
  const horario = story.horario as string;

  if (caminhoDoAdesivo(story.adesivo) === "pelo_app") {
    // Nunca dois caminhos para o mesmo story: com publicação na Agenda, o motor também postaria.
    if (story.publicacao_id) return { motivo: "Este story já tem publicação automática na Agenda. Cancele por lá antes de mandar pelo app." };
    return {
      situacao: "postar_pelo_app",
      aviso_em: avisoEm(horario),
      avisado_em: null,
      roteiro_do_adesivo: roteiroDoAdesivo(story.adesivo) || story.roteiro_do_adesivo,
      motivo: story.file_id ? null : "Gere a arte antes do horário: o aviso leva a arte para baixar.",
    };
  }

  if (story.publicacao_id) {
    return { motivo: story.situacao === "falhou" ? "A publicação falhou. Use Tentar de novo na Agenda." : "Este story já está na Agenda. Para mudar o horário, use a Agenda." };
  }
  if (!story.file_id) return { motivo: "Gere a arte antes de agendar." };
  const arquivo = await d.lerArquivo(story.file_id);
  if (!arquivo || arquivo.client_id !== story.client_id) return { motivo: "A arte não está em Arquivos deste cliente. Gere de novo." };
  if (arquivo.archived_at || arquivo.parent_file_id) return { motivo: "A arte foi arquivada ou é parte de outro arquivo. Gere de novo." };
  if (!arquivo.storage_path && !/^https?:\/\//.test(arquivo.file_url || "")) return { motivo: "A arte não tem arquivo para o motor publicar. Gere de novo." };

  let projectId = arquivo.project_id;
  let conta: ContaDoStory | null = null;
  if (projectId) {
    conta = await d.contaDoProjeto(projectId);
    if (!conta) return { motivo: "O projeto da arte não tem conta do Instagram ligada. Ligue a conta na Agenda." };
  } else {
    const achado = await d.projetoComConta();
    if (!achado) return { motivo: "Nenhum projeto do cliente tem conta do Instagram ligada. Ligue a conta na Agenda." };
    const recusa = await d.ligarArquivoAoProjeto(arquivo.id, achado.projectId);
    if (recusa) return { motivo: recusa };
    projectId = achado.projectId;
    conta = achado.conta;
  }

  const aprovado = arquivoPublicavel(arquivo);
  const payload = await payloadDoStory({
    story,
    fileId: arquivo.id,
    projectId,
    conta,
    aprovado,
    shaValido: /^[0-9a-f]{64}$/i.test(arquivo.sha256 || ""),
  });
  let postId: string;
  try {
    postId = (await d.salvarPost(payload)).post_id;
  } catch (e) {
    return { motivo: limpar(e instanceof Error ? e.message : "A Agenda recusou o story.", 500) || "A Agenda recusou o story." };
  }
  const pub = await d.lerPublicacao(postId);
  const agendada = pub?.status === "scheduled";
  return {
    editorial_post_id: postId,
    publicacao_id: pub ? pub.id : null,
    situacao: agendada ? "agendado" : "arte_pronta",
    motivo: agendada ? null : aprovado ? "Entrou na Agenda, mas a publicação não ficou agendada. Confira na Agenda." : MOTIVO_ESPERANDO_APROVACAO,
  };
}
