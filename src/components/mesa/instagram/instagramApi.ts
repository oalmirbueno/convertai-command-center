import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chamarFuncao } from "@/lib/mesa/api";
import type { VereditoDaBio, SugestaoDeBio, SugestaoDeNome, EscolhaDoJev, CorDaPaleta, EstiloDaCapa, DestaqueProposto } from "../../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import type { ChaveDaRede, PaginaNaPrevia } from "../../../../supabase/functions/_shared/instagram-do-cliente";

/**
 * Aba Instagram da Mesa (frente IG, 28/09): tipos e chamadas da função
 * mesa-instagram. Uma leitura só ("painel") traz tudo o que a aba mostra;
 * as ações que gastam (bio, conversar, gerar_capa) devolvem o custo real.
 */

export interface ContaDaAba {
  id: string;
  username: string;
  conectada: boolean;
}

export interface MidiaDoPerfil {
  id: string;
  formato: string;
  imagem: string | null;
  permalink: string | null;
  data: string | null;
  curtidas: number | null;
  comentarios: number | null;
  legenda: string;
}

export interface PerfilDaAba {
  username: string;
  nome: string;
  bio: string;
  site: string;
  seguidores: number | null;
  seguindo: number | null;
  posts: number | null;
  foto_url: string | null;
  midias: MidiaDoPerfil[];
  fonte: "conta_do_cliente" | "descoberta" | "guardado" | "nenhuma";
  lido_em: string | null;
  aviso: string | null;
}

export interface ItemDaGradeNaAba {
  id: string;
  titulo: string;
  formato: string;
  origem: "arte" | "foto" | "agenda";
  data: string | null;
  data_confirmada: boolean;
  imagem: { bucket: string; caminho: string } | null;
  estado: string;
  /** O trabalho do Estúdio ou da Mesa Foto (abre o "Publicar em"). */
  peca: Record<string, unknown> | null;
  publicacao: Record<string, unknown> | null;
  dia_da_peca: string | null;
  task_id: string | null;
}

export interface AnaliseDaBio {
  bio_lida: string;
  nome_lido: string;
  username: string;
  veredito: VereditoDaBio;
  sugestoes: { bios: SugestaoDeBio[]; nomes: SugestaoDeNome[]; observacao: string };
  escolha: { bio: EscolhaDoJev | null; nome: EscolhaDoJev | null };
  modelo_id: string | null;
  gerado_em: string;
}

export interface CapaGuardada {
  id: string;
  nome: string;
  icone: string | null;
  estilo: EstiloDaCapa;
  caminho: string | null;
  modelo_id?: string | null;
  custo_usd?: number;
  ordem?: number;
}

export interface MensagemDaAba {
  id?: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos?: unknown[] | null;
  criado_em?: string;
}

/** Página do Facebook ligada ao cliente (a leitura vem pela ação "pagina"). */
export interface PaginaDaAba {
  id: string;
  nome: string;
  conectada: boolean;
}

export interface PainelDoInstagram {
  contas: ContaDaAba[];
  paginas: PaginaDaAba[];
  conta_id: string | null;
  perfil: PerfilDaAba;
  grade: { itens: ItemDaGradeNaAba[]; ordem: string[] };
  bio_analise: AnaliseDaBio | null;
  kit: { paleta: CorDaPaleta[]; estilo: string | null; logo: { bucket: string; caminho: string } | null };
  resumo: { nome: string; negocio: string; publico: string; oferta: string; tom_de_voz: string; diferenciais: string[] };
  capas: CapaGuardada[];
  redes: { adicionadas: Array<{ id: string; rede: ChaveDaRede; endereco: string }>; conectadas: Array<{ rede: string; endereco: string }> };
  mensagens: MensagemDaAba[];
  sql_pendente: boolean;
  aviso_sql: string | null;
}

export const chaveDoPainel = (clientId: string, contaId: string | null) => ["mesa", "instagram", clientId, contaId || "principal"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chamarInstagram<T = any>(acao: string, clientId: string, extra: Record<string, unknown> = {}): Promise<T> {
  return chamarFuncao<T>("mesa-instagram", { acao, client_id: clientId, ...extra });
}

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Perfil do Instagram como a tela usa (campo faltando vira vazio). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarPerfil(p: any): PerfilDaAba {
  const o = p || {};
  return {
    username: String(o.username || ""),
    nome: String(o.nome || ""),
    bio: String(o.bio || ""),
    site: String(o.site || ""),
    seguidores: typeof o.seguidores === "number" ? o.seguidores : null,
    seguindo: typeof o.seguindo === "number" ? o.seguindo : null,
    posts: typeof o.posts === "number" ? o.posts : null,
    foto_url: typeof o.foto_url === "string" ? o.foto_url : null,
    midias: lista<MidiaDoPerfil>(o.midias),
    fonte: o.fonte || "nenhuma",
    lido_em: o.lido_em || null,
    aviso: o.aviso || null,
  };
}

/** Normaliza para a tela nunca quebrar com campo faltando. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarPainel(d: any): PainelDoInstagram {
  return {
    contas: lista<ContaDaAba>(d && d.contas),
    paginas: lista<PaginaDaAba>(d && d.paginas),
    conta_id: d && typeof d.conta_id === "string" ? d.conta_id : null,
    perfil: normalizarPerfil(d && d.perfil),
    grade: { itens: lista<ItemDaGradeNaAba>(d && d.grade && d.grade.itens), ordem: lista<string>(d && d.grade && d.grade.ordem) },
    bio_analise: d && d.bio_analise && d.bio_analise.veredito ? (d.bio_analise as AnaliseDaBio) : null,
    kit: {
      paleta: lista<CorDaPaleta>(d && d.kit && d.kit.paleta),
      estilo: (d && d.kit && d.kit.estilo) || null,
      logo: (d && d.kit && d.kit.logo) || null,
    },
    resumo: {
      nome: String((d && d.resumo && d.resumo.nome) || ""),
      negocio: String((d && d.resumo && d.resumo.negocio) || ""),
      publico: String((d && d.resumo && d.resumo.publico) || ""),
      oferta: String((d && d.resumo && d.resumo.oferta) || ""),
      tom_de_voz: String((d && d.resumo && d.resumo.tom_de_voz) || ""),
      diferenciais: lista<string>(d && d.resumo && d.resumo.diferenciais),
    },
    capas: lista<CapaGuardada>(d && d.capas),
    redes: {
      adicionadas: lista(d && d.redes && d.redes.adicionadas),
      conectadas: lista(d && d.redes && d.redes.conectadas),
    },
    mensagens: lista<MensagemDaAba>(d && d.mensagens),
    sql_pendente: !!(d && d.sql_pendente),
    aviso_sql: (d && d.aviso_sql) || null,
  };
}

/** Tudo da aba numa leitura (sem IA). Vale 2 minutos; cada ação atualiza na hora. */
export function usePainelDoInstagram(clientId: string, contaId: string | null) {
  return useQuery({
    queryKey: chaveDoPainel(clientId, contaId),
    enabled: !!clientId,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => normalizarPainel(await chamarInstagram("painel", clientId, contaId ? { conta_id: contaId } : {})),
  });
}

/** Leitura de novo a cada 3 minutos com a aba visível (pedido do dono: prévia em tempo real). */
export const RELER_PERFIL_MS = 3 * 60_000;

/**
 * Só a prévia do perfil, em tempo real: começa com a leitura do painel (sem
 * pedir de novo na abertura) e relê sozinha a cada 3 minutos com a aba
 * visível, ao voltar para a janela e no botão Atualizar.
 */
export function usePerfilAoVivo(clientId: string, contaId: string | null, doPainel: PerfilDaAba | null, lidoEm: number) {
  return useQuery({
    queryKey: ["mesa", "instagram-perfil", clientId, contaId || "principal"],
    enabled: !!clientId && !!doPainel,
    initialData: doPainel || undefined,
    initialDataUpdatedAt: lidoEm,
    staleTime: 60_000,
    refetchInterval: RELER_PERFIL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 0,
    queryFn: async () => normalizarPerfil((await chamarInstagram<{ perfil: unknown }>("perfil", clientId, contaId ? { conta_id: contaId } : {})).perfil),
  });
}

/** Página do Facebook (nome, sobre, seguidores, posts), relida a cada 3 minutos como o perfil. */
export function usePaginaDoFacebook(clientId: string, paginaId: string | null) {
  return useQuery({
    queryKey: ["mesa", "facebook-pagina", clientId, paginaId],
    enabled: !!clientId && !!paginaId,
    staleTime: 60_000,
    refetchInterval: RELER_PERFIL_MS,
    refetchIntervalInBackground: false,
    retry: 0,
    queryFn: async () => (await chamarInstagram<{ pagina: PaginaNaPrevia }>("pagina", clientId, { pagina_id: paginaId })).pagina,
  });
}

/** "11:02" da leitura (ou vazio). */
export function horaDaLeitura(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "";
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** Troca um pedaço do painel guardado sem reler tudo (depois de uma ação). */
export function useAtualizarPainel(clientId: string, contaId: string | null) {
  const queryClient = useQueryClient();
  return {
    mudar: (fn: (p: PainelDoInstagram) => PainelDoInstagram) =>
      queryClient.setQueryData<PainelDoInstagram>(chaveDoPainel(clientId, contaId), (p) => (p ? fn(p) : p)),
    reler: () => queryClient.invalidateQueries({ queryKey: ["mesa", "instagram", clientId] }),
  };
}

export type { DestaqueProposto, PaginaNaPrevia };

/** Número curto do Instagram: 1.234 / 12,3 mil / 1,2 mi. */
export function numeroDoPerfil(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(".", ",").replace(",0", "")} mi`;
  if (v >= 10000) return `${(v / 1000).toFixed(1).replace(".", ",").replace(",0", "")} mil`;
  return v.toLocaleString("pt-BR");
}

/** Copia texto (com a reserva do textarea para navegador antigo). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cai na reserva */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
