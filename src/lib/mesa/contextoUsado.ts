import { supabase } from "@/integrations/supabase/client";
import { contasDaMarcaAberta, contextoDaMarcaAberta, linhaDaMarca, logosDaMarca, projetoDaMarcaAberta, valorEfetivo } from "../../../supabase/functions/_shared/heranca-da-marca";
import {
  ehDecisaoDoConselho,
  estrategiaAprovada,
  estrategiaTemConteudo,
  type ItemUsado,
  itensUsados,
  linhaDoCerebroValeNaMarca,
  linhaDoUsando,
  marcaDaLinhaDoCerebro,
  type PacoteDaMarca,
  pacoteVazio,
} from "../../../supabase/functions/_shared/contexto-completo-regras";
import { lerMarcasDoCliente, marcaEscolhida, type MarcaDoCliente } from "./marcas";

/**
 * "Usando: contexto da marca X, briefing de dd/mm, estratégia v3..." na
 * casca de cada mesa (frente SYNC, 30/09/2026): o dono vê o que os agentes
 * da mesa leem da marca aberta.
 *
 * A leitura é a mesma do servidor (supabase/functions/_shared/
 * contexto-completo-da-marca.ts), em versão leve: só datas, versões e
 * contagens, com as MESMAS regras puras (herança da marca e
 * contexto-completo-regras.ts). Só roda quando a janela abre (nada pesado
 * no navegador). Sem travessão.
 */

type Linha = Record<string, unknown>;

export type LinhasDoContexto = {
  nomeCliente: string;
  kit: Linha | null;
  marcas: MarcaDoCliente[];
  briefings: Linha[];
  projetos: Linha[];
  dossies: Linha[];
  decisoes: Linha[];
  memoria: Linha[];
  contas: Array<{ id: string; handle?: string | null; display_name?: string | null; platform?: string | null; status?: string | null }>;
  ligacoes: Array<{ project_id: string; external_account_id: string }>;
};

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const REGRAS = ["evitar", "reprovado", "preferencia", "ajuste"];

/** Monta o pacote leve (datas, versões e contagens) com a regra da herança. Puro: o Vitest usa. */
export function pacoteDaTela(l: LinhasDoContexto, marcaIdDaTela: string | null, clientId: string): PacoteDaMarca {
  const marca = marcaEscolhida(l.marcas, marcaIdDaTela);
  const p = pacoteVazio(clientId, l.nomeCliente || "cliente");
  if (marca) p.marca = { id: marca.id, nome: marca.nome, principal: marca.principal, outras: l.marcas.filter((m) => m.id !== marca.id).map((m) => m.nome) };
  const kit = l.kit || {};
  const paleta = valorEfetivo("paleta", marca, marca && marca.paleta.length ? marca.paleta : null, Array.isArray(kit.paleta) ? (kit.paleta as unknown[]) : null, [] as unknown[]);
  const logos = logosDaMarca(marca, marca, kit as Record<string, string | null>);
  p.kit = {
    paleta: (paleta as Array<{ hex?: string }>).map((c) => String((c && c.hex) || "")).filter(Boolean),
    estilo: valorEfetivo("estilo", marca, marca ? marca.estilo : null, txt(kit.estilo) || null, null as string | null),
    regras: valorEfetivo("regras", marca, marca ? marca.regras : null, txt(kit.regras) || null, null as string | null),
    fontes: [],
    temLogo: !!(logos.logo_path || logos.logo_file_id),
  };
  p.contexto = contextoDaMarcaAberta(marca, marca ? marca.contexto : null, (kit.contexto && typeof kit.contexto === "object" ? kit.contexto : {}) as Record<string, unknown>);
  // Briefing mais novo da marca (o respondido primeiro).
  const briefings = l.briefings.filter((b) => !b.arquivado_em && linhaDaMarca((b.marca_id as string | null) ?? null, marca));
  const b = briefings.filter((x) => x.submitted === true)[0] || briefings[0];
  if (b) p.briefing = { id: String(b.id || ""), titulo: txt(b.titulo) || null, data: String(b.enviado_em || b.created_at || "") || null, enviado: b.submitted === true, linhas: ["(respostas)"] };
  // Estratégia da Mesa Identidade: a aprovada primeiro.
  const projetos = l.projetos
    .filter((x) => x.estado !== "arquivado" && linhaDaMarca((x.marca_id as string | null) ?? null, marca))
    .filter((x) => estrategiaTemConteudo(x.estrategia));
  const pr = projetos.filter((x) => estrategiaAprovada(x.concluidas))[0] || projetos[0];
  if (pr) {
    p.estrategia = {
      projeto_id: String(pr.id),
      titulo: txt(pr.titulo) || "Identidade",
      versao: typeof pr.versao === "number" ? pr.versao : 1,
      aprovada: estrategiaAprovada(pr.concluidas),
      atualizado_em: String(pr.atualizado_em || "") || null,
      estrategia: (pr.estrategia || {}) as Record<string, unknown>,
      tagline: txt(pr.tagline) || null,
      nome: null,
    };
  }
  // Dossiê atual da marca.
  const dossies = l.dossies.filter((d) => projetoDaMarcaAberta((d.project_id as string | null) ?? null, marca, l.marcas));
  if (dossies.length) p.dossie = { texto: "(dossiê)", data: dossies.map((d) => String(d.created_at || "")).sort().pop() || null };
  // Decisões do conselho que valem (sem as desfeitas; a outra marca só as dela).
  p.decisoes = l.decisoes
    .filter((d) => ((d.tags as string[] | null) || []).indexOf("desfeita") < 0)
    .filter((d) => linhaDoCerebroValeNaMarca(txt(((d.metadata || {}) as Linha).marca_id) || null, marca))
    .slice(0, 5)
    .map((d) => ({ id: String(d.id), titulo: txt(d.title), resumo: "", data: String(d.created_at || "") || null }));
  // Regras ensinadas que valem na marca aberta.
  const ids = l.marcas.map((m) => m.id);
  const regras = l.memoria.filter((m) => REGRAS.indexOf(String(m.categoria || m.tipo || "")) >= 0 && !ehDecisaoDoConselho(m.texto))
    .filter((m) => linhaDoCerebroValeNaMarca(marcaDaLinhaDoCerebro(m.evidencia, m.referencia_id, ids), marca));
  if (regras.length || l.memoria.length) p.cerebro = { texto: "(cérebro)", regras: regras.length, fatos: l.memoria.length };
  // Instagram da marca.
  const contas = contasDaMarcaAberta(l.contas.filter((c) => /instagram/i.test(String(c.platform || "")) && c.status !== "inactive"), l.ligacoes, marca, l.marcas);
  if (contas.length) p.instagram = { contas: contas.map((c) => String(c.handle || c.display_name || "").replace(/^@/, "")).filter(Boolean), seguidores: null, alcance: null, semana: null };
  return p;
}

/** Lê o que a mesa usa da marca aberta e devolve a linha "Usando: ..." e os itens. Falha de uma parte vira aviso. */
export async function lerContextoUsado(clientId: string, marcaIdDaTela: string | null): Promise<{ linha: string; itens: ItemUsado[]; pacote: PacoteDaMarca }> {
  const avisos: string[] = [];
  const s = supabase as any;
  const ler = async <T>(nome: string, fn: () => PromiseLike<{ data: unknown; error: unknown }>, vazio: T): Promise<T> => {
    try {
      const r = await fn();
      if (r.error) throw r.error;
      return ((r.data as T) ?? vazio) as T;
    } catch (e) {
      avisos.push(nome);
      console.error(`[contexto usado] ${nome} não lido`, e);
      return vazio;
    }
  };
  const [marcas, perfil, kit, briefings, projetos, dossies, decisoes, memoria, contas, ligacoes] = await Promise.all([
    lerMarcasDoCliente(clientId),
    ler<Linha | null>("o nome", () => s.from("profiles").select("company_name, full_name").eq("id", clientId).maybeSingle(), null),
    ler<Linha | null>("o kit", () => s.from("cliente_kit_marca").select("paleta, estilo, regras, logo_path, logo_file_id, contexto").eq("client_id", clientId).maybeSingle(), null),
    ler<Linha[]>("o briefing", () => s.from("briefings").select("id, titulo, submitted, created_at, enviado_em, marca_id, arquivado_em").eq("client_id", clientId).order("created_at", { ascending: false }).limit(12), []),
    ler<Linha[]>("a estratégia", () => s.from("idv_projetos").select("id, titulo, marca_id, concluidas, versao, estado, atualizado_em, estrategia:dados->estrategia, tagline:dados->naming->>slogan").eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(10), []),
    ler<Linha[]>("o dossiê", () => s.from("client_dossiers").select("project_id, created_at").eq("client_id", clientId).eq("is_current", true).order("created_at", { ascending: false }).limit(12), []),
    ler<Linha[]>("as decisões", () => s.from("project_memory").select("id, title, tags, metadata, created_at").eq("client_id", clientId).eq("kind", "decisao").eq("source", "conselho").order("created_at", { ascending: false }).limit(12), []),
    ler<Linha[]>("o cérebro", () => s.from("agente_memoria").select("id, categoria, tipo, texto, evidencia, referencia_id").eq("client_id", clientId).eq("ativa", true).limit(300), []),
    ler<LinhasDoContexto["contas"]>("o Instagram", () => s.from("external_accounts").select("id, platform, handle, display_name, status").eq("client_id", clientId).limit(20), []),
    ler<LinhasDoContexto["ligacoes"]>("as contas da marca", () => s.from("project_external_accounts").select("project_id, external_account_id").eq("client_id", clientId), []),
  ]);
  const nome = perfil ? txt(perfil.company_name) || txt(perfil.full_name) : "";
  const pacote = pacoteDaTela({ nomeCliente: nome, kit, marcas, briefings, projetos, dossies, decisoes, memoria, contas, ligacoes }, marcaIdDaTela, clientId);
  pacote.avisos = avisos;
  const itens = itensUsados(pacote);
  return { linha: linhaDoUsando(itens, avisos), itens, pacote };
}
