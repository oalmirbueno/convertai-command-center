/**
 * Eventos reais de uma entrega (Frente DOC, 29/09/2026): o que o Registro da
 * entrega pode mostrar. Tudo sai do banco, com a origem de cada fato:
 * - publicações e agendamentos (editorial_publications + editorial_posts);
 * - artes entregues pelo Estúdio da Mesa (estudio_trabalhos);
 * - aprovações e liberações de arquivos (file_approval_events + files);
 * - relatórios (reports), etapas concluídas do projeto (tasks);
 * - organização do Workspace (workspace_nodes, só a contagem);
 * - ações registradas pelas mesas (mcp_audit_log, só as que o cliente entende);
 * - números do Instagram (social_post_metrics), com a data da leitura.
 * Leitura que falha não some: vai para o log (registrarFalha) e vira aviso na
 * tela. Marca que não é a principal nunca herda da outra (eventoDaMarca).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import {
  dataPorExtenso,
  type EventoReal,
  eventoDaMarca,
  type ImagemDoEvento,
  type NumeroReal,
  periodoDaReferencia,
  type TipoDeEntrega,
  tituloPadrao,
} from "../_shared/registro-de-entrega.ts";

export type MarcaParaEventos = { id: string; nome: string; principal: boolean; project_id: string | null } | null;

export type Coleta = {
  eventos: EventoReal[];
  numeros: NumeroReal[];
  periodo: { de: string; ate: string } | null;
  titulo: string;
  projectId: string | null;
  avisos: string[];
};

/** Ações das mesas que viram fato para o cliente (as outras ficam só no registro interno). */
export const ACOES_QUE_O_CLIENTE_ENTENDE: Record<string, string> = {
  roteiro_pdf_compartilhar: "Roteiro de gravação preparado",
  estilo_aprovar_teste: "Estilo visual das artes definido",
  mesa_gerar_meses_pelo_agente: "Planejamento de conteúdo montado",
  mesa_ads_ativar_campanha_montada: "Campanha de anúncios ativada",
};

const ROTULO_DA_PLATAFORMA: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google_business: "Google Meu Negócio",
};

const ENTREGA_DA_ARTE: Record<string, { detalhe: string; forte: boolean }> = {
  aprovado: { detalhe: "Aprovada por você", forte: true },
  agendado: { detalhe: "Aprovada e agendada", forte: true },
  aguardando_cliente: { detalhe: "Enviada para a sua aprovação", forte: false },
  aguardando_agencia: { detalhe: "Entregue em Arquivos, na revisão da equipe", forte: false },
  reprovado: { detalhe: "Você pediu ajustes", forte: false },
  precisa_de_atencao: { detalhe: "Entregue, com ajuste pendente", forte: false },
};

const EVENTO_DE_ARQUIVO: Record<string, { fonte: "aprovacao" | "arquivo"; detalhe: string; forte: boolean }> = {
  client_approved: { fonte: "aprovacao", detalhe: "Aprovado por você no painel", forte: true },
  client_approved_offline: { fonte: "aprovacao", detalhe: "Aprovação registrada pela equipe (combinada com você fora do painel)", forte: true },
  released_for_approval: { fonte: "arquivo", detalhe: "Enviado para a sua aprovação", forte: false },
  released_client_shared: { fonte: "arquivo", detalhe: "Disponibilizado no seu portal", forte: false },
};

type Arquivo = { id: string; file_name: string; mime_type: string | null; storage_bucket: string | null; storage_path: string | null; client_id: string; project_id: string | null; tags: string[] | null; archived_at: string | null };

const hora = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Horário de São Paulo (UTC-3, sem horário de verão desde 2019).
  const sp = new Date(d.getTime() - 3 * 3600_000);
  return `${String(sp.getUTCHours()).padStart(2, "0")}:${String(sp.getUTCMinutes()).padStart(2, "0")}`;
};

function imagemDoArquivo(a: Arquivo | undefined): ImagemDoEvento | null {
  if (!a || a.archived_at || !a.storage_path) return null;
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(String(a.mime_type || ""))) return null;
  return { bucket: a.storage_bucket || "files", caminho: a.storage_path, file_id: a.id, mime: a.mime_type };
}

const ehDocumentoDeEntrega = (a: Arquivo | undefined) => !!a && (a.tags || []).indexOf("documento_entrega") >= 0;

/**
 * Lê os eventos da entrega. `projetos` e `marcas` vêm de quem chamou (já
 * conferido o acesso ao cliente). Nunca inventa: sem linha no banco, sem evento.
 */
export async function coletarEventos(
  s: SupabaseClient,
  p: {
    clientId: string;
    tipo: TipoDeEntrega;
    referencia: string;
    marca: MarcaParaEventos;
    projetosDeOutrasMarcas: string[];
    provasDoGancho?: string[];
    agora?: Date;
  },
): Promise<Coleta> {
  const avisos: string[] = [];
  const falhou = (onde: string, error: unknown) => {
    registrarFalha(`documentos: leitura de ${onde} falhou`, error, { client_id: p.clientId });
    avisos.push(`Não foi possível ler ${onde} agora; o documento saiu sem essa parte.`);
  };
  const daMarca = (projectId: string | null | undefined) => eventoDaMarca(projectId, p.marca, p.projetosDeOutrasMarcas);

  let periodo = periodoDaReferencia(p.tipo, p.referencia);
  let projectId: string | null = null;
  let titulo = tituloPadrao(p.tipo, p.referencia);
  let tarefasDoProjeto: string[] = [];
  if (p.tipo === "projeto") {
    const { data, error } = await s.from("projects").select("id, client_id, name, status, start_date, created_at, deleted_at").eq("id", p.referencia).maybeSingle();
    if (error) throw new Error(`projeto_indisponivel:${error.message}`);
    const pr = data as { id: string; client_id: string; name: string; start_date: string | null; created_at: string; deleted_at: string | null } | null;
    if (!pr || pr.client_id !== p.clientId || pr.deleted_at) throw new Error("projeto_inexistente");
    if (!daMarca(pr.id)) throw new Error("projeto_de_outra_marca");
    projectId = pr.id;
    titulo = tituloPadrao("projeto", p.referencia, pr.name);
    const agora = p.agora || new Date();
    periodo = { de: new Date(pr.start_date || pr.created_at).toISOString(), ate: new Date(agora.getTime() + 86400_000).toISOString() };
    const t = await s.from("tasks").select("id, title, status, updated_at").eq("project_id", pr.id).is("deleted_at", null).limit(500);
    if (t.error) falhou("as etapas do projeto", t.error);
    tarefasDoProjeto = ((t.data as Array<{ id: string }>) || []).map((x) => x.id);
  }
  const de = periodo ? periodo.de : "1970-01-01T00:00:00.000Z";
  const ate = periodo ? periodo.ate : new Date().toISOString();

  const eventos: EventoReal[] = [];
  const idsDeArquivos = new Set<string>();

  // --- publicações e agendamentos
  type Pub = { id: string; post_id: string; project_id: string | null; file_id: string | null; platform: string; scheduled_at: string | null; status: string; published_at: string | null; permalink: string | null };
  let pubs: Pub[] = [];
  {
    let q = s.from("editorial_publications").select("id, post_id, project_id, file_id, platform, scheduled_at, status, published_at, permalink").eq("client_id", p.clientId).in("status", ["scheduled", "published"]).limit(300);
    q = projectId ? q.eq("project_id", projectId) : q.or(`and(published_at.gte.${de},published_at.lt.${ate}),and(scheduled_at.gte.${de},scheduled_at.lt.${ate})`);
    const { data, error } = await q;
    if (error) falhou("a agenda de publicações", error);
    pubs = ((data as Pub[]) || []).filter((x) => daMarca(x.project_id));
    pubs.forEach((x) => x.file_id && idsDeArquivos.add(x.file_id));
  }
  const titulosDosPosts: Record<string, string> = {};
  if (pubs.length) {
    const { data, error } = await s.from("editorial_posts").select("id, title").in("id", Array.from(new Set(pubs.map((x) => x.post_id))));
    if (error) falhou("os títulos dos posts", error);
    ((data as Array<{ id: string; title: string }>) || []).forEach((x) => (titulosDosPosts[x.id] = x.title));
  }

  // --- artes entregues pelo Estúdio
  type Trab = { id: string; task_id: string | null; status: string; file_ids: string[] | null; enviado_em: string | null; entrega_status: string | null; tipo: string | null };
  let trabalhos: Trab[] = [];
  {
    let q = s.from("estudio_trabalhos").select("id, task_id, status, file_ids, enviado_em, entrega_status, tipo").eq("client_id", p.clientId).not("enviado_em", "is", null).limit(300);
    if (projectId) q = tarefasDoProjeto.length ? q.in("task_id", tarefasDoProjeto.slice(0, 300)) : q.eq("id", "00000000-0000-0000-0000-000000000000");
    else q = q.gte("enviado_em", de).lt("enviado_em", ate);
    const { data, error } = await q;
    if (error) falhou("as artes entregues", error);
    trabalhos = (data as Trab[]) || [];
    trabalhos.forEach((t) => (t.file_ids || []).slice(0, 1).forEach((f) => idsDeArquivos.add(f)));
  }
  const tarefas: Record<string, { title: string; project_id: string | null }> = {};
  {
    const ids = Array.from(new Set(trabalhos.map((t) => t.task_id).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data, error } = await s.from("tasks").select("id, title, project_id").in("id", ids.slice(0, 300));
      if (error) falhou("as pautas das artes", error);
      ((data as Array<{ id: string; title: string; project_id: string | null }>) || []).forEach((t) => (tarefas[t.id] = { title: t.title, project_id: t.project_id }));
    }
  }

  // --- aprovações e liberações de arquivos
  type Ev = { id: string; file_id: string; event_type: string; created_at: string };
  let eventosDeArquivo: Ev[] = [];
  {
    const tipos = Object.keys(EVENTO_DE_ARQUIVO);
    const { data, error } = await s.from("file_approval_events").select("id, file_id, event_type, created_at").eq("client_id", p.clientId).in("event_type", tipos).gte("created_at", de).lt("created_at", ate).order("created_at", { ascending: true }).limit(400);
    if (error) falhou("o histórico de aprovações", error);
    eventosDeArquivo = (data as Ev[]) || [];
    eventosDeArquivo.forEach((e) => idsDeArquivos.add(e.file_id));
  }
  (p.provasDoGancho || []).forEach((f) => idsDeArquivos.add(f));

  const arquivos: Record<string, Arquivo> = {};
  if (idsDeArquivos.size) {
    const ids = Array.from(idsDeArquivos).slice(0, 600);
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await s.from("files").select("id, file_name, mime_type, storage_bucket, storage_path, client_id, project_id, tags, archived_at").in("id", ids.slice(i, i + 150));
      if (error) {
        falhou("os arquivos das entregas", error);
        break;
      }
      // Arquivo de outro cliente nunca entra (defesa extra além do filtro por client_id).
      ((data as Arquivo[]) || []).filter((a) => a.client_id === p.clientId).forEach((a) => (arquivos[a.id] = a));
    }
  }

  pubs.forEach((x) => {
    const publicado = x.status === "published" && !!x.published_at;
    const quando = (publicado ? x.published_at : x.scheduled_at) || de;
    const rede = ROTULO_DA_PLATAFORMA[x.platform] || x.platform;
    eventos.push({
      id: `editorial_publications:${x.id}`,
      fonte: publicado ? "publicacao" : "agendamento",
      quando,
      titulo: titulosDosPosts[x.post_id] || (x.file_id && arquivos[x.file_id] ? arquivos[x.file_id].file_name : "Post"),
      detalhe: publicado ? `Publicado no ${rede} em ${dataPorExtenso(quando)}` : `Agendado para ${dataPorExtenso(quando)} às ${hora(quando)} no ${rede}`,
      link: publicado ? x.permalink : null,
      imagem: x.file_id ? imagemDoArquivo(arquivos[x.file_id]) : null,
      forte: publicado,
    });
  });

  trabalhos.forEach((t) => {
    const tarefa = t.task_id ? tarefas[t.task_id] : undefined;
    if (!daMarca(tarefa ? tarefa.project_id : null)) return;
    const estado = ENTREGA_DA_ARTE[String(t.entrega_status || "")] || { detalhe: "Entregue em Arquivos", forte: false };
    const arq = (t.file_ids || [])[0];
    eventos.push({
      id: `estudio_trabalhos:${t.id}`,
      fonte: "arte_entregue",
      quando: t.enviado_em || de,
      titulo: (tarefa && tarefa.title) || (arq && arquivos[arq] ? arquivos[arq].file_name : "Arte"),
      detalhe: estado.detalhe,
      imagem: arq ? imagemDoArquivo(arquivos[arq]) : null,
      forte: estado.forte,
    });
  });

  const arquivosNoDocumento = new Set<string>();
  eventosDeArquivo.forEach((e) => {
    const a = arquivos[e.file_id];
    if (!a || ehDocumentoDeEntrega(a) || !daMarca(a.project_id)) return;
    if (projectId && a.project_id !== projectId) return;
    const m = EVENTO_DE_ARQUIVO[e.event_type];
    arquivosNoDocumento.add(a.id);
    eventos.push({ id: `file_approval_events:${e.id}`, fonte: m.fonte, quando: e.created_at, titulo: a.file_name, detalhe: m.detalhe, imagem: imagemDoArquivo(a), forte: m.forte });
  });

  // Provas que a mesa mandou no gancho: só arquivo do cliente, da marca, que ainda não está no documento.
  (p.provasDoGancho || []).forEach((id) => {
    const a = arquivos[id];
    if (!a || ehDocumentoDeEntrega(a) || arquivosNoDocumento.has(id) || !daMarca(a.project_id)) return;
    if (eventos.some((e) => e.imagem && e.imagem.file_id === id)) return;
    eventos.push({ id: `files:${a.id}`, fonte: "arquivo", quando: de, titulo: a.file_name, detalhe: "Arquivo desta entrega", imagem: imagemDoArquivo(a), forte: false });
  });

  // --- relatórios
  {
    let q = s.from("reports").select("id, title, period_start, period_end, status, created_at, project_id").eq("client_id", p.clientId).neq("status", "draft").limit(50);
    q = projectId ? q.eq("project_id", projectId) : q.gte("created_at", de).lt("created_at", ate);
    const { data, error } = await q;
    if (error) falhou("os relatórios", error);
    ((data as Array<{ id: string; title: string; period_start: string | null; period_end: string | null; created_at: string; project_id: string | null }>) || [])
      .filter((r) => daMarca(r.project_id))
      .forEach((r) =>
        eventos.push({
          id: `reports:${r.id}`,
          fonte: "relatorio",
          quando: r.created_at,
          titulo: r.title || "Relatório",
          detalhe: r.period_start && r.period_end ? `Período de ${dataPorExtenso(r.period_start)} a ${dataPorExtenso(r.period_end)}` : null,
        })
      );
  }

  // --- etapas concluídas do projeto
  if (projectId && tarefasDoProjeto.length) {
    const { data, error } = await s.from("tasks").select("id, title, updated_at").eq("project_id", projectId).eq("status", "done").is("deleted_at", null).limit(200);
    if (error) falhou("as etapas concluídas", error);
    ((data as Array<{ id: string; title: string; updated_at: string }>) || []).forEach((t) =>
      eventos.push({ id: `tasks:${t.id}`, fonte: "tarefa", quando: t.updated_at, titulo: t.title, detalhe: "Etapa concluída" })
    );
  }

  // --- organização do Workspace (só a contagem; o Workspace não tem marca: só a principal)
  if (!projectId && daMarca(null) && periodo) {
    const { count, error } = await s.from("workspace_nodes").select("id", { count: "exact", head: true }).eq("client_id", p.clientId).eq("kind", "file").gte("created_at", de).lt("created_at", ate);
    if (error) falhou("o Workspace", error);
    if (count && count > 0) {
      eventos.push({ id: `workspace_nodes:${p.referencia}`, fonte: "workspace", quando: de, titulo: `${count} ${count === 1 ? "arquivo organizado" : "arquivos organizados"} no Workspace`, detalhe: "Materiais recebidos e guardados nas pastas do cliente" });
    }
  }

  // --- ações registradas pelas mesas (só as que o cliente entende)
  {
    const { data, error } = await s.from("mcp_audit_log").select("id, tool_name, created_at").eq("sanitized_input->>client_id", p.clientId).eq("success", true).in("tool_name", Object.keys(ACOES_QUE_O_CLIENTE_ENTENDE)).gte("created_at", de).lt("created_at", ate).limit(50);
    if (error) falhou("o registro de ações", error);
    // Sem projeto no registro: fica só com a marca principal.
    if (daMarca(null)) {
      ((data as Array<{ id: string; tool_name: string; created_at: string }>) || []).forEach((r) =>
        eventos.push({ id: `mcp_audit_log:${r.id}`, fonte: "registro", quando: r.created_at, titulo: ACOES_QUE_O_CLIENTE_ENTENDE[r.tool_name], detalhe: null })
      );
    }
  }

  // --- números: contagens dos eventos e métricas do Instagram (com a data da leitura)
  const numeros: NumeroReal[] = [];
  const publicados = eventos.filter((e) => e.fonte === "publicacao").length;
  const artes = eventos.filter((e) => e.fonte === "arte_entregue").length;
  if (publicados) numeros.push({ rotulo: "Publicações feitas", valor: publicados, fonte: "Agenda do painel" });
  if (artes) numeros.push({ rotulo: "Artes entregues", valor: artes, fonte: "Estúdio da Mesa" });
  if (!projectId && periodo) {
    const contas = await contasDaMarca(s, p.clientId, p.marca, p.projetosDeOutrasMarcas).catch((e) => (falhou("as contas do Instagram", e), null));
    if (contas !== null) {
      let q = s.from("social_post_metrics").select("external_account_id, reach, total_interactions, saved, shares, captured_at, insights_captured_at").eq("client_id", p.clientId).gte("posted_at", de).lt("posted_at", ate).limit(500);
      if (contas.length) q = q.in("external_account_id", contas);
      const { data, error } = contas.length === 0 && p.marca && !p.marca.principal ? { data: [], error: null } : await q;
      if (error) falhou("as métricas do Instagram", error);
      const linhas = (data as Array<{ reach: number | null; total_interactions: number | null; saved: number | null; shares: number | null; captured_at: string | null; insights_captured_at: string | null }>) || [];
      if (linhas.length) {
        const lida = linhas.map((l) => l.insights_captured_at || l.captured_at || "").sort().pop() || "";
        const fonte = `Instagram, leitura de ${dataPorExtenso(lida) || "data não registrada"}`;
        numeros.push({ rotulo: "Posts no Instagram no período", valor: linhas.length, fonte });
        const soma = (k: "reach" | "total_interactions" | "saved" | "shares") => {
          const vals = linhas.map((l) => l[k]).filter((v): v is number => typeof v === "number");
          return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
        };
        const alcance = soma("reach");
        const interacoes = soma("total_interactions");
        const salvos = soma("saved");
        const compart = soma("shares");
        if (alcance != null) numeros.push({ rotulo: "Alcance somado dos posts", valor: alcance, fonte });
        if (interacoes != null) numeros.push({ rotulo: "Interações somadas", valor: interacoes, fonte });
        if (salvos != null) numeros.push({ rotulo: "Salvamentos", valor: salvos, fonte });
        if (compart != null) numeros.push({ rotulo: "Compartilhamentos", valor: compart, fonte });
      }
    }
  }

  eventos.sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : 0));
  return { eventos, numeros, periodo: p.tipo === "projeto" ? null : periodo, titulo, projectId, avisos };
}

/**
 * Contas de Instagram da marca: a principal fica com as que não são de projeto
 * de outra marca; a outra marca só com as do projeto dela. Lista vazia na
 * principal = todas as do cliente.
 */
async function contasDaMarca(s: SupabaseClient, clientId: string, marca: MarcaParaEventos, projetosDeOutrasMarcas: string[]): Promise<string[]> {
  if (!marca) return [];
  const { data, error } = await s.from("project_external_accounts").select("project_id, external_account_id").eq("client_id", clientId).limit(200);
  if (error) throw error;
  const ligacoes = (data as Array<{ project_id: string; external_account_id: string }>) || [];
  if (!marca.principal) return ligacoes.filter((l) => l.project_id === marca.project_id).map((l) => l.external_account_id);
  const deOutras = new Set(ligacoes.filter((l) => projetosDeOutrasMarcas.indexOf(l.project_id) >= 0).map((l) => l.external_account_id));
  if (!deOutras.size) return [];
  const minhas = ligacoes.filter((l) => !deOutras.has(l.external_account_id)).map((l) => l.external_account_id);
  // Principal sem conta própria ligada e com as outras separadas: nenhuma métrica, para não herdar.
  return minhas.length ? Array.from(new Set(minhas)) : ["00000000-0000-0000-0000-000000000000"];
}
