/**
 * "Pacote para editar" da Mesa Vídeos (aba Edição; Frente V2, 25/09/2026).
 *
 * Junta o que o editor precisa para montar sem caçar arquivo: roteiro, takes
 * organizados (melhores primeiro), legendas (ou a pendência delas), direção de
 * edição (conhecimento-edicao.ts, método Brabo destilado) e referências. Serve
 * a um editor humano ou ao pipeline Remotion local do dono: o edl.json segue o
 * formato dos projetos em Videos/ (version, sources, fps, ranges, grade,
 * overlays, total_duration_s, note).
 *
 * Nada aqui corta, gera ou gasta: é texto montado a partir do que já existe.
 * Puro: sem Deno, sem banco. A tela e a função mesa-videos usam o mesmo.
 */

import { COLUNAS_DOS_BEATS, conhecimentoEdicao, FONTE_BRABO, FONTE_KIT_AUDIOVISUAL } from "./conhecimento-edicao.ts";

export const VERSAO_DO_PACOTE = 1;

export interface TakeDoPacote {
  id: string;
  nome: string;
  nome_original: string;
  tipo: string;
  storage_bucket: string;
  storage_path: string;
  grupo: string | null;
  roteiro_id: string | null;
  cena_ref: string | null;
  melhor: boolean;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  bytes: number | null;
  sha256: string | null;
  /** URL assinada (opcional): vai em links.txt, vence. */
  url?: string | null;
}

export interface CenaDoRoteiroNoPacote {
  ref: string;
  ordem: number;
  titulo: string;
  fala?: string | null;
  visual?: string | null;
}

export interface EntradaDoPacote {
  cliente: { id: string; nome: string };
  titulo: string;
  formato?: string | null;
  fps?: number | null;
  destino?: "editor" | "remotion";
  roteiro?: { id: string; titulo: string; cenas: CenaDoRoteiroNoPacote[] } | null;
  historia?: {
    canvas_id: string;
    nome: string;
    cenas: { numero: number; no_id: string; titulo: string; acao: string; narrativa: string; enquadramento: string; imagem_id: string | null }[];
  } | null;
  takes: TakeDoPacote[];
  /** Pedidos de legenda: o SRT entra quando existir; sem ele, a pendência. */
  legendas?: { arquivo_id: string; estado: string; srt?: string | null }[];
  referencias?: { titulo: string; url?: string | null; nota?: string | null }[];
  /** Nota da equipe para esta peça (vale sobre o método). */
  direcao?: string | null;
  gerado_em: string;
}

export interface PacoteDeEdicao {
  versao: number;
  nome_do_zip: string;
  pendencias: string[];
  /** Caminho no ZIP -> conteúdo de texto. */
  arquivos: Record<string, string>;
  resumo: { takes: number; melhores: number; cenas: number; duracao_melhores_s: number | null };
}

// ------------------------------------------------------------------ utilidades

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const slugDoPacote = (t: string, max = 40) =>
  semAcento(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "") || "pacote";

/** Célula de CSV (vírgula, aspas e quebra de linha protegidas). */
export function celula(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const linhaCsv = (valores: unknown[]) => valores.map(celula).join(",");

const segundos = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);

const numeroDaCena = (t: Pick<TakeDoPacote, "cena_ref">, roteiro: EntradaDoPacote["roteiro"]): number => {
  if (t.cena_ref && roteiro) {
    const c = roteiro.cenas.find((x) => x.ref === t.cena_ref);
    if (c) return c.ordem;
  }
  const m = t.cena_ref ? /(\d{1,3})$/.exec(t.cena_ref) : null;
  return m ? Number(m[1]) : 999;
};

/** Takes na ordem de montar: cena, melhores primeiro, depois nome. Arquivados e entregas ficam fora. */
export function takesNaOrdem(takes: TakeDoPacote[], roteiro: EntradaDoPacote["roteiro"] = null): TakeDoPacote[] {
  return takes
    .filter((t) => t.tipo !== "entrega")
    .slice()
    .sort((a, b) => numeroDaCena(a, roteiro) - numeroDaCena(b, roteiro) || (a.melhor === b.melhor ? 0 : a.melhor ? -1 : 1) || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
}

// ------------------------------------------------------------------ montagem

export function montarPacote(e: EntradaDoPacote): PacoteDeEdicao {
  const roteiro = e.roteiro || null;
  const takes = takesNaOrdem(e.takes || [], roteiro);
  const melhores = takes.filter((t) => t.melhor);
  const legendas = e.legendas || [];
  const referencias = e.referencias || [];
  const fps = typeof e.fps === "number" && e.fps > 0 ? e.fps : null;
  const pendencias: string[] = [];

  if (!takes.length) pendencias.push("Nenhum take no pacote: suba as gravações na aba Acervo.");
  if (!roteiro) pendencias.push("Sem roteiro aprovado ligado: a ordem das cenas sai dos nomes e grupos dos takes.");
  if (roteiro) {
    roteiro.cenas
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((c) => {
        const daCena = takes.filter((t) => t.cena_ref === c.ref);
        if (!daCena.length) pendencias.push(`Cena ${c.ordem} (${c.titulo || "sem título"}) sem take ligado.`);
        else if (!daCena.some((t) => t.melhor)) pendencias.push(`Cena ${c.ordem} (${c.titulo || "sem título"}) sem melhor take marcado.`);
      });
  } else if (takes.length && !melhores.length) {
    pendencias.push("Nenhum melhor take marcado: o editor escolhe entre todos.");
  }
  const semLegenda = takes.filter((t) => t.tipo !== "gerado" && !legendas.some((l) => l.arquivo_id === t.id && l.srt));
  if (semLegenda.length) pendencias.push(`${semLegenda.length} ${semLegenda.length === 1 ? "take sem legenda pronta" : "takes sem legenda pronta"} (pedido de transcrição preparado ou a preparar).`);
  if (!fps) pendencias.push("FPS da composição não informado: confira no arquivo antes de montar.");
  pendencias.push("Sincronia de áudio não medida pelo painel: confira no editor (timecode ou áudio guia).");

  const titulo = e.titulo.trim() || (roteiro ? roteiro.titulo : "Vídeo");
  const nomeDoZip = `pacote-${slugDoPacote(e.cliente.nome, 24)}-${slugDoPacote(titulo, 32)}.zip`;
  const arquivos: Record<string, string> = {};

  // Roteiro
  const linhasDoRoteiro: string[] = [`# Roteiro: ${roteiro ? roteiro.titulo : "sem roteiro ligado"}`, ""];
  if (roteiro) {
    roteiro.cenas
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((c) => {
        linhasDoRoteiro.push(`## Cena ${c.ordem}: ${c.titulo || "sem título"}`);
        if (c.fala) linhasDoRoteiro.push("", `Fala: ${c.fala}`);
        if (c.visual) linhasDoRoteiro.push("", `Visual: ${c.visual}`);
        linhasDoRoteiro.push("");
      });
  } else {
    linhasDoRoteiro.push("Nenhum roteiro aprovado da Mesa Roteiros foi ligado a este pacote.", "");
  }
  if (e.historia && e.historia.cenas.length) {
    linhasDoRoteiro.push(`## História do Canvas: ${e.historia.nome}`, "");
    e.historia.cenas.forEach((c) => {
      linhasDoRoteiro.push(`${c.numero}. ${c.titulo || "Cena"}${c.acao ? `: ${c.acao}` : ""}${c.narrativa ? ` (narrativa: ${c.narrativa})` : ""}${c.imagem_id ? "" : " [sem foto]"}`);
    });
    linhasDoRoteiro.push("");
  }
  arquivos["roteiro.md"] = linhasDoRoteiro.join("\n");

  // Takes
  const linhasDeTakes = [linhaCsv(["take", "arquivo_original", "cena", "grupo", "melhor", "duracao_s", "resolucao", "tipo", "sha256", "caminho_no_storage"])];
  takes.forEach((t) => {
    linhasDeTakes.push(
      linhaCsv([
        t.nome,
        t.nome_original,
        t.cena_ref || "",
        t.grupo || "",
        t.melhor ? "sim" : "",
        segundos(t.duracao_s) ?? "",
        t.largura && t.altura ? `${t.largura}x${t.altura}` : "",
        t.tipo,
        t.sha256 || "",
        `${t.storage_bucket}/${t.storage_path}`,
      ]),
    );
  });
  arquivos["takes.csv"] = linhasDeTakes.join("\n");

  // Decupagem (uma linha por cena do roteiro; tempos provisórios até conferir no áudio)
  const linhasDeBeats = [linhaCsv(COLUNAS_DOS_BEATS as unknown as string[])];
  if (roteiro) {
    roteiro.cenas
      .slice()
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((c) => {
        const melhor = takes.find((t) => t.cena_ref === c.ref && t.melhor) || takes.find((t) => t.cena_ref === c.ref) || null;
        linhasDeBeats.push(linhaCsv([`b${c.ordem}`, "", "", c.fala || c.titulo, "", "", "", "", c.visual || "", "", "", "", melhor ? melhor.nome : "", "", "", "provisorio"]));
      });
  }
  arquivos["decupagem.csv"] = linhasDeBeats.join("\n");

  // Direção
  const k = conhecimentoEdicao("pacote");
  arquivos["direcao.md"] = [
    `# Direção de edição: ${titulo}`,
    "",
    e.direcao && e.direcao.trim() ? `## Desta peça (vale sobre o método)\n\n${e.direcao.trim()}\n` : "## Desta peça\n\nSem nota da equipe.\n",
    `Formato: ${e.formato || "não informado"}. FPS: ${fps || "conferir no arquivo"}. Destino: ${e.destino === "remotion" ? "pipeline Remotion local" : "editor humano"}.`,
    "",
    "## Método",
    "",
    k.texto,
    "",
    `Fontes do método: ${FONTE_BRABO.nome}, de ${FONTE_BRABO.autor} (${FONTE_BRABO.licenca}); ${FONTE_KIT_AUDIOVISUAL.nome}.`,
  ].join("\n");

  // Referências
  arquivos["referencias.md"] = [
    "# Referências",
    "",
    ...(referencias.length ? referencias.map((r) => `- ${r.titulo}${r.url ? ` ${r.url}` : ""}${r.nota ? `: ${r.nota}` : ""}`) : ["Nenhuma referência escolhida."]),
  ].join("\n");

  // Legendas
  legendas
    .filter((l) => l.srt)
    .forEach((l) => {
      const t = takes.find((x) => x.id === l.arquivo_id);
      if (t) arquivos[`legendas/${t.nome.replace(/\.[a-z0-9]{2,5}$/i, "")}.srt`] = String(l.srt);
    });
  if (semLegenda.length) arquivos["legendas/PENDENTE.txt"] = `Sem legenda pronta:\n${semLegenda.map((t) => `- ${t.nome}`).join("\n")}\n`;

  // EDL inicial no formato dos projetos Remotion do dono (take inteiro; o corte fino é do editor).
  const fontes: Record<string, string> = {};
  const ranges: { source: string; start: number; end: number }[] = [];
  let total = 0;
  let semDuracao = false;
  (melhores.length ? melhores : []).forEach((t) => {
    const chave = slugDoPacote(t.nome.replace(/\.[a-z0-9]{2,5}$/i, ""), 40);
    fontes[chave] = t.nome;
    const d = segundos(t.duracao_s);
    if (d === null) {
      semDuracao = true;
      return;
    }
    ranges.push({ source: chave, start: 0, end: d });
    total += d;
  });
  arquivos["edl.json"] = JSON.stringify(
    {
      version: 1,
      sources: fontes,
      fps: fps || 25,
      ranges,
      grade: "none",
      overlays: [],
      total_duration_s: Math.round(total * 100) / 100,
      note: `Primeira montagem com os melhores takes inteiros, na ordem das cenas. Cortar no editor.${semDuracao ? " Há take sem duração lida: fora dos ranges." : ""}${fps ? "" : " FPS 25 provisório: confira no arquivo."}`,
    },
    null,
    1,
  );

  // Links (URLs vencem)
  const comUrl = takes.filter((t) => t.url);
  if (comUrl.length) arquivos["links.txt"] = `Links para baixar os takes (vencem em 24 horas):\n${comUrl.map((t) => `${t.nome}\t${t.url}`).join("\n")}\n`;

  const manifesto = {
    versao: VERSAO_DO_PACOTE,
    gerado_em: e.gerado_em,
    cliente: e.cliente,
    titulo,
    formato: e.formato || null,
    fps,
    destino: e.destino || "editor",
    roteiro_id: roteiro ? roteiro.id : null,
    canvas_id: e.historia ? e.historia.canvas_id : null,
    takes: takes.map((t) => ({ id: t.id, nome: t.nome, cena_ref: t.cena_ref, melhor: t.melhor, storage: `${t.storage_bucket}/${t.storage_path}`, sha256: t.sha256 })),
    pendencias,
    direcao_blocos: k.ids,
  };
  arquivos["pacote.json"] = JSON.stringify(manifesto, null, 1);

  arquivos["LEIA-ME.md"] = [
    `# Pacote para editar: ${titulo}`,
    "",
    `Cliente: ${e.cliente.nome}. Gerado em ${e.gerado_em.slice(0, 10)} pela Mesa Vídeos.`,
    "",
    "- roteiro.md: o roteiro aprovado e a história do Canvas.",
    "- takes.csv: os takes na ordem de montar (melhores primeiro em cada cena).",
    "- decupagem.csv: uma linha por beat para preencher com os tempos reais.",
    "- direcao.md: a direção de edição (método Brabo destilado e a nota da equipe).",
    "- edl.json: primeira montagem no formato dos projetos Remotion.",
    "- legendas/: SRT prontos ou a lista do que falta.",
    "- links.txt: onde baixar os arquivos (quando incluído).",
    "",
    "## Pendências",
    "",
    ...pendencias.map((p) => `- ${p}`),
    "",
    "O original de cada gravação nunca foi alterado. Take gerado por IA está marcado como gerado.",
  ].join("\n");

  const duracaoMelhores = melhores.reduce((s, t) => s + (segundos(t.duracao_s) || 0), 0);
  return {
    versao: VERSAO_DO_PACOTE,
    nome_do_zip: nomeDoZip,
    pendencias,
    arquivos,
    resumo: {
      takes: takes.length,
      melhores: melhores.length,
      cenas: roteiro ? roteiro.cenas.length : e.historia ? e.historia.cenas.length : 0,
      duracao_melhores_s: melhores.length ? Math.round(duracaoMelhores * 100) / 100 : null,
    },
  };
}
