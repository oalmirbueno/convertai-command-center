import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import { marcaDaAba } from "../instagram/instagramApi";

/**
 * Aba Stories da Mesa (20/10/2026, docs/mesa/STORIES.md): tipos e chamadas da
 * função mesa-stories. Uma leitura só ("painel") traz sequências, stories,
 * destaques e moldes; cada ação devolve o que mudou e a tela troca só aquele
 * pedaço no cache, sem reler tudo.
 *
 * A API do Instagram não publica adesivo: story com adesivo vai "pelo app"
 * (a equipe posta e marca Postei); sem adesivo, o motor publica sozinho.
 */

export type TipoDeAdesivo = "nenhum" | "enquete" | "caixinha" | "quiz" | "link" | "contagem" | "localizacao" | "reacao" | "mencao";

export interface Adesivo {
  tipo: TipoDeAdesivo;
  pergunta?: string;
  opcoes?: string[];
  url?: string;
  texto_do_link?: string;
  quando?: string;
}

export interface Fundo {
  tipo: "foto" | "cor";
  imagem_id?: string;
  cor?: string;
}

export type Caminho = "automatico" | "pelo_app";
export type Situacao = "rascunho" | "arte_pronta" | "agendado" | "postar_pelo_app" | "publicado" | "falhou";

export interface Story {
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
  /** URL assinada (1 hora) da arte registrada, para mostrar e baixar no "pelo app". */
  arte_url?: string | null;
  /** Pelo app: quando a equipe recebe o aviso (horário menos 5 minutos) e quando recebeu. */
  aviso_em?: string | null;
  avisado_em?: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** O que o agente devolve no adaptar_molde (ainda sem id: não foi gravado). */
export type StoryRascunho = Partial<Story> & { texto_na_tela: string; adesivo: Adesivo };

export interface Sequencia {
  id: string;
  client_id: string;
  data: string;
  objetivo: string;
  titulo: string;
  gancho_de_amanha: string | null;
  criado_em: string;
}

export interface Molde {
  chave: string;
  nome: string;
  o_que_e: string;
  quando_usar: string;
  exemplo: string[];
  adesivo: TipoDeAdesivo;
}

/** Destaque do perfil (cliente_instagram_destaques): o mínimo que a aba usa. */
export interface DestaqueDoPerfil {
  id: string;
  nome: string;
  caminho: string | null;
}

export interface MensagemDosStories {
  id?: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos?: unknown[] | null;
}

export interface PainelDosStories {
  sequencias: Sequencia[];
  stories: Story[];
  destaques: DestaqueDoPerfil[];
  moldes: Molde[];
  /** A conversa ativa com o agente dos stories (o servidor guarda). */
  conversa: { id: string | null; mensagens: MensagemDosStories[] };
  /** Banco ainda sem as tabelas dos stories (migration pendente). */
  aviso: string | null;
}

export const TIPOS_DE_ADESIVO: TipoDeAdesivo[] = ["nenhum", "enquete", "caixinha", "quiz", "link", "contagem", "localizacao", "reacao", "mencao"];

export const ROTULO_DO_ADESIVO: Record<TipoDeAdesivo, string> = {
  nenhum: "Sem adesivo",
  enquete: "Enquete",
  caixinha: "Caixinha de perguntas",
  quiz: "Quiz",
  link: "Link",
  contagem: "Contagem regressiva",
  localizacao: "Localização",
  reacao: "Reação",
  mencao: "Menção",
};

export const OBJETIVOS: Array<{ valor: string; rotulo: string }> = [
  { valor: "engajar", rotulo: "Engajar" },
  { valor: "vender", rotulo: "Vender" },
  { valor: "lancar", rotulo: "Lançar" },
  { valor: "relacionamento", rotulo: "Relacionamento" },
  { valor: "bastidor", rotulo: "Bastidor" },
];

export const rotuloDoObjetivo = (v: string) => {
  const o = OBJETIVOS.find((x) => x.valor === v);
  return o ? o.rotulo : v;
};

export const SITUACOES: Record<Situacao, { rotulo: string; tom: string }> = {
  rascunho: { rotulo: "Rascunho", tom: "bg-muted text-muted-foreground" },
  arte_pronta: { rotulo: "Arte pronta", tom: "bg-primary/10 text-primary" },
  agendado: { rotulo: "Agendado", tom: "bg-success/15 text-success" },
  postar_pelo_app: { rotulo: "Postar pelo app", tom: "bg-warning/15 text-warning" },
  publicado: { rotulo: "Publicado", tom: "bg-success/15 text-success" },
  falhou: { rotulo: "Falhou", tom: "bg-destructive/10 text-destructive" },
};

const ehTipo = (v: unknown): v is TipoDeAdesivo => TIPOS_DE_ADESIVO.indexOf(v as TipoDeAdesivo) >= 0;
const ehSituacao = (v: unknown): v is Situacao => typeof v === "string" && Object.prototype.hasOwnProperty.call(SITUACOES, v);
const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const textoOu = (v: unknown, padrao = "") => (typeof v === "string" ? v : padrao);
const textoOuNulo = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Tem adesivo de interação: só pelo app (a API não publica adesivo). */
export const caminhoDoAdesivo = (a: Adesivo | null | undefined): Caminho => (a && a.tipo && a.tipo !== "nenhum" ? "pelo_app" : "automatico");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarAdesivo(a: any): Adesivo {
  const o = a && typeof a === "object" ? a : {};
  const tipo: TipoDeAdesivo = ehTipo(o.tipo) ? o.tipo : "nenhum";
  const saida: Adesivo = { tipo };
  if (typeof o.pergunta === "string") saida.pergunta = o.pergunta;
  if (Array.isArray(o.opcoes)) saida.opcoes = o.opcoes.filter((x: unknown) => typeof x === "string");
  if (typeof o.url === "string") saida.url = o.url;
  if (typeof o.texto_do_link === "string") saida.texto_do_link = o.texto_do_link;
  if (typeof o.quando === "string") saida.quando = o.quando;
  return saida;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarFundo(f: any): Fundo {
  const o = f && typeof f === "object" ? f : {};
  if (o.tipo === "foto" && typeof o.imagem_id === "string" && o.imagem_id) return { tipo: "foto", imagem_id: o.imagem_id };
  return { tipo: "cor", ...(typeof o.cor === "string" && o.cor ? { cor: o.cor } : {}) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarStory(s: any): Story {
  const o = s && typeof s === "object" ? s : {};
  const adesivo = normalizarAdesivo(o.adesivo);
  return {
    id: String(o.id || ""),
    sequencia_id: textoOuNulo(o.sequencia_id),
    client_id: textoOu(o.client_id),
    ordem: typeof o.ordem === "number" ? o.ordem : Number(o.ordem) || 0,
    molde: textoOu(o.molde),
    titulo: textoOu(o.titulo),
    texto_na_tela: textoOu(o.texto_na_tela),
    adesivo,
    fundo: normalizarFundo(o.fundo),
    horario: textoOuNulo(o.horario),
    caminho: o.caminho === "pelo_app" || o.caminho === "automatico" ? o.caminho : caminhoDoAdesivo(adesivo),
    destaque_id: textoOuNulo(o.destaque_id),
    file_id: textoOuNulo(o.file_id),
    editorial_post_id: textoOuNulo(o.editorial_post_id),
    publicacao_id: textoOuNulo(o.publicacao_id),
    situacao: ehSituacao(o.situacao) ? o.situacao : "rascunho",
    roteiro_do_adesivo: textoOuNulo(o.roteiro_do_adesivo),
    motivo: textoOuNulo(o.motivo),
    arte_url: textoOuNulo(o.arte_url),
    aviso_em: textoOuNulo(o.aviso_em),
    avisado_em: textoOuNulo(o.avisado_em),
    criado_em: textoOu(o.criado_em),
    atualizado_em: textoOu(o.atualizado_em),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarSequencia(s: any): Sequencia {
  const o = s && typeof s === "object" ? s : {};
  return {
    id: String(o.id || ""),
    client_id: textoOu(o.client_id),
    data: textoOu(o.data).slice(0, 10),
    objetivo: textoOu(o.objetivo),
    titulo: textoOu(o.titulo),
    gancho_de_amanha: textoOuNulo(o.gancho_de_amanha),
    criado_em: textoOu(o.criado_em),
  };
}

/** Mensagens da conversa como a tela usa (o que não for mensagem sai). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarMensagens(v: any): MensagemDosStories[] {
  return lista<Record<string, unknown>>(v)
    .filter((m) => m && typeof m.conteudo === "string")
    .map((m) => ({
      id: m.id ? String(m.id) : undefined,
      papel: m.papel === "usuario" || m.papel === "sistema" ? m.papel : "agente",
      conteudo: String(m.conteudo),
      anexos: Array.isArray(m.anexos) ? (m.anexos as unknown[]) : null,
    }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarPainelDosStories(d: any): PainelDosStories {
  const o = d && typeof d === "object" ? d : {};
  const conversa = o.conversa && typeof o.conversa === "object" ? o.conversa : {};
  return {
    conversa: { id: typeof conversa.id === "string" && conversa.id ? conversa.id : null, mensagens: normalizarMensagens(conversa.mensagens) },
    aviso: o.sql_pendente && typeof o.aviso === "string" ? o.aviso : null,
    sequencias: lista(o.sequencias).map(normalizarSequencia).filter((s) => !!s.id),
    stories: lista(o.stories).map(normalizarStory).filter((s) => !!s.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    destaques: lista<any>(o.destaques)
      .filter((x) => x && typeof x.id === "string")
      .map((x) => ({ id: String(x.id), nome: textoOu(x.nome), caminho: textoOuNulo(x.caminho) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    moldes: lista<any>(o.moldes)
      .filter((m) => m && typeof m.chave === "string")
      .map((m) => ({
        chave: String(m.chave),
        nome: textoOu(m.nome, String(m.chave)),
        o_que_e: textoOu(m.o_que_e),
        quando_usar: textoOu(m.quando_usar),
        exemplo: lista<unknown>(m.exemplo).filter((x): x is string => typeof x === "string"),
        adesivo: ehTipo(m.adesivo) ? m.adesivo : "nenhum",
      })),
  };
}

/**
 * Pedido à mesa-stories (JWT da equipe; a função confere o acesso ao cliente),
 * com a marca aberta na Mesa (Acerbi e CME nunca se misturam), como na aba Redes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chamarStories<T = any>(acao: string, clientId: string, extra: Record<string, unknown> = {}): Promise<T> {
  const marca = marcaDaAba(clientId);
  return chamarFuncao<T>("mesa-stories", { acao, client_id: clientId, ...(marca !== "-" && extra.marca_id === undefined ? { marca_id: marca } : {}), ...extra });
}

export const chaveDosStories = (clientId: string) => ["mesa", "stories", clientId, marcaDaAba(clientId)];

/** Tudo da aba numa leitura (sem IA). Vale 1 minuto; cada ação troca o pedaço dela. */
export function usePainelDosStories(clientId: string) {
  return useQuery({
    queryKey: chaveDosStories(clientId),
    enabled: !!clientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async () => normalizarPainelDosStories(await chamarStories("painel", clientId)),
  });
}

/** Troca pedaços do painel guardado (depois de uma ação), sem reler tudo. */
export function useAtualizarStories(clientId: string) {
  const queryClient = useQueryClient();
  const mudar = (fn: (p: PainelDosStories) => PainelDosStories) =>
    queryClient.setQueryData<PainelDosStories>(chaveDosStories(clientId), (p) => fn(p || { sequencias: [], stories: [], destaques: [], moldes: [], conversa: { id: null, mensagens: [] }, aviso: null }));
  return {
    mudar,
    /** Story novo ou trocado (pelo id). */
    stories: (novos: Story[]) =>
      mudar((p) => {
        const ids = novos.map((s) => s.id);
        return { ...p, stories: p.stories.filter((s) => ids.indexOf(s.id) < 0).concat(novos) };
      }),
    tirar: (id: string) => mudar((p) => ({ ...p, stories: p.stories.filter((s) => s.id !== id) })),
    sequencia: (s: Sequencia) => mudar((p) => ({ ...p, sequencias: p.sequencias.filter((x) => x.id !== s.id).concat([s]) })),
    conversa: (id: string | null, mensagens: MensagemDosStories[]) => mudar((p) => ({ ...p, conversa: { id, mensagens } })),
    reler: () => queryClient.invalidateQueries({ queryKey: ["mesa", "stories", clientId] }),
  };
}

// ------------------------------------------------------------------ regras da tela (puras)

/** Stories de uma sequência, na ordem. */
export function storiesDaSequencia(stories: Story[], sequenciaId: string | null): Story[] {
  if (!sequenciaId) return [];
  return stories.filter((s) => s.sequencia_id === sequenciaId).sort((a, b) => a.ordem - b.ordem);
}

/** A sequência que abre sozinha: a próxima a partir de hoje; sem ela, a mais recente. */
export function sequenciaQueAbre(sequencias: Sequencia[], hoje: string): Sequencia | null {
  if (!sequencias.length) return null;
  const futuras = sequencias.filter((s) => s.data >= hoje).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  if (futuras.length) return futuras[0];
  return sequencias.slice().sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))[0];
}

/** O roteiro exato do adesivo para quem posta pelo app (o do servidor vence). */
export function roteiroDoAdesivo(s: Pick<Story, "adesivo" | "roteiro_do_adesivo">): string {
  if (s.roteiro_do_adesivo) return s.roteiro_do_adesivo;
  const a = s.adesivo;
  // Sem ponto depois de pergunta que já termina em pontuação ("combo?." vira "combo?").
  const pergunta = (a.pergunta || "").trim().replace(/[.!?]+$/, (m) => (m.indexOf("?") >= 0 ? "?" : ""));
  const opcoes = (a.opcoes || []).map((x) => x.trim()).filter(Boolean);
  switch (a.tipo) {
    case "enquete":
      return `Adesivo Enquete. Pergunta: ${pergunta || "(sem pergunta)"}${/\?$/.test(pergunta) ? "" : "."} Opções: ${opcoes.length ? opcoes.join(" / ") : "Sim / Não"}.`;
    case "quiz":
      return `Adesivo Quiz. Pergunta: ${pergunta || "(sem pergunta)"}${/\?$/.test(pergunta) ? "" : "."} Opções: ${opcoes.join(" / ") || "(sem opções)"}. A certa é a primeira.`;
    case "caixinha":
      return `Adesivo Perguntas. Texto: ${pergunta || "Me pergunte algo"}.`;
    case "link":
      return `Adesivo Link. Endereço: ${a.url || "(sem link)"}. Texto do link: ${a.texto_do_link || "(padrão)"}.`;
    case "contagem":
      return `Adesivo Contagem regressiva. Nome: ${pergunta || "(sem nome)"}. Termina em: ${a.quando || "(escolha a data no app)"}.`;
    case "localizacao":
      return `Adesivo Local. Lugar: ${pergunta || "(escolha no app)"}.`;
    case "reacao":
      return `Adesivo Reação (barra de emoji). Pergunta: ${pergunta || "(sem pergunta)"}${/\?$/.test(pergunta) ? "" : "."}`;
    case "mencao":
      return `Adesivo Menção. Marcar: ${pergunta || "(escolha a conta no app)"}.`;
    default:
      return "Sem adesivo.";
  }
}

/** Data de hoje (AAAA-MM-DD) no relógio de quem usa. */
export function hojeLocal(agora = new Date()): string {
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(dia: string, n: number): string {
  const p = dia.split("-").map(Number);
  const d = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  d.setDate(d.getDate() + n);
  return hojeLocal(d);
}

/** "seg 20/10" de uma data AAAA-MM-DD. */
export function diaCurto(dia: string): string {
  const p = dia.split("-").map(Number);
  if (p.length < 3 || !p[0]) return dia;
  const d = new Date(p[0], p[1] - 1, p[2]);
  const nomes = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${nomes[d.getDay()]} ${dois(p[2])}/${dois(p[1])}`;
}
