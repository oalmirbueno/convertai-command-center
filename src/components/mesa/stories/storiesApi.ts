import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, ErroDaMesa, modeloDoPapel, padraoPara, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { marcaDaAba } from "../instagram/instagramApi";
import {
  type BriefingDosStories,
  ehFase,
  estruturaDaSequencia,
  type FaseDaCampanha,
  FASES_DA_CAMPANHA,
  identidadeLimpa,
  type IdentidadeDosStories,
  MODELO_DA_FASE,
  MODELOS_DE_SEQUENCIA,
  modeloPorChave,
  partesDoCustoDosStories,
  pedidoDasImagens,
  ROTULO_DA_FASE,
  ROTULO_DO_PAPEL,
  telasDaEstrutura,
} from "../../../../supabase/functions/mesa-stories/modulos/sequencia-que-converte";

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

/**
 * O fundo do story. 21/10: "gerada" é a imagem do gerador da casa (Arte rápida
 * 9:16, texto integrado pelo motor): a lâmina do trabalho do Estúdio, a versão
 * registrada e o texto que foi para a arte. "foto" é das sequências antigas
 * (a foto agora vai inteira como referência da imagem gerada, nunca colada).
 */
export interface Fundo {
  tipo: "foto" | "cor" | "gerada";
  imagem_id?: string;
  cor?: string;
  /** Papel na estrutura (gancho, problema_ou_desejo, prova, oferta, cta ou o arco da novela). */
  papel?: string;
  /** O que a imagem mostra (vai ao gerador). */
  cena?: string;
  /** Foto real do acervo que vai inteira como referência. */
  referencia_id?: string;
  trabalho_id?: string;
  lamina?: number;
  caminho?: string;
  versao?: number;
  texto?: string;
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

/** O vínculo com a campanha (escolha.campanha), para a campanha achar e retomar. */
export interface VinculoDaCampanha {
  campanha_id: string;
  tema_id: string | null;
  fase: FaseDaCampanha | null;
  nome: string;
}

export interface Sequencia {
  id: string;
  client_id: string;
  data: string;
  objetivo: string;
  titulo: string;
  gancho_de_amanha: string | null;
  criado_em: string;
  /** 21/10: o modelo da sequência (conversao, lancamento...) e a campanha, quando tem. */
  modelo?: string | null;
  campanha?: VinculoDaCampanha | null;
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
  const papel = typeof o.papel === "string" && o.papel ? { papel: o.papel } : {};
  if (o.tipo === "gerada") {
    const g: Fundo = { tipo: "gerada", ...papel };
    if (typeof o.cena === "string" && o.cena) g.cena = o.cena;
    if (typeof o.referencia_id === "string" && o.referencia_id) g.referencia_id = o.referencia_id;
    if (typeof o.trabalho_id === "string" && o.trabalho_id) g.trabalho_id = o.trabalho_id;
    if (Number(o.lamina) >= 1) g.lamina = Math.round(Number(o.lamina));
    if (typeof o.caminho === "string" && o.caminho) g.caminho = o.caminho;
    if (Number(o.versao) >= 1) g.versao = Math.round(Number(o.versao));
    if (typeof o.texto === "string") g.texto = o.texto;
    if (typeof o.cor === "string" && o.cor) g.cor = o.cor;
    return g;
  }
  if (o.tipo === "foto" && typeof o.imagem_id === "string" && o.imagem_id) return { tipo: "foto", imagem_id: o.imagem_id, ...papel };
  return { tipo: "cor", ...(typeof o.cor === "string" && o.cor ? { cor: o.cor } : {}), ...papel };
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
    modelo: o.escolha && typeof o.escolha.modelo === "string" ? o.escolha.modelo : null,
    campanha: normalizarVinculo(o.escolha && o.escolha.campanha),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarVinculo(v: any): VinculoDaCampanha | null {
  if (!v || typeof v !== "object" || typeof v.campanha_id !== "string" || !v.campanha_id) return null;
  return {
    campanha_id: v.campanha_id,
    tema_id: typeof v.tema_id === "string" && v.tema_id ? v.tema_id : null,
    fase: ehFase(v.fase) ? v.fase : null,
    nome: typeof v.nome === "string" && v.nome ? v.nome : "Campanha",
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

// ------------------------------------------------------------------ imagens pelo gerador da casa (21/10/2026)

/**
 * Pedido do dono (21/10): "gera conteúdo com imagens mais bacana e não só
 * texto, e sim algo que converte". Regra da casa: "nunca colocar imagem em
 * cima no Estúdio, sempre gerar com o gerador". A imagem de cada story é uma
 * lâmina da Arte rápida do Estúdio (formato stories_9x16), com o texto
 * integrado pelo motor; foto real só vai inteira como referência.
 */

export const FORMATO_DOS_STORIES = "stories_9x16";

/** O story tem imagem do gerador ligada (trabalho e lâmina). */
export const temImagemGerada = (s: Pick<Story, "fundo">) => s.fundo.tipo === "gerada" && !!s.fundo.trabalho_id && !!s.fundo.lamina;

/** Precisa pedir imagem ao gerador: sem lâmina ligada, sem arte registrada (as antigas valem) e fora da agenda. */
export const precisaDeImagem = (s: Story) => !temImagemGerada(s) && !s.file_id && s.situacao !== "publicado" && s.situacao !== "agendado" && s.situacao !== "postar_pelo_app";

/** O texto do story mudou depois da imagem: a arte tem o texto antigo. */
export const imagemDesatualizada = (s: Pick<Story, "fundo" | "texto_na_tela">) =>
  s.fundo.tipo === "gerada" && typeof s.fundo.texto === "string" && s.fundo.texto.trim() !== (s.texto_na_tela || "").trim();

/** Fotos reais que vão como referência inteira (até 4, sem repetir). */
export function referenciasDosStories(stories: Array<Pick<Story, "fundo">>): string[] {
  const ids: string[] = [];
  for (const s of stories) {
    const id = s.fundo.referencia_id || (s.fundo.tipo === "foto" ? s.fundo.imagem_id : undefined);
    if (id && ids.indexOf(id) < 0) ids.push(id);
  }
  return ids.slice(0, 4);
}

export interface CampanhaDoPedido {
  id: string;
  nome: string;
  fase?: FaseDaCampanha | null;
  identidade?: IdentidadeDosStories | null;
}

/** O corpo do rapida_preparar das imagens: 9:16, uma lâmina por tela, criativo, só referência (sem colagem). */
export function corpoDasImagens(e: {
  clientId: string;
  titulo: string;
  stories: Story[];
  campanha?: CampanhaDoPedido | null;
  marcaId?: string | null;
  modeloImagemId?: string | null;
}): Record<string, unknown> {
  const n = e.stories.length;
  const refs = referenciasDosStories(e.stories);
  const corpo: Record<string, unknown> = {
    acao: "rapida_preparar",
    client_id: e.clientId,
    pedido: pedidoDasImagens({
      titulo: e.titulo,
      telas: e.stories.map((s, i) => ({ ordem: i + 1, texto_na_tela: s.texto_na_tela, papel: s.fundo.papel || null, cena: s.fundo.cena || null, adesivo: s.adesivo })),
      campanha: e.campanha ? { nome: e.campanha.nome, fase: e.campanha.fase || null, identidade: e.campanha.identidade || null } : null,
    }),
    peca: n > 1 ? "carrossel" : "unica",
    formato: FORMATO_DOS_STORIES,
    qualidade: "media",
    fidelidade: "criativo",
    arquivos: refs.map((id, i) => ({ imagem_id: id, nome: `Foto de referência ${i + 1}`, papel: "referencia" })),
  };
  if (n > 1) corpo.laminas = n;
  if (e.campanha) corpo.campanha_id = e.campanha.id;
  if (e.marcaId) corpo.marca_id = e.marcaId;
  if (e.modeloImagemId) corpo.modelo_imagem_id = e.modeloImagemId;
  return corpo;
}

/**
 * Pede as imagens ao gerador: a direção da série (rapida_preparar), liga cada
 * story à sua lâmina (ligar_imagens) e põe as lâminas na fila do servidor
 * (enfileirar: a geração segue mesmo com a tela fechada).
 */
export async function gerarImagensDosStories(e: {
  clientId: string;
  titulo: string;
  stories: Story[];
  campanha?: CampanhaDoPedido | null;
  marcaId?: string | null;
  modeloImagemId?: string | null;
}): Promise<{ trabalhoId: string; stories: Story[]; avisos: string[]; custo_usd: number }> {
  const alvo = e.stories.slice().sort((a, b) => a.ordem - b.ordem);
  if (!alvo.length) throw new Error("Nenhum story precisa de imagem.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await chamarFuncao<any>("estudio-arte", corpoDasImagens({ ...e, stories: alvo }));
  const t = r && r.trabalho ? (r.trabalho as { id: string; direcao?: { cards?: Array<{ ordem: number }> } }) : null;
  if (!t || !t.id) throw new Error("O Estúdio não devolveu a direção das imagens.");
  const ordens = ((t.direcao && t.direcao.cards) || []).map((c) => Number(c.ordem)).filter((o) => o >= 1).sort((a, b) => a - b);
  if (!ordens.length) throw new Error("O Estúdio não montou as telas. Tente de novo.");
  const telas = alvo.slice(0, ordens.length).map((s, i) => ({ id: s.id, lamina: ordens[i] }));
  const lig = await chamarStories<{ stories: unknown[] }>("ligar_imagens", e.clientId, { trabalho_id: t.id, telas });
  await chamarFuncao("estudio-arte", { acao: "enfileirar", trabalho_id: t.id, ordens: telas.map((x) => x.lamina), ...(e.marcaId ? { marca_id: e.marcaId } : {}) });
  const avisos = (r && Array.isArray(r.avisos) ? r.avisos : []).filter((a: unknown): a is string => typeof a === "string" && !!a);
  if (alvo.length > ordens.length) avisos.push(`O Estúdio montou ${ordens.length} de ${alvo.length} telas: gere de novo as que ficaram sem imagem.`);
  return {
    trabalhoId: t.id,
    stories: (lig && Array.isArray(lig.stories) ? lig.stories : []).map(normalizarStory).filter((s) => !!s.id),
    avisos,
    custo_usd: Number(r && r.custo_usd) || 0,
  };
}

/** Refazer a imagem de uma tela: a lâmina vai de novo para a fila (versão nova, mesmo texto). */
export const refazerImagemDoStory = (s: Story, marcaId?: string | null) =>
  chamarFuncao("estudio-arte", { acao: "enfileirar", trabalho_id: s.fundo.trabalho_id, ordens: [s.fundo.lamina], ...(marcaId ? { marca_id: marcaId } : {}) });

/** Ajustar a imagem com um pedido curto (edição da lâmina pelo gerador, versão nova). */
export const ajustarImagemDoStory = (s: Story, instrucao: string) =>
  chamarFuncao("estudio-arte", { acao: "ajustar_card", trabalho_id: s.fundo.trabalho_id, ordem: s.fundo.lamina, instrucao: instrucao.trim() });

/** O pedido de troca do texto dentro da imagem (story que teve o texto editado). */
export const instrucaoDoTextoNovo = (texto: string) =>
  `Troque o texto da arte para exatamente: "${texto.trim()}". Mesma fonte, mesmo peso, mesmo tamanho e mesma posição; a imagem, as cores e a composição ficam iguais. Nada colado por cima.`;

/** A versão atual da lâmina vira o arquivo do story (com texto_na_arte depois de trocar o texto na imagem). */
export async function registrarImagemDoStory(clientId: string, s: Story, textoNaArte?: string): Promise<Story> {
  const r = await chamarStories<{ story: unknown }>("registrar_arte", clientId, { id: s.id, da_lamina: true, ...(typeof textoNaArte === "string" ? { texto_na_arte: textoNaArte } : {}) });
  return normalizarStory(r && r.story ? r.story : s);
}

export type EstadoDaLamina = "fila" | "rodando" | "erro";

export interface LaminasDoTrabalho {
  /** A versão mais nova de cada lâmina. */
  laminas: Record<number, { caminho: string; versao: number }>;
  /** O que está na fila do servidor por lâmina. */
  fila: Record<number, EstadoDaLamina>;
}

/** Lâminas e fila dos trabalhos do Estúdio ligados aos stories. Função pura. */
export function montarLaminas(
  trabalhos: Array<{ id: string; cards?: unknown }>,
  fila: Array<{ trabalho_id: string; status: string; ordem: number }>,
): Record<string, LaminasDoTrabalho> {
  const saida: Record<string, LaminasDoTrabalho> = {};
  for (const t of trabalhos) {
    const l: LaminasDoTrabalho = { laminas: {}, fila: {} };
    for (const c of Array.isArray(t.cards) ? (t.cards as Array<Record<string, unknown>>) : []) {
      const ordem = Number(c && c.ordem);
      const versao = Number(c && c.versao) || 0;
      if (!(ordem >= 1) || typeof c.storage_path !== "string") continue;
      const atual = l.laminas[ordem];
      if (!atual || versao > atual.versao) l.laminas[ordem] = { caminho: c.storage_path, versao };
    }
    saida[t.id] = l;
  }
  // A mais recente de cada lâmina vale (a fila vem da mais nova para a mais velha).
  for (const f of fila) {
    const l = saida[f.trabalho_id];
    if (!l || l.fila[f.ordem]) continue;
    if (f.status === "fila" || f.status === "rodando" || f.status === "erro") l.fila[f.ordem] = f.status;
  }
  return saida;
}

export const andandoNaFila = (m: Record<string, LaminasDoTrabalho> | undefined) =>
  !!m && Object.keys(m).some((id) => Object.keys(m[id].fila).some((o) => m[id].fila[Number(o)] === "fila" || m[id].fila[Number(o)] === "rodando"));

/** Lê as lâminas e a fila (RLS da equipe), de 4 em 4 segundos enquanto alguma está gerando. */
export function useLaminasDosStories(clientId: string, trabalhoIds: string[]) {
  const ids = trabalhoIds.filter((x, i) => !!x && trabalhoIds.indexOf(x) === i).sort();
  return useQuery({
    queryKey: ["mesa", "stories-laminas", clientId, ids.join(",")],
    enabled: !!clientId && ids.length > 0,
    staleTime: 3_000,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (andandoNaFila(q.state.data as Record<string, LaminasDoTrabalho> | undefined) ? 4_000 : false),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const [t, f] = await Promise.all([
        db.from("estudio_trabalhos").select("id, cards").eq("client_id", clientId).in("id", ids.slice(0, 40)),
        db.from("estudio_fila").select("trabalho_id, status, ordem, criado_em").in("trabalho_id", ids.slice(0, 40)).in("status", ["fila", "rodando", "erro"]).order("criado_em", { ascending: false }).limit(300),
      ]);
      if (t && t.error) throw t.error;
      // Sem a tabela da fila (banco antigo): o andamento sai só das lâminas gravadas.
      const fila = !f || f.error ? [] : ((f.data || []) as Array<{ trabalho_id: string; status: string; ordem: number }>).map((x) => ({ trabalho_id: String(x.trabalho_id), status: String(x.status), ordem: Number(x.ordem) || 0 }));
      return montarLaminas(((t && t.data) || []) as Array<{ id: string; cards?: unknown }>, fila);
    },
  });
}

/** A imagem viva do story: a lâmina mais nova (antes de registrar) ou a registrada. */
export function imagemDoStory(s: Pick<Story, "fundo">, laminas: Record<string, LaminasDoTrabalho> | undefined): { caminho: string; versao: number } | null {
  if (s.fundo.tipo !== "gerada" || !s.fundo.trabalho_id || !s.fundo.lamina) return null;
  const l = laminas && laminas[s.fundo.trabalho_id];
  const viva = l && l.laminas[s.fundo.lamina];
  if (viva) return viva;
  return s.fundo.caminho ? { caminho: s.fundo.caminho, versao: s.fundo.versao || 1 } : null;
}

/** Estado da lâmina do story na fila (ou null). */
export function filaDoStory(s: Pick<Story, "fundo">, laminas: Record<string, LaminasDoTrabalho> | undefined): EstadoDaLamina | null {
  if (s.fundo.tipo !== "gerada" || !s.fundo.trabalho_id || !s.fundo.lamina) return null;
  const l = laminas && laminas[s.fundo.trabalho_id];
  return (l && l.fila[s.fundo.lamina]) || null;
}

/** Hora de registrar: a lâmina tem versão nova, o texto bate e o story não está na agenda. */
export function precisaRegistrar(s: Story, laminas: Record<string, LaminasDoTrabalho> | undefined): boolean {
  if (!temImagemGerada(s) || imagemDesatualizada(s)) return false;
  if (s.situacao === "agendado" || s.situacao === "publicado" || s.situacao === "postar_pelo_app" || s.publicacao_id) return false;
  const l = laminas && laminas[String(s.fundo.trabalho_id)];
  const viva = l && l.laminas[Number(s.fundo.lamina)];
  if (!l || !viva) return false;
  const naFila = l.fila[Number(s.fundo.lamina)];
  if (naFila && naFila !== "erro") return false;
  return !s.file_id || s.fundo.versao !== viva.versao || s.fundo.caminho !== viva.caminho;
}

// ------------------------------------------------------------------ custo antes (tela)

/** O modelo padrão do roteirista na função (o da Central), para a estimativa da tela. */
const MODELO_DO_ROTEIRISTA = "openrouter:openai/gpt-6-luna";

/** As partes da estimativa (BotaoComCusto): o plano, a direção e as imagens. */
export function partesDaEstimativaDosStories(catalogo: ModeloIa[], telas: number, o: { comPlano: boolean; comImagens: boolean; comDiretor?: boolean; modeloImagemId?: string | null }): ParteDaEstimativa[] {
  const roteirista = catalogo.filter((m) => m.id === MODELO_DO_ROTEIRISTA && m.ativo)[0] || padraoPara(catalogo, "estrategista");
  const porPapel: Record<string, ModeloIa | null> = {
    plano: roteirista,
    diretor_arte: padraoPara(catalogo, "diretor_arte"),
    imagem: modeloDoPapel(catalogo, "imagem", o.modeloImagemId || null),
    leitura: padraoPara(catalogo, "leitura"),
  };
  return partesDoCustoDosStories(telas, { comPlano: o.comPlano, comImagens: o.comImagens, comDiretor: o.comDiretor }).map((p) => {
    const m = porPapel[p.papel];
    const parte: ParteDaEstimativa = { modeloId: m ? m.id : null, tipo: p.tipo, tokensEntrada: p.tokensEntrada, vezes: p.vezes };
    if (p.tokensSaida) parte.tokensSaida = p.tokensSaida;
    if (p.imagens) {
      parte.imagens = p.imagens;
      parte.qualidade = "media";
    }
    return parte;
  });
}

/** Uma imagem (refazer ou ajustar uma tela): a imagem e a conferência, sem a direção. */
export const partesDeUmaImagem = (catalogo: ModeloIa[], modeloImagemId?: string | null): ParteDaEstimativa[] =>
  partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true, comDiretor: false, modeloImagemId });

// ------------------------------------------------------------------ stories da campanha (o agente das Campanhas chama)

export interface PedidoDosStoriesDaCampanha {
  clientId: string;
  campanhaId: string;
  /** O conteúdo da campanha (tema) a que a sequência pertence; null = da campanha toda. */
  temaId: string | null;
  briefing?: Partial<BriefingDosStories> | null;
  identidade?: Partial<IdentidadeDosStories> | null;
  fase: FaseDaCampanha;
  quantidadeDeTelas: number;
  /** Segundo passo, depois de a equipe ver o custo. */
  confirmado?: boolean;
  /** Outro modelo de sequência (sem ele, o da fase). */
  modelo?: string | null;
  /** Dia da sequência (AAAA-MM-DD); sem ele, o começo da campanha ou amanhã. */
  data?: string | null;
  pedido?: string | null;
  /** Uma sequência nova mesmo havendo a deste tema. */
  refazer?: boolean;
  marcaId?: string | null;
  modeloImagemId?: string | null;
  /** Nome da campanha (para o pedido do gerador), quando quem chama já tem. */
  nomeDaCampanha?: string | null;
}

export type ResultadoDosStoriesDaCampanha =
  | { situacao: "confirmar_custo"; custo_estimado_usd: number; telas: number; mensagem: string }
  | {
      situacao: "pronta";
      /** A campanha já tinha esta sequência: só pediu as imagens que faltavam. */
      ja_existia: boolean;
      sequencia: Sequencia;
      stories: Story[];
      trabalhoId: string | null;
      avisos: string[];
      custo_usd: number;
    };

/**
 * A sequência de stories de uma campanha, com as imagens pelo gerador.
 * Custo antes, no padrão da casa: sem `confirmado` a função responde 409
 * confirmar_custo e aqui volta { situacao: "confirmar_custo", custo_estimado_usd }
 * (nada gasto); com `confirmado: true` planeja (briefing, identidade, selo como
 * referência, tom, oferta e a fase), guarda o vínculo { campanha_id, tema_id } e
 * pede as imagens. Se a campanha já tem a sequência do tema, retoma: só pede as
 * imagens que faltam (sem novo roteiro).
 */
export async function gerarStoriesDaCampanha(p: PedidoDosStoriesDaCampanha): Promise<ResultadoDosStoriesDaCampanha> {
  const corpo: Record<string, unknown> = {
    campanha_id: p.campanhaId,
    tema_id: p.temaId || null,
    fase: p.fase,
    quantidade: p.quantidadeDeTelas,
    ...(p.briefing ? { briefing: p.briefing } : {}),
    ...(p.identidade ? { identidade: p.identidade } : {}),
    ...(p.modelo ? { modelo_da_sequencia: p.modelo } : {}),
    ...(p.data ? { data: p.data } : {}),
    ...(p.pedido ? { pedido: p.pedido } : {}),
    ...(p.refazer ? { refazer: true } : {}),
    ...(p.confirmado ? { confirmado: true } : {}),
    ...(p.marcaId ? { marca_id: p.marcaId } : {}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any;
  try {
    r = await chamarStories("stories_da_campanha", p.clientId, corpo);
  } catch (e) {
    if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
      const d = e.detalhes || {};
      return { situacao: "confirmar_custo", custo_estimado_usd: Number(d.custo_estimado_usd) || 0, telas: Number(d.telas) || p.quantidadeDeTelas, mensagem: e.message };
    }
    throw e;
  }
  const sequencia = normalizarSequencia(r && r.sequencia);
  if (!sequencia.id) throw new Error("A sequência da campanha não voltou. Tente de novo.");
  let stories = (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s: Story) => !!s.id) as Story[];
  const avisos: string[] = (r && Array.isArray(r.avisos) ? r.avisos : []).filter((a: unknown): a is string => typeof a === "string" && !!a);
  let custo = Number(r && r.custo_usd) || 0;
  let trabalhoId: string | null = null;
  const faltam = stories.filter(precisaDeImagem);
  if (faltam.length) {
    const img = await gerarImagensDosStories({
      clientId: p.clientId,
      titulo: sequencia.titulo,
      stories: faltam,
      campanha: { id: p.campanhaId, nome: (sequencia.campanha && sequencia.campanha.nome) || p.nomeDaCampanha || "Campanha", fase: p.fase, identidade: p.identidade ? identidadeLimpa(p.identidade) : null },
      marcaId: p.marcaId || null,
      modeloImagemId: p.modeloImagemId || null,
    });
    trabalhoId = img.trabalhoId;
    custo += img.custo_usd;
    avisos.push(...img.avisos);
    const novos: Record<string, Story> = {};
    for (const s of img.stories) novos[s.id] = s;
    stories = stories.map((s) => novos[s.id] || s);
  } else {
    const comTrabalho = stories.filter(temImagemGerada)[0];
    trabalhoId = comTrabalho ? String(comTrabalho.fundo.trabalho_id) : null;
  }
  return { situacao: "pronta", ja_existia: !!(r && r.ja_existia), sequencia, stories, trabalhoId, avisos, custo_usd: Math.round(custo * 1e6) / 1e6 };
}

/** As sequências que a campanha já tem nos Stories (para achar e retomar). */
export async function lerStoriesDaCampanha(clientId: string, campanhaId: string): Promise<{ sequencias: Sequencia[]; stories: Story[] }> {
  const r = await chamarStories<{ sequencias: unknown[]; stories: unknown[] }>("sequencias_da_campanha", clientId, { campanha_id: campanhaId });
  return {
    sequencias: (r && Array.isArray(r.sequencias) ? r.sequencias : []).map(normalizarSequencia).filter((s) => !!s.id),
    stories: (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s) => !!s.id),
  };
}

/** Nova ordem da sequência (arrastar os cartões): os horários seguem a ordem. */
export async function reordenarStories(clientId: string, sequenciaId: string, ids: string[]): Promise<Story[]> {
  const r = await chamarStories<{ stories: unknown[] }>("reordenar", clientId, { sequencia_id: sequenciaId, ids });
  return (r && Array.isArray(r.stories) ? r.stories : []).map(normalizarStory).filter((s) => !!s.id);
}

/** Move um id na lista (arrastar). Função pura. */
export function moverNaLista(ids: string[], de: string, para: string): string[] {
  const i = ids.indexOf(de);
  const j = ids.indexOf(para);
  if (i < 0 || j < 0 || i === j) return ids.slice();
  const nova = ids.slice();
  const movido = nova.splice(i, 1)[0];
  nova.splice(j, 0, movido);
  return nova;
}

/** As campanhas que têm sequência (o filtro "Da campanha X"). */
export function campanhasDasSequencias(sequencias: Sequencia[]): Array<{ id: string; nome: string; total: number }> {
  const saida: Array<{ id: string; nome: string; total: number }> = [];
  for (const s of sequencias) {
    const v = s.campanha;
    if (!v) continue;
    const ja = saida.filter((c) => c.id === v.campanha_id)[0];
    if (ja) ja.total += 1;
    else saida.push({ id: v.campanha_id, nome: v.nome, total: 1 });
  }
  return saida;
}

export { MODELOS_DE_SEQUENCIA, ROTULO_DO_PAPEL, FASES_DA_CAMPANHA, ROTULO_DA_FASE, MODELO_DA_FASE, modeloPorChave, telasDaEstrutura, estruturaDaSequencia, pedidoDasImagens };
export type { FaseDaCampanha, BriefingDosStories, IdentidadeDosStories };
