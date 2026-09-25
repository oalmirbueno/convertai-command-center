import { useQuery, type QueryClient } from "@tanstack/react-query";
import { chamarFuncao, type ModeloIa, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { normalizarFoto, type FotoDoAcervo } from "./fotoApi";
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
  identidade_real: { imagem_id: string; principal: boolean }[];
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

export interface CloneAberto {
  clone: Clone;
  reais: (FotoDoAcervo & { principal: boolean })[];
  imagens: ImagemDaPersona[];
  folha: ResumoDaFolhaDoClone;
  variacoes: FotoDoAcervo[];
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
      ? v.identidade_real.filter((r: any) => r && r.imagem_id).map((r: any) => ({ imagem_id: String(r.imagem_id), principal: r.principal === true }))
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

export function normalizarCloneAberto(data: any): CloneAberto | null {
  const clone = normalizarClone(data && data.clone ? { ...data.clone, autorizacao_valida: data.autorizacao_valida } : null);
  if (!clone) return null;
  const reais = (Array.isArray(data.reais) ? data.reais : [])
    .map((r: any) => {
      const f = normalizarFoto(r);
      return f ? { ...f, principal: r.principal === true } : null;
    })
    .filter(Boolean) as (FotoDoAcervo & { principal: boolean })[];
  const imagens = (Array.isArray(data.imagens) ? data.imagens : []).map((i: any) => normalizarImagemDaPersona(i, clone.id)).filter(Boolean) as ImagemDaPersona[];
  const variacoes = (Array.isArray(data.variacoes) ? data.variacoes : []).map((i: any) => normalizarFoto(i)).filter(Boolean) as FotoDoAcervo[];
  const f = data.folha && typeof data.folha === "object" ? data.folha : {};
  return {
    clone,
    reais,
    imagens,
    variacoes,
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

export function useCloneAberto(id: string | null) {
  return useQuery({
    queryKey: chaveDoClone(id || ""),
    enabled: !!id,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => normalizarCloneAberto(await chamarFuncao<any>("mesa-foto", { acao: "clone_ler", modelo_id: id })),
  });
}

export function invalidarClone(queryClient: QueryClient, clientId: string, id?: string | null) {
  void queryClient.invalidateQueries({ queryKey: chaveDosClones(clientId) });
  if (id) void queryClient.invalidateQueries({ queryKey: chaveDoClone(id) });
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

export async function gerarVistaDoClone(p: { modeloId: string; vista: string; qualidade: Qualidade }): Promise<{ imagem: ImagemDaPersona | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_folha_gerar", modelo_id: p.modeloId, vista: p.vista, qualidade: p.qualidade });
  return { imagem: normalizarImagemDaPersona(data && data.imagem, p.modeloId), custo_usd: data && data.custo_usd };
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
}

export async function gerarVariacaoDoClone(p: { modeloId: string; pedido: PedidoDaVariacao; formato: string; qualidade: Qualidade }): Promise<{ imagem: FotoDoAcervo | null; custo_usd?: number }> {
  const pedido: Record<string, unknown> = { preset: p.pedido.preset };
  (["roupa", "cenario", "pose", "expressao", "livre"] as const).forEach((k) => {
    if (p.pedido[k].trim()) pedido[k] = p.pedido[k].trim();
  });
  const data = await chamarFuncao<any>("mesa-foto", { acao: "clone_variacao_gerar", modelo_id: p.modeloId, pedido, formato: p.formato, qualidade: p.qualidade });
  return { imagem: normalizarFoto(data && data.imagem), custo_usd: data && data.custo_usd };
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
