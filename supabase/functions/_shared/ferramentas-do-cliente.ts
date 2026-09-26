/**
 * Ferramentas internas de leitura do agente do cliente (frente C, 26/09).
 *
 * Pedido do dono: "acho que você tem que colocar algumas ferramentas internas
 * para esse tipo de agente. Cada agente tem que ter uma força grande,
 * inteligência boa de contexto". Em vez de despejar tudo no prompt, o agente
 * pede o que quer ler (campo `ler` da resposta, até 4 pedidos) e recebe o
 * resultado numa segunda rodada. Só leitura: nenhuma ferramenta escreve.
 *
 * Cada resultado passa por limparSegredos (pacote-externo.ts): nem o prompt
 * recebe senha, token ou documento pessoal que alguém tenha colado num
 * arquivo. O índice dos motores (motores.ts) lista quem usa cada ferramenta,
 * e o teste confere que a lista bate com este registro.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo com um banco falso.
 */
import { limparSegredos, linhasDoBriefing } from "./pacote-externo.ts";

export type NomeDaFerramenta =
  | "buscar_arquivo"
  | "ler_arquivo"
  | "ler_briefing"
  | "ler_metricas"
  | "ler_agenda"
  | "ler_cerebro"
  | "ler_dossie";

export const FERRAMENTAS_DO_CLIENTE: Record<NomeDaFerramenta, { descricao: string; argumento: string }> = {
  buscar_arquivo: { descricao: "procura arquivos do cliente pelo nome e pelo texto (Arquivos e workspace)", argumento: "termo curto (ex.: manual, cardápio, logo)" },
  ler_arquivo: { descricao: "lê o texto extraído de um arquivo de Arquivos", argumento: "nome do arquivo como apareceu na busca" },
  ler_briefing: { descricao: "lê as respostas do briefing do cliente (sem campos de acesso)", argumento: "vazio" },
  ler_metricas: { descricao: "lê as métricas semanais das redes (seguidores, alcance, interações) das últimas 8 semanas", argumento: "vazio" },
  ler_agenda: { descricao: "lê marcos e tarefas com prazo de 7 dias atrás até 45 dias à frente", argumento: "vazio" },
  ler_cerebro: { descricao: "lê o que os agentes já aprenderam com este cliente (preferências, o que evitar, o que performou)", argumento: "vazio" },
  ler_dossie: { descricao: "lê o dossiê atual do cliente inteiro", argumento: "vazio" },
};

export const NOMES_DAS_FERRAMENTAS = Object.keys(FERRAMENTAS_DO_CLIENTE) as NomeDaFerramenta[];
export const MAX_LEITURAS_POR_RODADA = 4;
export const TETO_DO_RESULTADO = 5000;

export type PedidoDeLeitura = { ferramenta: NomeDaFerramenta; argumento: string };

/** Esquema do campo `ler` na resposta do agente. */
export const ESQUEMA_DO_LER = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["ferramenta", "argumento"],
    properties: { ferramenta: { type: "string", enum: NOMES_DAS_FERRAMENTAS }, argumento: { type: "string" } },
  },
};

const umaLinha = (v: unknown, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Pedidos válidos, sem repetir, no máximo 4. Ferramenta desconhecida sai calada. */
export function normalizarPedidosDeLeitura(bruto: unknown): PedidoDeLeitura[] {
  const saida: PedidoDeLeitura[] = [];
  const vistos = new Set<string>();
  for (const p of Array.isArray(bruto) ? bruto : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const ferramenta = umaLinha(o.ferramenta, 40) as NomeDaFerramenta;
    if (!Object.prototype.hasOwnProperty.call(FERRAMENTAS_DO_CLIENTE, ferramenta)) continue;
    const argumento = umaLinha(o.argumento, 120);
    if ((ferramenta === "buscar_arquivo" || ferramenta === "ler_arquivo") && argumento.length < 2) continue;
    const chave = `${ferramenta}:${argumento.toLowerCase()}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ ferramenta, argumento });
    if (saida.length >= MAX_LEITURAS_POR_RODADA) break;
  }
  return saida;
}

/** Texto do prompt com as ferramentas e a regra de uso. */
export function blocoDasFerramentas(): string {
  const linhas = NOMES_DAS_FERRAMENTAS.map((n) => `  - ${n}: ${FERRAMENTAS_DO_CLIENTE[n].descricao}. argumento: ${FERRAMENTAS_DO_CLIENTE[n].argumento}.`);
  return `\nFERRAMENTAS DE LEITURA (campo ler): quando precisar de um fato que não está acima, peça até ${MAX_LEITURAS_POR_RODADA} leituras em ler e deixe plano, contexto, decisoes e caminho vazios nesta resposta (resposta curta dizendo o que vai ler). Você recebe o resultado e responde de vez. Sem precisar ler, ler vazio.\n${linhas.join("\n")}\n`;
}

// ------------------------------------------------------------------ execução

// deno-lint-ignore no-explicit-any
export type BancoDasFerramentas = { from: (tabela: string) => any };

export type DependenciasDasFerramentas = {
  lerDossie: (clientId: string) => Promise<string | null>;
  lerCerebro: (clientId: string) => Promise<string>;
  /** Hoje em AAAA-MM-DD. */
  hoje: string;
};

/** Termo seguro para ilike (sem curinga nem separador do PostgREST). */
export function termoDeBusca(v: unknown): string {
  return umaLinha(v, 60).replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();
}

function somarDias(hoje: string, dias: number): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function trecho(textoInteiro: string, termo: string, largura = 240): string {
  const t = textoInteiro.replace(/\s+/g, " ");
  const i = t.toLowerCase().indexOf(termo.toLowerCase());
  const inicio = Math.max(0, i < 0 ? 0 : i - largura / 2);
  return t.slice(inicio, inicio + largura).trim();
}

async function idsDosProjetos(db: BancoDasFerramentas, clientId: string): Promise<string[]> {
  const { data } = await db.from("projects").select("id").eq("client_id", clientId).is("deleted_at", null).limit(30);
  return ((data ?? []) as Array<{ id: string }>).map((p) => p.id);
}

async function executarUma(db: BancoDasFerramentas, clientId: string, p: PedidoDeLeitura, deps: DependenciasDasFerramentas): Promise<string> {
  switch (p.ferramenta) {
    case "buscar_arquivo": {
      const termo = termoDeBusca(p.argumento);
      if (termo.length < 2) return "Termo curto demais.";
      const [arquivos, nos] = await Promise.all([
        db.from("files").select("id, file_name, mime_type, created_at").eq("client_id", clientId).is("archived_at", null).ilike("file_name", `%${termo}%`).order("created_at", { ascending: false }).limit(8),
        db.from("workspace_nodes").select("id, name, kind").eq("scope", "client").eq("client_id", clientId).ilike("name", `%${termo}%`).limit(8),
      ]);
      const listaArquivos = ((arquivos.data ?? []) as Array<{ id: string; file_name: string; mime_type: string | null }>);
      // Busca no texto extraído dos arquivos recentes do cliente.
      const { data: recentes } = await db.from("files").select("id, file_name").eq("client_id", clientId).is("archived_at", null).order("created_at", { ascending: false }).limit(150);
      const porId = new Map(((recentes ?? []) as Array<{ id: string; file_name: string }>).map((f) => [f.id, f.file_name]));
      let noTexto: Array<{ file_id: string; text: string }> = [];
      if (porId.size) {
        const { data: pedacos } = await db.from("file_content_chunks").select("file_id, text").in("file_id", Array.from(porId.keys())).ilike("text", `%${termo}%`).limit(8);
        noTexto = (pedacos ?? []) as Array<{ file_id: string; text: string }>;
      }
      const linhas: string[] = [];
      for (const f of listaArquivos) linhas.push(`Arquivos: ${f.file_name}${f.mime_type ? ` (${f.mime_type})` : ""}`);
      for (const c of noTexto) linhas.push(`Texto de "${porId.get(c.file_id) || "arquivo"}": ...${trecho(String(c.text || ""), termo)}...`);
      for (const n of (nos.data ?? []) as Array<{ name: string; kind: string }>) linhas.push(`Workspace: ${n.kind === "folder" ? "pasta" : "arquivo"} ${n.name}`);
      return linhas.length ? linhas.join("\n") : `Nada encontrado para "${termo}".`;
    }
    case "ler_arquivo": {
      const nome = termoDeBusca(p.argumento);
      const { data } = await db.from("files").select("id, file_name").eq("client_id", clientId).is("archived_at", null).ilike("file_name", `%${nome}%`).order("created_at", { ascending: false }).limit(1);
      const f = ((data ?? []) as Array<{ id: string; file_name: string }>)[0];
      if (!f) return `Arquivo "${nome}" não encontrado em Arquivos (arquivo só do workspace não tem texto extraído).`;
      const { data: pedacos } = await db.from("file_content_chunks").select("chunk_index, text").eq("file_id", f.id).order("chunk_index", { ascending: true }).limit(20);
      const corpo = ((pedacos ?? []) as Array<{ text: string | null }>).map((x) => x.text || "").join("\n").trim();
      return corpo ? `Arquivo "${f.file_name}":\n${corpo}` : `O arquivo "${f.file_name}" ainda não tem texto extraído.`;
    }
    case "ler_briefing": {
      const { data } = await db.from("briefings").select("responses, submitted, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(3);
      const lista = (data ?? []) as Array<{ responses: unknown; submitted: boolean | null }>;
      const cheio = lista.find((b) => b.responses && typeof b.responses === "object" && Object.keys(b.responses as object).length);
      if (!cheio) return "O cliente ainda não respondeu o briefing.";
      const linhas = linhasDoBriefing(cheio.responses);
      return `${cheio.submitted ? "Briefing enviado pelo cliente" : "Briefing em andamento (não enviado)"}:\n${linhas.join("\n")}`;
    }
    case "ler_metricas": {
      const { data } = await db.from("social_metrics_weekly").select("platform, week_start, followers, reach, total_interactions, profile_views").eq("client_id", clientId).order("week_start", { ascending: false }).limit(16);
      const lista = (data ?? []) as Array<Record<string, unknown>>;
      if (!lista.length) return "Sem métricas semanais das redes ainda.";
      return lista.map((m) => `${m.platform} semana de ${m.week_start}: seguidores ${m.followers ?? "?"}, alcance ${m.reach ?? "?"}, interações ${m.total_interactions ?? "?"}, visitas ao perfil ${m.profile_views ?? "?"}`).join("\n");
    }
    case "ler_agenda": {
      const ids = await idsDosProjetos(db, clientId);
      if (!ids.length) return "O cliente ainda não tem projeto: agenda vazia.";
      const de = somarDias(deps.hoje, -7);
      const ate = somarDias(deps.hoje, 45);
      const [marcos, tarefas] = await Promise.all([
        db.from("milestones").select("title, status, target_date").in("project_id", ids).is("deleted_at", null).gte("target_date", de).lte("target_date", ate).order("target_date", { ascending: true }).limit(20),
        db.from("tasks").select("title, status, due_date").in("project_id", ids).is("deleted_at", null).neq("status", "done").gte("due_date", de).lte("due_date", ate).order("due_date", { ascending: true }).limit(40),
      ]);
      const linhas = [
        ...((marcos.data ?? []) as Array<{ title: string; status: string; target_date: string }>).map((m) => `${m.target_date} marco: ${m.title} (${m.status})`),
        ...((tarefas.data ?? []) as Array<{ title: string; status: string; due_date: string }>).map((t) => `${t.due_date} tarefa: ${t.title} (${t.status})`),
      ].sort();
      return linhas.length ? linhas.join("\n") : `Nada com prazo entre ${de} e ${ate}.`;
    }
    case "ler_cerebro":
      return (await deps.lerCerebro(clientId)) || "O cérebro deste cliente ainda está vazio.";
    case "ler_dossie":
      return (await deps.lerDossie(clientId)) || "Sem dossiê atual.";
    default:
      return "Ferramenta desconhecida.";
  }
}

/** Executa os pedidos (juntos) e devolve o bloco de resultados para a segunda rodada. Nunca lança. */
export async function executarLeituras(db: BancoDasFerramentas, clientId: string, pedidos: PedidoDeLeitura[], deps: DependenciasDasFerramentas): Promise<string> {
  const partes = await Promise.all(pedidos.map(async (p) => {
    let r: string;
    try {
      r = await executarUma(db, clientId, p, deps);
    } catch {
      r = "Leitura indisponível agora.";
    }
    const limpo = limparSegredos(r).slice(0, TETO_DO_RESULTADO);
    return `### ${p.ferramenta}${p.argumento ? ` (${p.argumento})` : ""}\n${limpo}`;
  }));
  return partes.join("\n\n");
}
