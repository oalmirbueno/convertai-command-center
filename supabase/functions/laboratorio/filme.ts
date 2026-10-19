/**
 * laboratorio: nó Filme (v2, ESPEC-LABORATORIO-v2.md). O "Filme cinematográfico" da Mesa Identidade
 * dentro do Laboratório, reaproveitando a função mesa-motion (mesmas ações que a Mesa Identidade usa
 * em src/components/mesa-identidade/rodadaDoCompletar.ts e videosDaMarca.ts):
 *
 *   rodar      → filme_criar (tipo filme_marca) → filme_salvar (contexto do fluxo) → storyboards_gerar (IA, 3)
 *                O nó fica 'aguardando' com os 3 storyboards até o dono escolher.
 *   escolher   → storyboard_escolher → cena_pedir (render final de cada cena animada, fila do worker, sem IA)
 *   acompanhar → filme_ler (sincroniza os renders) → montar (quando todas as cenas estão prontas)
 *                → render_status (o vídeo final pronto, com o link de 1 h)
 *
 * A chamada vai com a sessão de quem pediu (como mesa-publicidade → mesa-foto e o MCP → mesas): a
 * mesa-motion confere equipe e acesso ao cliente pelo JWT da pessoa; a chave de serviço não passa
 * no identificar dela. O cliente é obrigatório: o filme usa a marca dele (o Livre não tem marca).
 * Planos de vídeo (tipo "gerado" ou "real") não renderizam aqui: o nó para e diz o que falta.
 */
import { ErroHttp } from "./comum.ts";

export type ChamarMotion = (acao: string, corpo: Record<string, unknown>) => Promise<Record<string, unknown>>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);

/** Chama a mesa-motion como a pessoa (a resposta pode vir com fôlego: espaços antes do JSON). */
export function chamadorDaMesaMotion(token: string): ChamarMotion {
  return async (acao, corpo) => {
    let res: Response;
    try {
      res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mesa-motion`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "Content-Type": "application/json", "x-client-info": "laboratorio-filme" },
        body: JSON.stringify({ ...corpo, acao }),
        redirect: "error",
        signal: AbortSignal.timeout(330_000),
      });
    } catch {
      throw new ErroHttp(504, "mesa_motion_sem_resposta", "A Mesa Motion não respondeu a tempo. Confira o filme antes de pedir de novo.");
    }
    const texto = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      const lido = JSON.parse(texto.trim());
      data = lido && typeof lido === "object" && !Array.isArray(lido) ? lido : null;
    } catch { /* corpo não é JSON */ }
    if (!data) throw new ErroHttp(502, "mesa_motion_sem_resposta", "A Mesa Motion respondeu sem dados.");
    if (typeof data.error === "string") {
      const status = Number(data.status_http) || (res.status >= 400 ? res.status : 502);
      const { error: _e, mensagem, ...resto } = data;
      throw new ErroHttp(status, String(data.error), String(mensagem || "A Mesa Motion recusou o pedido."), resto);
    }
    if (!res.ok) throw new ErroHttp(res.status, "mesa_motion_falhou", "A Mesa Motion recusou o pedido.");
    return data;
  };
}

// ------------------------------------------------------------------ saída do nó

export type EtapaDoFilme = "escolher" | "renderizando" | "montando" | "pronto" | "parado";
export type StoryboardResumo = { indice: number; titulo: string; resumo: string; cenas: number; duracao_s: number; planos_de_video: number; imagens: never[] };
export type VideoDoFilme = { formato: string; url: string | null; path: string };
export type SaidaDoFilme = {
  texto: string;
  filme_id: string;
  client_id: string;
  formatos: string[];
  etapa: EtapaDoFilme;
  storyboards: StoryboardResumo[];
  storyboard_escolhido: number | null;
  render: { progresso: number; prontas: number; total: number; faltando: string[]; montagem: Record<string, string> };
  render_progresso: number;
  videos: VideoDoFilme[];
  video_url: string;
  video_path: string;
  avisos: string[];
  [extra: string]: unknown;
};

/** Os storyboards da mesa-motion (conceito, resumo, cenas) no formato do nó. Sem imagens: são roteiros. */
export function resumoDosStoryboards(filme: unknown): StoryboardResumo[] {
  return lista(obj(filme).storyboards).slice(0, 3).map((s, i) => {
    const o = obj(s);
    const cenas = lista(o.cenas).map(obj);
    return {
      indice: i,
      titulo: txt(o.conceito, 200) || `Storyboard ${i + 1}`,
      resumo: txt(o.resumo, 1200),
      cenas: cenas.length,
      duracao_s: Math.round(cenas.reduce((s2, c) => s2 + num(c.duracao_s), 0)),
      planos_de_video: cenas.filter((c) => c.tipo_plano && c.tipo_plano !== "hf").length,
      imagens: [],
    };
  });
}

const renderVazio = () => ({ progresso: 0, prontas: 0, total: 0, faltando: [] as string[], montagem: {} as Record<string, string> });

export function saidaInicialDoFilme(o: { filme: unknown; clientId: string; formatos: string[]; avisos?: string[] }): SaidaDoFilme {
  const f = obj(o.filme);
  const storyboards = resumoDosStoryboards(f);
  return {
    texto: `${storyboards.length} storyboards prontos. Escolha um no nó para renderizar o filme.`,
    filme_id: String(f.id || ""),
    client_id: o.clientId,
    formatos: o.formatos,
    etapa: "escolher",
    storyboards,
    storyboard_escolhido: null,
    render: renderVazio(),
    render_progresso: 0,
    videos: [],
    video_url: "",
    video_path: "",
    avisos: o.avisos || [],
  };
}

/** O que o fluxo sabe da marca vira o BRAND do filme (sem IA): essência pela ideia, promessa e público pela oferta. */
export function brandDoFluxo(o: { ideia: string; oferta: Record<string, unknown> | null; textos: string[] }): Record<string, unknown> {
  const of = o.oferta || {};
  return {
    essencia: (o.ideia || o.textos[0] || "").slice(0, 300),
    publico: txt(of.publico, 300),
    promessa: txt(of.promessa, 240),
  };
}

// ------------------------------------------------------------------ rodar (3 storyboards)

export async function rodarFilme(motion: ChamarMotion, o: {
  clientId: string;
  nome: string;
  ideia: string;
  textos: string[];
  oferta: Record<string, unknown> | null;
  formatos: string[];
  modeloId: string;
}): Promise<{ saida: SaidaDoFilme; custo: number }> {
  const c = await motion("filme_criar", { client_id: o.clientId, nome: o.nome.slice(0, 120), tipo: "filme_marca", formatos: o.formatos });
  const filmeId = String(obj(c.filme).id || "");
  if (!filmeId) throw new ErroHttp(502, "filme_nao_criado", "A Mesa Motion não devolveu o filme.");
  try {
    await motion("filme_salvar", {
      filme_id: filmeId,
      entrevista: { observacoes: o.textos.join("\n").slice(0, 1500) },
      brand: brandDoFluxo(o),
      modelo: o.modeloId,
      insumos: { notas: "Criado pelo Laboratório (nó Filme)." },
    });
    const sb = await motion("storyboards_gerar", { filme_id: filmeId, modelo_id: o.modeloId, pedido: (o.ideia || o.textos.join(" ")).slice(0, 600) });
    const saida = saidaInicialDoFilme({ filme: sb.filme, clientId: o.clientId, formatos: o.formatos });
    if (!saida.storyboards.length) throw new ErroHttp(502, "storyboards_vazios", "A Mesa Motion não devolveu storyboards.");
    return { saida, custo: num(sb.custo_usd) };
  } catch (err) {
    // Sem storyboards o filme não serve: arquiva (não apaga) para não sobrar filme vazio na lista.
    await motion("filme_arquivar", { filme_id: filmeId, arquivar: true }).catch(() => null);
    throw err;
  }
}

// ------------------------------------------------------------------ escolher (render das cenas)

/**
 * Marca do pedido na fila (a mesa-motion exige ^[A-Za-z0-9_-]{8,80}$). Fixa por execução e cena: pedir
 * de novo devolve o mesmo pedido (ja_existia) em vez de renderizar duas vezes; o mesmo vale para montar.
 */
export const uidDoPedido = (base: string) => `lab-${base}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80).padEnd(8, "0");

export async function escolherStoryboard(motion: ChamarMotion, saida: SaidaDoFilme, indice: number, marca: string): Promise<SaidaDoFilme> {
  if (!saida.filme_id) throw new ErroHttp(409, "filme_sem_storyboards", "Rode o nó Filme antes de escolher.");
  if (saida.etapa !== "escolher") throw new ErroHttp(409, "storyboard_ja_escolhido", "O storyboard deste filme já foi escolhido; rode o nó de novo para outros 3.");
  if (!Number.isInteger(indice) || indice < 0 || indice >= saida.storyboards.length) throw new ErroHttp(400, "indice_invalido", `Escolha um storyboard de 1 a ${saida.storyboards.length}.`);
  const r = await motion("storyboard_escolher", { filme_id: saida.filme_id, indice });
  const cenas = lista(obj(r.filme).cenas).map(obj);
  const faltando: string[] = [];
  let pedidas = 0;
  for (let i = 0; i < cenas.length; i++) {
    const c = cenas[i];
    if (c.tipo_plano && c.tipo_plano !== "hf") {
      if (!obj(c.arquivo).path) faltando.push(`Cena ${i + 1} é plano de vídeo: precisa do vídeo (gerado ou real) escolhido no filme.`);
      continue;
    }
    try {
      await motion("cena_pedir", { filme_id: saida.filme_id, cena_id: c.id, modo: "final", formatos: saida.formatos, uid: uidDoPedido(`${marca}-${String(c.id || i)}`) });
      pedidas += 1;
    } catch (err) {
      faltando.push(`Cena ${i + 1}: ${err instanceof Error ? err.message : "não entrou na fila"}`);
    }
  }
  const total = cenas.filter((c) => !c.tipo_plano || c.tipo_plano === "hf").length;
  const parado = pedidas === 0;
  return {
    ...saida,
    storyboard_escolhido: indice,
    etapa: parado ? "parado" : "renderizando",
    render: { ...renderVazio(), total, faltando },
    render_progresso: 0,
    texto: parado
      ? `Storyboard ${indice + 1} escolhido, mas nenhuma cena entrou na fila: ${faltando[0] || "sem cenas animadas"}.`
      : `Storyboard ${indice + 1} escolhido. ${pedidas} de ${total} cenas na fila de render${faltando.length ? `; ${faltando.length} pendência(s)` : ""}.`,
  };
}

// ------------------------------------------------------------------ acompanhar (montar e o vídeo final)

/** Cenas animadas com o render final pronto em todos os formatos (os renders vêm do filme_ler). */
export function andamentoDasCenas(filme: unknown, formatos: string[]): { total: number; prontas: number; planosSemVideo: number } {
  const f = obj(filme);
  const cenas = lista(f.cenas).map(obj);
  const renders = lista(f.renders).map(obj);
  const hf = cenas.filter((c) => !c.tipo_plano || c.tipo_plano === "hf");
  const prontas = hf.filter((c) => formatos.every((fmt) => renders.some((r) => r.cena_id === c.id && r.modo === "final" && r.formato === fmt && r.estado === "pronto"))).length;
  const planosSemVideo = cenas.filter((c) => c.tipo_plano && c.tipo_plano !== "hf" && !obj(c.arquivo).path).length;
  return { total: hf.length, prontas, planosSemVideo };
}

/** Os renders finais da montagem (render_status.finais): prontos com link, ou o primeiro erro. */
export function videosDaMontagem(rs: Record<string, unknown>, formatos: string[]): { videos: VideoDoFilme[]; erro: string | null; prontos: boolean } {
  const finais = lista(rs.finais).map(obj);
  const links = obj(rs.links);
  const videos: VideoDoFilme[] = [];
  let erro: string | null = null;
  for (const fmt of formatos) {
    const doFormato = finais.filter((p) => obj(p.entrada).formato === fmt);
    const pronto = doFormato.find((p) => p.estado === "pronto" && typeof p.saida_path === "string");
    if (pronto) {
      const path = String(pronto.saida_path);
      videos.push({ formato: fmt, path, url: typeof links[path] === "string" ? String(links[path]) : null });
      continue;
    }
    const falhou = doFormato.find((p) => p.estado === "erro" || p.estado === "cancelado");
    if (falhou && !erro) erro = `O render final ${fmt} ${falhou.estado === "cancelado" ? "foi cancelado" : "falhou"}${txt(falhou.erro_mensagem, 200) ? `: ${txt(falhou.erro_mensagem, 200)}` : ""}.`;
  }
  return { videos, erro, prontos: videos.length === formatos.length && formatos.length > 0 };
}

export type Acompanhamento = { saida: SaidaDoFilme; status: "aguardando" | "pronto" | "erro"; erro?: string };

/** Um passo do acompanhamento (sem laço): sincroniza, pede a montagem quando dá, e lê o vídeo final. */
export async function acompanharFilme(motion: ChamarMotion, saida: SaidaDoFilme, marca: string): Promise<Acompanhamento> {
  if (!saida.filme_id || saida.etapa === "escolher") return { saida, status: "aguardando" };
  if (saida.etapa === "renderizando" || saida.etapa === "parado") {
    const l = await motion("filme_ler", { filme_id: saida.filme_id });
    const a = andamentoDasCenas(l.filme, saida.formatos);
    const progresso = a.total ? Math.round((a.prontas / a.total) * 80) : 0;
    const render = { ...saida.render, total: a.total, prontas: a.prontas, progresso };
    // Montagem já pedida (outra aba, ou pela Mesa): segue para ela em vez de montar de novo.
    const jaPedidos = obj(obj(obj(l.filme).montagem).pedidos);
    if (Object.keys(jaPedidos).length) {
      const montagem: Record<string, string> = {};
      for (const [k, v] of Object.entries(jaPedidos)) montagem[k] = String(v);
      return { saida: { ...saida, etapa: "montando", render: { ...render, montagem, faltando: [] }, render_progresso: 85, texto: "Montando o filme (render final na fila)." }, status: "aguardando" };
    }
    if (a.total === 0 || a.prontas < a.total) {
      return { saida: { ...saida, render, render_progresso: progresso, texto: `Renderizando: ${a.prontas} de ${a.total} cenas prontas.` }, status: "aguardando" };
    }
    if (a.planosSemVideo > 0) {
      const faltando = [`${a.planosSemVideo} plano(s) de vídeo sem o vídeo escolhido: escolha no filme para montar.`];
      return { saida: { ...saida, etapa: "parado", render: { ...render, faltando }, render_progresso: progresso, texto: "Cenas prontas; a montagem espera os planos de vídeo." }, status: "aguardando" };
    }
    try {
      const m = await motion("montar", { filme_id: saida.filme_id, uid: uidDoPedido(`${marca}-montar`) });
      const montagem: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(m.pedidos))) montagem[k] = String(v);
      return { saida: { ...saida, etapa: "montando", render: { ...render, montagem, faltando: [] }, render_progresso: 85, texto: "Cenas prontas. Montando o filme (render final na fila)." }, status: "aguardando" };
    } catch (err) {
      if (err instanceof ErroHttp && err.codigo === "cenas_faltando") {
        const faltando = lista(err.extra.faltando).map((x) => String(x)).slice(0, 12);
        return { saida: { ...saida, etapa: "parado", render: { ...render, faltando }, render_progresso: progresso, texto: `A montagem espera: ${faltando[0] || err.message}` }, status: "aguardando" };
      }
      throw err;
    }
  }
  // montando ou pronto: lê os renders finais (no pronto, só renova os links de 1 h).
  const rs = await motion("render_status", { filme_id: saida.filme_id });
  const v = videosDaMontagem(rs, saida.formatos);
  if (v.erro) return { saida: { ...saida, etapa: "parado", render: { ...saida.render, faltando: [v.erro] }, texto: v.erro }, status: "erro", erro: v.erro };
  if (!v.prontos) return { saida: { ...saida, render_progresso: 90, texto: "Montando o filme: o render final ainda não terminou." }, status: "aguardando" };
  const principal = v.videos[0];
  return {
    saida: {
      ...saida,
      etapa: "pronto",
      videos: v.videos,
      video_url: principal.url || "",
      video_path: principal.path,
      render: { ...saida.render, progresso: 100, faltando: [] },
      render_progresso: 100,
      texto: `Filme pronto (${v.videos.map((x) => x.formato).join(" e ")}).`,
    },
    status: "pronto",
  };
}
