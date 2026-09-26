import { useQuery, type QueryClient } from "@tanstack/react-query";
import { chamarFuncao, type ModeloIa, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { normalizarFoto, semearUrl, type FotoDoAcervo } from "./fotoApi";
import { normalizarImagemDaPersona, type ImagemDaPersona } from "./modelosApi";

/**
 * Clones (pedido do dono, 25/09; docs/mesa-foto/CLONES.md): pessoa REAL do
 * cliente, de 1 a 4 fotos reais do acervo, com a autorização de uso de imagem
 * registrada. Folha de identidade (frente, 3/4, perfil, meio corpo, corpo
 * inteiro) e depois variações (roupa, cenário, pose, expressão) mantendo o
 * rosto. Tudo marcado como gerado; conferência de semelhança só como aviso.
 * Leitura e escrita pela função mesa-foto (clones.ts), com o erro já traduzido.
 */

export const IDADE_MINIMA_CLONE = 18;
export const MAX_FOTOS_DO_CLONE = 4;

export const VISTAS_DO_CLONE: { valor: string; rotulo: string }[] = [
  { valor: "frente", rotulo: "Frente" },
  { valor: "tres_quartos_esq", rotulo: "3/4 esquerda" },
  { valor: "tres_quartos_dir", rotulo: "3/4 direita" },
  { valor: "perfil_esq", rotulo: "Perfil" },
  { valor: "meio_corpo", rotulo: "Meio corpo" },
  { valor: "corpo_inteiro", rotulo: "Corpo inteiro" },
];

export const FORMAS_DE_AUTORIZACAO: { valor: string; rotulo: string }[] = [
  { valor: "termo_assinado", rotulo: "Termo assinado" },
  { valor: "contrato", rotulo: "Contrato" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "mensagem", rotulo: "Mensagem" },
  { valor: "outro", rotulo: "Outro" },
];

export const FORMATOS_DO_CLONE = ["4:5", "1:1", "9:16", "16:9"];

export interface AutorizacaoDoClone {
  confirmada: boolean;
  quem: string;
  data: string;
  forma: string;
  finalidade: string;
  escopo: string;
  validade: string;
  observacao: string;
  sabe_que_e_ia: boolean;
  adulta: boolean;
  revogada_em?: string | null;
}

export interface Clone {
  id: string;
  client_id: string;
  nome: string;
  status: string;
  versao: number;
  invariantes: string[];
  motor_preferido_id: string | null;
  ancora_imagem_id: string | null;
  identidade_real: { imagem_id: string; principal: boolean; adicionada_em?: string | null }[];
  autorizacao: AutorizacaoDoClone | null;
  autorizacao_valida: { ok: boolean; motivo: string | null };
  capa_url: string | null;
  capa_e_real: boolean;
}

export interface MotorDoClone {
  modelo_imagem_id: string;
  rotulo: string;
  nota: string;
  padrao: boolean;
  disponivel: boolean;
  estimativa_usd: number;
}

export interface PresetDoClone {
  id: string;
  rotulo: string;
  roupa: string;
  cenario: string;
  pose: string;
  expressao: string;
  luz: string;
  enquadramento: string;
}

export interface ResumoDaFolhaDoClone {
  vistas: { vista: string; geradas: number; aprovada_id: string | null }[];
  aprovadas: number;
  total: number;
  pronto: boolean;
  frente_aprovada: boolean;
}

/**
 * Vista da folha do clone: além da imagem, se foi feita com as fotos de
 * origem antigas (continua guardada, mas não vai mais ao gerador como
 * identidade) e se foi apagada (arquivada, dá para restaurar).
 */
export type VistaDoClone = ImagemDaPersona & { desatualizada: boolean; arquivada: boolean; fontes_reais: string[] };

export interface CloneAberto {
  clone: Clone;
  reais: (FotoDoAcervo & { principal: boolean })[];
  imagens: VistaDoClone[];
  /** Vistas apagadas (arquivadas): ficam para restaurar. */
  arquivadas: VistaDoClone[];
  folha: ResumoDaFolhaDoClone;
  variacoes: FotoDoAcervo[];
  /** Variações apagadas (inativas no acervo): ficam para restaurar. */
  variacoes_arquivadas: FotoDoAcervo[];
  motores: MotorDoClone[];
  presets: PresetDoClone[];
}

export interface ConferenciaDoClone {
  semelhanca: number | null;
  alertas: string[];
  conferir: string[];
  resumo: string;
  tracos: { traco: string; nas_reais: string; na_gerada: string }[];
}

const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);

function normalizarAutorizacao(v: any): AutorizacaoDoClone | null {
  if (!v || typeof v !== "object") return null;
  return {
    confirmada: v.confirmada === true,
    quem: texto(v.quem),
    data: texto(v.data),
    forma: texto(v.forma) || "outro",
    finalidade: texto(v.finalidade),
    escopo: texto(v.escopo),
    validade: texto(v.validade),
    observacao: texto(v.observacao),
    sabe_que_e_ia: v.sabe_que_e_ia === true,
    adulta: v.adulta === true,
    revogada_em: v.revogada_em ? texto(v.revogada_em) : null,
  };
}

export function normalizarClone(v: any): Clone | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const val = v.autorizacao_valida && typeof v.autorizacao_valida === "object" ? v.autorizacao_valida : null;
  const aut = normalizarAutorizacao(v.autorizacao);
  return {
    id: String(v.id),
    client_id: texto(v.client_id),
    nome: texto(v.nome) || "Sem nome",
    status: texto(v.status) || "rascunho",
    versao: Number(v.versao) || 1,
    invariantes: lista(v.invariantes),
    motor_preferido_id: texto(v.motor_preferido_id) || null,
    ancora_imagem_id: texto(v.ancora_imagem_id) || null,
    identidade_real: Array.isArray(v.identidade_real)
      ? v.identidade_real.filter((r: any) => r && r.imagem_id).map((r: any) => ({ imagem_id: String(r.imagem_id), principal: r.principal === true, adicionada_em: texto(r.adicionada_em) || null }))
      : [],
    autorizacao: aut,
    autorizacao_valida: val ? { ok: val.ok === true, motivo: texto(val.motivo) || null } : { ok: !!aut && aut.confirmada && !aut.revogada_em, motivo: null },
    capa_url: texto(v.capa_url) || null,
    capa_e_real: v.capa_e_real === true,
  };
}

export const STATUS_DO_CLONE: Record<string, { rotulo: string; cor: string }> = {
  rascunho: { rotulo: "só fotos reais", cor: "bg-muted text-muted-foreground" },
  folha: { rotulo: "folha em andamento", cor: "bg-primary/10 text-primary" },
  pronta: { rotulo: "pronto", cor: "bg-success/15 text-success" },
  arquivada: { rotulo: "arquivado", cor: "bg-muted text-muted-foreground" },
};
export const statusDoClone = (s: string) => STATUS_DO_CLONE[s] || STATUS_DO_CLONE.rascunho;

export const chaveDosClones = (clientId: string) => ["mesa-foto", "clones", clientId];
export const chaveDoClone = (id: string) => ["mesa-foto", "clone", id];

export function useClones(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDosClones(clientId),
    enabled: ativo && !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Clone[]> => {
      const data = await chamarFuncao<any>("mesa-foto", { acao: "clones_listar", client_id: clientId });
      const saida: Clone[] = [];
      for (const b of (data && Array.isArray(data.clones) ? data.clones : []) as any[]) {
        const c = normalizarClone(b);
        if (c) saida.push(c);
      }
      return saida;
    },
  });
}

/** Fotos reais que foram ao gerador nesta vista (fontes tipo foto_real). */
function fontesReais(v: any): string[] {
  return (Array.isArray(v && v.fontes) ? v.fontes : [])
    .filter((f: any) => f && (f.tipo === "foto_real" || f.tipo === "real") && f.id)
    .map((f: any) => String(f.id));
}

export function normalizarVistaDoClone(v: any, cloneId = ""): VistaDoClone | null {
  const i = normalizarImagemDaPersona(v, cloneId);
  if (!i) return null;
  const avisos: string[] = Array.isArray(v.avisos) ? v.avisos.map(texto) : [];
  return {
    ...i,
    desatualizada: v.desatualizada === true,
    arquivada: v.arquivada === true || !!v.arquivada_em || avisos.some((a) => a.indexOf("arquivada_em:") === 0),
    fontes_reais: fontesReais(v),
  };
}

/** Uma vista qualquer (a que a função devolve ao gerar) como vista do clone: nova, atual, não apagada. */
export const comoVistaDoClone = (i: ImagemDaPersona | VistaDoClone): VistaDoClone => ({
  desatualizada: false,
  arquivada: false,
  fontes_reais: [],
  ...i,
});

export function normalizarCloneAberto(data: any): CloneAberto | null {
  const clone = normalizarClone(data && data.clone ? { ...data.clone, autorizacao_valida: data.autorizacao_valida } : null);
  if (!clone) return null;
  const reais = (Array.isArray(data.reais) ? data.reais : [])
    .map((r: any) => {
      const f = normalizarFoto(r);
      return f ? { ...f, principal: r.principal === true } : null;
    })
    .filter(Boolean) as (FotoDoAcervo & { principal: boolean })[];
  const vistas = (lista: any) => (Array.isArray(lista) ? lista : []).map((i: any) => normalizarVistaDoClone(i, clone.id)).filter(Boolean) as VistaDoClone[];
  const todas = vistas(data.imagens);
  const imagens = todas.filter((i) => !i.arquivada);
  const arquivadas = vistas(data.arquivadas).concat(todas.filter((i) => i.arquivada));
  const fotos = (lista: any) => (Array.isArray(lista) ? lista : []).map((i: any) => normalizarFoto(i)).filter(Boolean) as FotoDoAcervo[];
  const variacoes = fotos(data.variacoes);
  const f = data.folha && typeof data.folha === "object" ? data.folha : {};
  return {
    clone,
    reais,
    imagens,
    arquivadas,
    variacoes,
    variacoes_arquivadas: fotos(data.variacoes_arquivadas),
    folha: {
      vistas: Array.isArray(f.vistas) ? f.vistas.map((v: any) => ({ vista: texto(v.vista), geradas: Number(v.geradas) || 0, aprovada_id: texto(v.aprovada_id) || null })) : [],
      aprovadas: Number(f.aprovadas) || 0,
      total: Number(f.total) || 6,
      pronto: f.pronto === true,
      frente_aprovada: f.frente_aprovada === true,
    },
    motores: (Array.isArray(data.motores) ? data.motores : []).map((m: any) => ({
      modelo_imagem_id: texto(m.modelo_imagem_id),
      rotulo: texto(m.rotulo),
      nota: texto(m.nota),
      padrao: m.padrao === true,
      disponivel: m.disponivel !== false,
      estimativa_usd: Number(m.estimativa_usd) || 0,
    })),
    presets: (Array.isArray(data.presets) ? data.presets : []).map((p: any) => ({
      id: texto(p.id),
      rotulo: texto(p.rotulo),
      roupa: texto(p.roupa),
      cenario: texto(p.cenario),
      pose: texto(p.pose),
      expressao: texto(p.expressao),
      luz: texto(p.luz),
      enquadramento: texto(p.enquadramento) || "meio_corpo",
    })),
  };
}

/**
 * O clone aberto. Enquanto a leitura completa não chega, a tela mostra o
 * provisório (o clone da lista com as fotos reais do acervo em cache), em vez
 * de esqueleto: sem a "piscada" que parecia reiniciar (pedido do dono, 26/09).
 */
export function useCloneAberto(id: string | null, provisorio?: CloneAberto | null) {
  return useQuery({
    queryKey: chaveDoClone(id || ""),
    enabled: !!id,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: provisorio || undefined,
    queryFn: async () => normalizarCloneAberto(await chamarFuncao<any>("mesa-foto", { acao: "clone_ler", modelo_id: id })),
  });
}

/** Clone aberto provisório: o que a lista e o acervo em cache já sabem (sem ida à função). */
export function cloneAbertoProvisorio(c: Clone, fotos: FotoDoAcervo[], motores: MotorDoClone[] = [], presets: PresetDoClone[] = []): CloneAberto {
  const reais = c.identidade_real
    .map((r) => {
      const f = fotos.find((x) => x.id === r.imagem_id);
      return f ? { ...f, principal: r.principal } : null;
    })
    .filter(Boolean) as (FotoDoAcervo & { principal: boolean })[];
  const variacoes = fotos.filter((f) => f.tags.indexOf(`clone:${c.id}`) >= 0);
  return {
    clone: c,
    reais,
    imagens: [],
    arquivadas: [],
    variacoes,
    variacoes_arquivadas: [],
    folha: { vistas: [], aprovadas: 0, total: VISTAS_DO_CLONE.length, pronto: false, frente_aprovada: false },
    motores,
    presets,
  };
}

/**
 * Invalida sem apagar: a lista e o clone aberto seguem na tela com o que já
 * têm enquanto a releitura roda (nada volta a esqueleto nem a estado vazio).
 */
export function invalidarClone(queryClient: QueryClient, clientId: string, id?: string | null) {
  void queryClient.invalidateQueries({ queryKey: chaveDosClones(clientId) });
  void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "clones-arquivados", clientId] });
  if (id) void queryClient.invalidateQueries({ queryKey: chaveDoClone(id) });
}

/** Põe (ou troca) o clone na lista em cache, antes da releitura (criar e transferir não piscam). */
export function guardarCloneNaLista(queryClient: QueryClient, clientId: string, c: Clone) {
  queryClient.setQueryData<Clone[]>(chaveDosClones(clientId), (lista) => {
    const atual = lista || [];
    return atual.some((x) => x.id === c.id) ? atual.map((x) => (x.id === c.id ? { ...x, ...c, capa_url: c.capa_url || x.capa_url } : x)) : [c].concat(atual);
  });
}

export function tirarCloneDaLista(queryClient: QueryClient, clientId: string, id: string) {
  queryClient.setQueryData<Clone[]>(chaveDosClones(clientId), (lista) => (lista || []).filter((x) => x.id !== id));
}

/** Resumo da folha pelo que está na tela (depois de aprovar na hora, sem esperar a função). */
export function resumoDaFolhaLocal(imagens: ImagemDaPersona[]): ResumoDaFolhaDoClone {
  const vistas = VISTAS_DO_CLONE.map((v) => {
    const dela = imagens.filter((i) => i.papel === "vista" && i.vista === v.valor);
    const aprovada = dela.find((i) => i.aprovada === true) || null;
    return { vista: v.valor, geradas: dela.length, aprovada_id: aprovada ? aprovada.id : null };
  });
  const aprovadas = vistas.filter((v) => v.aprovada_id).length;
  const frente = !!vistas[0].aprovada_id;
  return { vistas, aprovadas, total: VISTAS_DO_CLONE.length, pronto: frente && aprovadas >= 3, frente_aprovada: frente };
}

/** Muda o clone aberto em cache (imagem nova, aprovação, variação) e recalcula a folha. */
export function mudarCloneAberto(queryClient: QueryClient, id: string, mudar: (a: CloneAberto) => CloneAberto) {
  queryClient.setQueryData<CloneAberto | null>(chaveDoClone(id), (a) => {
    if (!a) return a;
    const novo = mudar(a);
    return { ...novo, folha: resumoDaFolhaLocal(novo.imagens) };
  });
}

/** Vista nova da folha na tela na hora em que a função devolve (URL assinada já no cache). */
export function guardarVistaDoClone(queryClient: QueryClient, id: string, imagem: ImagemDaPersona | VistaDoClone) {
  if (imagem.url) semearUrl(queryClient, imagem.storage_bucket, imagem.storage_path, imagem.url);
  const vista = comoVistaDoClone(imagem);
  mudarCloneAberto(queryClient, id, (a) => ({ ...a, imagens: a.imagens.filter((i) => i.id !== vista.id).concat([vista]) }));
}

/** Variação nova (ou mudada, ex.: aprovada) no clone aberto em cache. */
export function guardarVariacaoDoClone(queryClient: QueryClient, id: string, foto: FotoDoAcervo, url?: string | null) {
  if (url) semearUrl(queryClient, foto.storage_bucket, foto.storage_path, url);
  mudarCloneAberto(queryClient, id, (a) => ({
    ...a,
    variacoes: a.variacoes.some((v) => v.id === foto.id) ? a.variacoes.map((v) => (v.id === foto.id ? foto : v)) : [foto].concat(a.variacoes),
  }));
}

// ------------------------------------------------------------------ rascunho e validação na tela

export interface RascunhoDoClone {
  nome: string;
  imagem_ids: string[];
  principal_id: string | null;
  invariantes: string;
  autorizacao: AutorizacaoDoClone;
}

export const autorizacaoVazia = (): AutorizacaoDoClone => ({
  confirmada: false,
  quem: "",
  data: "",
  forma: "termo_assinado",
  finalidade: "",
  escopo: "",
  validade: "",
  observacao: "",
  sabe_que_e_ia: false,
  adulta: false,
});

export const rascunhoDoClone = (fotos: string[] = []): RascunhoDoClone => ({
  nome: "",
  imagem_ids: fotos.slice(0, MAX_FOTOS_DO_CLONE),
  principal_id: fotos[0] || null,
  invariantes: "",
  autorizacao: autorizacaoVazia(),
});

/** DD/MM/AAAA ou AAAA-MM-DD para AAAA-MM-DD (vazio se não for data). */
export function dataDaTela(t: string): string {
  const s = String(t || "").trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** O que falta para criar o clone (a função confere de novo). */
export function problemasDoClone(r: RascunhoDoClone): string[] {
  const p: string[] = [];
  if (!r.nome.trim()) p.push("Dê o nome da pessoa.");
  if (!r.imagem_ids.length) p.push("Escolha de 1 a 4 fotos reais da pessoa.");
  if (r.imagem_ids.length > MAX_FOTOS_DO_CLONE) p.push(`No máximo ${MAX_FOTOS_DO_CLONE} fotos.`);
  const a = r.autorizacao;
  if (!a.quem.trim()) p.push("Diga quem autorizou o uso da imagem.");
  if (!dataDaTela(a.data)) p.push("Informe a data da autorização (DD/MM/AAAA).");
  if (!a.finalidade.trim()) p.push("Diga para que a imagem pode ser usada.");
  if (!a.sabe_que_e_ia) p.push("Confirme que a pessoa sabe que as imagens serão geradas por IA.");
  if (!a.adulta) p.push(`Confirme que a pessoa tem ${IDADE_MINIMA_CLONE} anos ou mais.`);
  if (!a.confirmada) p.push("Confirme a autorização de uso de imagem.");
  return p;
}

export function corpoDoClone(clientId: string, r: RascunhoDoClone) {
  const a = r.autorizacao;
  return {
    acao: "clone_criar",
    client_id: clientId,
    nome: r.nome.trim(),
    imagem_ids: r.imagem_ids,
    principal_id: r.principal_id,
    invariantes: r.invariantes.split(/\n+/).map((x) => x.trim()).filter(Boolean),
    autorizacao: {
      confirmada: a.confirmada,
      quem: a.quem.trim(),
      data: dataDaTela(a.data),
      forma: a.forma,
      finalidade: a.finalidade.trim(),
      escopo: a.escopo.trim() || null,
      validade: dataDaTela(a.validade) || null,
      observacao: a.observacao.trim() || null,
      sabe_que_e_ia: a.sabe_que_e_ia,
      adulta: a.adulta,
    },
  };
}

export async function criarClone(clientId: string, r: RascunhoDoClone): Promise<Clone | null> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDoClone(clientId, r));
  return normalizarClone(data && data.clone);
}

export async function gerarVistaDoClone(p: { modeloId: string; vista: string; qualidade: Qualidade; fotos?: string[] | null }): Promise<{ imagem: VistaDoClone | null; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "clone_folha_gerar", modelo_id: p.modeloId, vista: p.vista, qualidade: p.qualidade };
  // Só quando a equipe escolheu as fotos de origem desta geração (sem escolha, vão todas).
  if (p.fotos && p.fotos.length) corpo.fotos_reais_ids = p.fotos;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const imagem = normalizarVistaDoClone(data && data.imagem, p.modeloId);
  if (imagem && !imagem.url && data && typeof data.url === "string") imagem.url = data.url;
  return { imagem, custo_usd: data && data.custo_usd };
}

export async function decidirVistaDoClone(imagemId: string, decisao: "aprovar" | "rejeitar") {
  return await chamarFuncao<any>("mesa-foto", { acao: "clone_imagem_decidir", imagem_id: imagemId, decisao });
}

export interface PedidoDaVariacao {
  preset: string | null;
  roupa: string;
  cenario: string;
  pose: string;
  expressao: string;
  livre: string;
  /** Vindo das sugestões pelo contexto (luz e enquadramento também vão). */
  luz?: string;
  enquadramento?: string;
}

/** Preset que aplica a logo oficial do kit da marca (a função anexa a logo e avisa para conferir). */
export const PRESET_UNIFORME = "uniforme_marca";

export async function gerarVariacaoDoClone(p: { modeloId: string; pedido: PedidoDaVariacao; formato: string; qualidade: Qualidade }): Promise<{ imagem: FotoDoAcervo | null; url: string | null; custo_usd?: number; avisos: string[] }> {
  const pedido: Record<string, unknown> = { preset: p.pedido.preset };
  (["roupa", "cenario", "pose", "expressao", "livre", "luz"] as const).forEach((k) => {
    const v = p.pedido[k];
    if (v && v.trim()) pedido[k] = v.trim();
  });
  if (p.pedido.enquadramento) pedido.enquadramento = p.pedido.enquadramento;
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_variacao_gerar", modelo_id: p.modeloId, pedido, formato: p.formato, qualidade: p.qualidade });
  const url = data && data.imagem && typeof data.imagem.url === "string" ? data.imagem.url : data && typeof data.url === "string" ? data.url : null;
  return { imagem: normalizarFoto(data && data.imagem), url, custo_usd: data && data.custo_usd, avisos: lista(data && data.avisos) };
}

// ------------------------------------------------------------------ variações pelo contexto do cliente

export interface SugestaoDoClone {
  rotulo: string;
  roupa: string;
  cenario: string;
  pose: string;
  expressao: string;
  luz: string;
  enquadramento: string;
  porque: string;
}

export function normalizarSugestoesDoClone(data: any): { negocio: string; sugestoes: SugestaoDoClone[]; avisos: string[] } {
  const d = data && typeof data === "object" ? data : {};
  const sugestoes = (Array.isArray(d.sugestoes) ? d.sugestoes : [])
    .map((x: any) => ({
      rotulo: texto(x && x.rotulo) || "Sugestão",
      roupa: texto(x && x.roupa),
      cenario: texto(x && x.cenario),
      pose: texto(x && x.pose),
      expressao: texto(x && x.expressao),
      luz: texto(x && x.luz),
      enquadramento: texto(x && x.enquadramento) || "meio_corpo",
      porque: texto(x && x.porque),
    }))
    .filter((x: SugestaoDoClone) => x.roupa || x.cenario || x.pose);
  return { negocio: texto(d.negocio), sugestoes, avisos: lista(d.avisos) };
}

/** Variações coerentes com o negócio do cliente (texto; não gera imagem). */
export async function sugerirVariacoesDoClone(modeloId: string, pedido?: string) {
  const corpo: Record<string, unknown> = { acao: "clone_variacoes_sugerir", modelo_id: modeloId, quantidade: 6 };
  if (pedido && pedido.trim()) corpo.pedido = pedido.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { ...normalizarSugestoesDoClone(data), custo_usd: data && data.custo_usd };
}

/** Pedido de variação a partir de uma sugestão (sem preset: a sugestão já diz tudo). */
export const pedidoDaSugestao = (s: SugestaoDoClone, livre = ""): PedidoDaVariacao => ({
  preset: null,
  roupa: s.roupa,
  cenario: s.cenario,
  pose: s.pose,
  expressao: s.expressao,
  livre,
  luz: s.luz,
  enquadramento: s.enquadramento,
});

export function partesDaSugestaoDoClone(diretor: ModeloIa | null): ParteDaEstimativa[] {
  return [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: 9000, tokensSaida: 2000 }];
}

// ------------------------------------------------------------------ transferir para outro cliente

export interface ResumoDaTransferencia {
  de: string;
  para: string;
  movidas: number;
  copiadas: number;
  reaproveitadas: number;
  folha: number;
}

/** Transfere o clone (folha, fotos reais e variações, com os arquivos) para outro cliente. */
export async function transferirClone(modeloId: string, destino: string): Promise<{ clone: Clone | null; resumo: ResumoDaTransferencia | null; avisos: string[] }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_transferir", modelo_id: modeloId, client_id_destino: destino });
  const r = data && data.resumo && typeof data.resumo === "object" ? data.resumo : null;
  return {
    clone: normalizarClone(data && data.clone),
    resumo: r
      ? { de: texto(r.de), para: texto(r.para), movidas: Number(r.movidas) || 0, copiadas: Number(r.copiadas) || 0, reaproveitadas: Number(r.reaproveitadas) || 0, folha: Number(r.folha) || 0 }
      : null,
    avisos: lista(data && data.avisos),
  };
}

export function normalizarConferenciaDoClone(v: any): ConferenciaDoClone | null {
  if (!v || typeof v !== "object") return null;
  const leitura = v.leitura && typeof v.leitura === "object" ? v.leitura : {};
  return {
    semelhanca: numeroOuNulo(v.semelhanca),
    alertas: lista(v.alertas),
    conferir: lista(v.conferir),
    resumo: texto(leitura.resumo),
    tracos: Array.isArray(leitura.tracos) ? leitura.tracos.map((t: any) => ({ traco: texto(t.traco), nas_reais: texto(t.nas_reais), na_gerada: texto(t.na_gerada) })) : [],
  };
}

export async function conferirClone(modeloId: string, imagemId: string, origem: "folha" | "acervo") {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_conferir", modelo_id: modeloId, imagem_id: imagemId, origem });
  return { conferencia: normalizarConferenciaDoClone(data && data.conferencia), custo_usd: data && data.custo_usd };
}

export async function editarClone(modeloId: string, campos: Record<string, unknown>) {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_editar", modelo_id: modeloId, ...campos });
  return normalizarClone(data && data.clone);
}

export async function pacoteDoClone(modeloId: string): Promise<unknown> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_pacote", modelo_id: modeloId });
  return data && data.pacote;
}

// ------------------------------------------------------------------ editar depois de criado (25/09 à noite)

/** Lado menor mínimo da foto de origem (a função confere a mesma regra: clones-edicao.ts). */
export const LADO_MINIMO_FOTO_REAL = 256;

/** Por que a foto não serve de origem (null = serve). Mesma regra da criação e da edição. */
export function problemaDaFotoDeOrigem(f: Pick<FotoDoAcervo, "gerada" | "modo" | "ativa" | "largura" | "altura" | "referencia_web">): string | null {
  if (f.gerada || f.modo === "clone") return "Foto gerada por IA não vira identidade.";
  if (f.referencia_web) return "Foto da internet não vira identidade.";
  if (f.ativa === false) return "Foto arquivada no acervo.";
  if (f.largura && f.altura && Math.min(f.largura, f.altura) < LADO_MINIMO_FOTO_REAL) return `Foto pequena demais (menos de ${LADO_MINIMO_FOTO_REAL} px).`;
  return null;
}

/** Fotos de origem em edição na tela (antes de salvar). */
export interface FotosDeOrigem {
  ids: string[];
  principal: string | null;
}

export const fotosDeOrigemDoClone = (c: Clone): FotosDeOrigem => ({
  ids: c.identidade_real.map((r) => r.imagem_id),
  principal: (c.identidade_real.find((r) => r.principal) || c.identidade_real[0] || { imagem_id: null as string | null }).imagem_id,
});

/** O que mudou nas fotos de origem (nada = não mostra "Salvar"). */
export function mudancaNasFotos(c: Clone, r: FotosDeOrigem): { entraram: string[]; sairam: string[]; principal: boolean; alguma: boolean } {
  const antes = fotosDeOrigemDoClone(c);
  const entraram = r.ids.filter((id) => antes.ids.indexOf(id) < 0);
  const sairam = antes.ids.filter((id) => r.ids.indexOf(id) < 0);
  const principal = (r.principal || r.ids[0] || null) !== antes.principal;
  return { entraram, sairam, principal, alguma: entraram.length > 0 || sairam.length > 0 || principal };
}

export async function editarFotosDoClone(modeloId: string, r: FotosDeOrigem): Promise<{ clone: Clone | null; desatualizadas: string[]; avisos: string[] }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_fotos_editar", modelo_id: modeloId, imagem_ids: r.ids, principal_id: r.principal || r.ids[0] || null });
  return { clone: normalizarClone(data && data.clone), desatualizadas: lista(data && data.desatualizadas), avisos: lista(data && data.avisos) };
}

/** Marca na tela as vistas feitas com as fotos antigas (a função devolve os ids) e troca o clone. */
export function marcarFotosNovas(queryClient: QueryClient, c: Clone, desatualizadas: string[], reais?: (FotoDoAcervo & { principal: boolean })[]) {
  mudarCloneAberto(queryClient, c.id, (a) => ({
    ...a,
    clone: { ...a.clone, ...c, capa_url: c.capa_url || a.clone.capa_url, autorizacao_valida: a.clone.autorizacao_valida },
    reais: reais || a.reais,
    imagens: a.imagens.map((i) => ({ ...i, desatualizada: desatualizadas.indexOf(i.id) >= 0 })),
  }));
}

/** Apagar (arquivar) uma vista da folha ou uma variação; restaurar desfaz. */
export async function arquivarImagemDoClone(modeloId: string, imagemId: string, origem: "folha" | "acervo", restaurar = false) {
  const corpo: Record<string, unknown> = { acao: "clone_imagem_arquivar", modelo_id: modeloId, imagem_id: imagemId, origem };
  if (restaurar) corpo.restaurar = true;
  return await chamarFuncao<any>("mesa-foto", corpo);
}

/** Tira da tela (ou devolve) uma vista na hora, antes da função responder. */
export function moverVistaNoCache(queryClient: QueryClient, cloneId: string, vistaId: string, apagar: boolean) {
  mudarCloneAberto(queryClient, cloneId, (a) => {
    const de = apagar ? a.imagens : a.arquivadas;
    const achada = de.find((i) => i.id === vistaId);
    if (!achada) return a;
    // Restaurar não deixa duas aprovadas na mesma vista (como na função).
    const outraAprovada = !apagar && achada.aprovada === true && a.imagens.some((i) => i.id !== vistaId && i.papel === "vista" && i.vista === achada.vista && i.aprovada === true);
    const movida = { ...achada, arquivada: apagar, aprovada: outraAprovada ? null : achada.aprovada };
    return apagar
      ? { ...a, imagens: a.imagens.filter((i) => i.id !== vistaId), arquivadas: [movida].concat(a.arquivadas) }
      : { ...a, arquivadas: a.arquivadas.filter((i) => i.id !== vistaId), imagens: a.imagens.concat([movida]) };
  });
}

export function moverVariacaoNoCache(queryClient: QueryClient, cloneId: string, fotoId: string, apagar: boolean) {
  mudarCloneAberto(queryClient, cloneId, (a) => {
    const de = apagar ? a.variacoes : a.variacoes_arquivadas;
    const achada = de.find((v) => v.id === fotoId);
    if (!achada) return a;
    const movida = { ...achada, ativa: !apagar };
    return apagar
      ? { ...a, variacoes: a.variacoes.filter((v) => v.id !== fotoId), variacoes_arquivadas: [movida].concat(a.variacoes_arquivadas) }
      : { ...a, variacoes_arquivadas: a.variacoes_arquivadas.filter((v) => v.id !== fotoId), variacoes: [movida].concat(a.variacoes) };
  });
}

/** Gerar de novo uma variação (o mesmo pedido), escolhendo ou não as fotos de origem. */
export async function refazerVariacaoDoClone(p: { modeloId: string; imagemId: string; qualidade: Qualidade; fotos?: string[] | null }): Promise<{ imagem: FotoDoAcervo | null; url: string | null; custo_usd?: number; avisos: string[] }> {
  const corpo: Record<string, unknown> = { acao: "clone_variacao_refazer", modelo_id: p.modeloId, imagem_id: p.imagemId, qualidade: p.qualidade };
  if (p.fotos && p.fotos.length) corpo.fotos_reais_ids = p.fotos;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const url = data && data.imagem && typeof data.imagem.url === "string" ? data.imagem.url : data && typeof data.url === "string" ? data.url : null;
  return { imagem: normalizarFoto(data && data.imagem), url, custo_usd: data && data.custo_usd, avisos: lista(data && data.avisos) };
}

/** Duplicar: mesmas fotos de origem e a mesma autorização (a função confere de novo). */
export async function duplicarClone(modeloId: string, nome: string, levarFolha: boolean): Promise<{ clone: Clone | null; copiadas: number; avisos: string[] }> {
  const corpo: Record<string, unknown> = { acao: "clone_duplicar", modelo_id: modeloId, levar_folha: levarFolha };
  if (nome.trim()) corpo.nome = nome.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { clone: normalizarClone(data && data.clone), copiadas: Number(data && data.copiadas) || 0, avisos: lista(data && data.avisos) };
}

export const nomeDaCopiaDoClone = (nome: string) => `${String(nome || "Clone").replace(/\s*\(c[oó]pia(?: \d+)?\)\s*$/i, "").trim() || "Clone"} (cópia)`.slice(0, 80);

export const chaveDosArquivados = (clientId: string) => ["mesa-foto", "clones-arquivados", clientId];

/** Clones apagados (arquivados) do cliente: só quando a seção "Arquivados" abre. */
export function useClonesArquivados(clientId: string, ativo: boolean) {
  return useQuery({
    queryKey: chaveDosArquivados(clientId),
    enabled: ativo && !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Clone[]> => {
      const data = await chamarFuncao<any>("mesa-foto", { acao: "clones_listar", client_id: clientId, arquivados: true });
      return ((data && Array.isArray(data.clones) ? data.clones : []) as any[]).map(normalizarClone).filter(Boolean) as Clone[];
    },
  });
}

// ------------------------------------------------------------------ custo

const PROMPT_DO_CLONE = 2200;
const POR_REFERENCIA = 1600;

/** Uma imagem do clone no gerador dele (o preço certo vem da função; aqui é a conta local de reserva). */
export function partesDoClone(motorId: string | null, qualidade: Qualidade, referencias: number, vezes = 1): ParteDaEstimativa[] {
  return [{ modeloId: motorId, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: PROMPT_DO_CLONE + Math.max(1, referencias) * POR_REFERENCIA, vezes }];
}

export function partesDaConferenciaDoClone(leitura: ModeloIa | null): ParteDaEstimativa[] {
  return [{ modeloId: leitura ? leitura.id : null, tipo: "texto", tokensEntrada: 4 * 1600 + 1500, tokensSaida: 1800 }];
}

// ------------------------------------------------------------------ pedido vindo do acervo

/** "Variações desta pessoa" no acervo: a foto chega na aba Clones pelo endereço (?imagem=). */
export function cloneComAFoto(clones: Clone[], imagemId: string | null): Clone | null {
  if (!imagemId) return null;
  return clones.find((c) => c.status !== "arquivada" && c.identidade_real.some((r) => r.imagem_id === imagemId)) || null;
}
