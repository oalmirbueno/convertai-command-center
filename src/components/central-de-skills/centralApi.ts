/**
 * Central de Skills (18/11/2026): chamadas à função central-skills com a
 * sessão da equipe. Ler: equipe. Escrever (arquivar, salvar nota): admin ou gestor.
 */
import { supabase } from "@/integrations/supabase/client";

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/central-skills`;

export interface SkillDaCentral {
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;
  tags: string[];
  runtimes: string[];
  plugin: string | null;
  hash: string;
  versao: number;
  tamanho_bytes: number;
  arquivos: number;
  status: "ativa" | "arquivada";
  atualizado_em: string;
  publicado_por: string;
}

export interface ConectorDaCentral {
  slug: string;
  tipo: "plugin" | "mcp" | "composio";
  nome: string;
  descricao: string;
  instalar: Record<string, string>;
  requer: string[];
  skills: string[];
  atualizado_em: string;
}

export interface Manifesto {
  categorias: Record<string, string>;
  skills: SkillDaCentral[];
  conectores: ConectorDaCentral[];
  instalar: { windows: string; linux_mac: string; sincronizar_agora: string };
}

export interface MaquinaDaCentral {
  maquina: string;
  agente: string;
  versao_cliente: string;
  instaladas: number;
  enviadas: number;
  ultima_sync: string;
}

export interface EntradaDoCerebro { path: string; type: "file" | "dir"; size: number; sha: string }
export interface ArquivoDoCerebro { path: string; sha: string; size: number; content: string; truncated: boolean }

async function cabecalhos(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Entre de novo no painel.");
  return {
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

async function chamar<T>(metodo: "GET" | "POST", consulta: string, corpo?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${consulta ? `?${consulta}` : ""}`, {
    method: metodo,
    headers: { ...(await cabecalhos()), ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    const e = json?.erro;
    throw new Error(typeof e === "string" ? e : e?.detail || e?.kind || `Falhou (${res.status}).`);
  }
  return json as T;
}

export const lerManifesto = (arquivadas = false) =>
  chamar<Manifesto>("GET", `acao=manifesto${arquivadas ? "&arquivadas=1" : ""}`);
export const lerSkill = (slug: string) =>
  chamar<{ skill: SkillDaCentral & { skill_md: string; origens: Array<Record<string, string>>; versoes: Array<{ versao: number; publicado_por: string; criado_em: string }> } }>("GET", `acao=skill&slug=${encodeURIComponent(slug)}`).then((r) => r.skill);
export const linkDoPacote = (slug: string) =>
  chamar<{ pacotes: Array<{ slug: string; url: string | null }> }>("POST", "", { acao: "baixar", slugs: [slug] }).then((r) => r.pacotes[0]?.url ?? null);
export const mudarStatus = (slug: string, status: "ativa" | "arquivada") =>
  chamar("POST", "", { acao: "status", slug, status });
export const lerMaquinas = () => chamar<{ maquinas: MaquinaDaCentral[] }>("GET", "acao=maquinas").then((r) => r.maquinas);
export const lerArvore = (prefixo = "") =>
  chamar<{ entries: EntradaDoCerebro[]; truncated: boolean }>("GET", `acao=cerebro_arvore&prefixo=${encodeURIComponent(prefixo)}`);
export const lerArquivo = (caminho: string) =>
  chamar<{ arquivo: ArquivoDoCerebro }>("GET", `acao=cerebro_ler&caminho=${encodeURIComponent(caminho)}`).then((r) => r.arquivo);
export const salvarArquivo = (caminho: string, conteudo: string, sha: string | null, mensagem?: string) =>
  chamar<{ sha: string; created: boolean }>("POST", "", { acao: "cerebro_salvar", caminho, conteudo, sha, mensagem });

export const ROTULO_DO_AGENTE: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  agents: "Outros (~/.agents)",
  "claude-plugin": "Plugin do Claude",
  mcp: "MCP",
};
