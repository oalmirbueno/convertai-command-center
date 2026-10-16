import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Copy, Download, Film, Flame, Loader2, Scissors, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { copiarTexto } from "@/components/mesa/estudioUtil";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarMesaVideos, chaveDasVersoes } from "@/components/mesa-videos/videosApi";
import { comFormato, FORMATOS_DO_PROJETO } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { janelaDaAmostra, ROTULO_DO_TIPO } from "../../../../supabase/functions/_shared/render-do-editor";
import { srtDasLinhas } from "../../../../supabase/functions/editor-video/ferramentas";
import { chamarEditorVideo, emPreparacao } from "@/lib/editor/api";
import { capitulosEmBlocos, momentosEmBlocos } from "@/lib/editor/julgarEmBlocos";
import { capitulosEm, capitulosParaYoutube, capitulosValemNoYoutube, frasesDoProjeto, projetoDoTrecho, viraisEm } from "@/lib/editor/skills/pecasDaEdicao";
import { formatoDoPedido, linhasDaLegenda, pedirRender, rotuloDoPedido, uidDoClique, useFilaDeRender } from "@/lib/editor/render";
import { tempoFino } from "@/lib/editor/tempo";
import EstadoDaMaquina, { useEstadoDaMaquina } from "./EstadoDaMaquina";
import { aplicarMontando, Subtitulo, TituloDoPainel, type ContextoDoPainel } from "./apoioDosPaineis";

/**
 * Capítulos, momentos virais e exportação (frente EDT, rodada 2).
 * - Capítulos: o Jev acha onde o assunto muda e escolhe o título entre
 *   trechos DITOS; viram marcadores na régua e o texto para o YouTube.
 * - Momentos virais: janelas de 15 a 60 s com nota (Jev); "Criar corte" faz
 *   uma versão nova só com o trecho, em 9:16.
 * - Exportar: render no worker (um ou vários formatos de uma vez), amostra,
 *   legenda .srt e capítulos. A máquina desligada aparece antes do clique.
 */

function baixarTexto(conteudo: string, nome: string, tipo = "text/plain") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const nomeDoArquivo = (t: string) =>
  String(t || "video")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "video";

// ---------------------------------------------------------------- Capítulos e virais

export function PainelDeCapitulos({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const p = ctx.projeto;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const frases = frasesDoProjeto(p);
  const capitulos = p.marcadores.filter((m) => m.tipo === "capitulo").sort((a, b) => a.tempo_s - b.tempo_s);
  const virais = p.marcadores.filter((m) => m.tipo === "viral").sort((a, b) => (b.nota || 0) - (a.nota || 0));

  const acharCapitulos = async () => {
    setOcupado("capitulos");
    try {
      const r = await capitulosEmBlocos(chamarEditorVideo, { clientId, frases, aoAndar: setAndamento });
      aplicarMontando(ctx, "Capítulos", (m) => {
        const n = capitulosEm(m, r.capitulos);
        return n ? `${n} ${n === 1 ? "capítulo" : "capítulos"} na régua.` : "Um assunto só: sem capítulos.";
      });
      if (r.aviso) toast.warning("Capítulos só de uma parte", { description: r.aviso });
    } catch (e) {
      toast.error("Não achei os capítulos agora", { description: emPreparacao(e) ? "Falta publicar a função editor-video." : textoDoErro(e) });
      console.error("[editor] capítulos", e);
    } finally {
      setOcupado(null);
      setAndamento(null);
    }
  };

  const acharVirais = async () => {
    setOcupado("virais");
    try {
      const r = await momentosEmBlocos(chamarEditorVideo, { clientId, titulo: p.titulo, frases, forca: false, virais: true, aoAndar: setAndamento });
      if (r.aviso) toast.warning("Momentos de uma parte da fala", { description: r.aviso });
      aplicarMontando(ctx, "Momentos virais", (m) => {
        const lista = r.virais;
        if (!lista.length) return "Nenhum trecho passou da nota para corte viral.";
        const n = viraisEm(m, lista);
        return `${n} ${n === 1 ? "momento viral" : "momentos virais"} marcados.`;
      });
    } catch (e) {
      toast.error("Não achei os momentos agora", { description: emPreparacao(e) ? "Falta publicar a função editor-video." : textoDoErro(e) });
      console.error("[editor] momentos virais", e);
    } finally {
      setOcupado(null);
      setAndamento(null);
    }
  };

  const criarCorte = async (de: number, ate: number, rotulo: string) => {
    setOcupado(`corte:${de}`);
    try {
      const titulo = `${p.titulo} (corte ${tempoFino(de)})`.slice(0, 120);
      const projeto = comFormato(projetoDoTrecho(p, de, ate, titulo), "9:16");
      await chamarMesaVideos({ acao: "versao_registrar", client_id: clientId, titulo, roteiro_id: p.roteiro_id, nota: `Corte viral: ${rotulo}`.slice(0, 300), estado: "rascunho", projeto });
      void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      toast.success("Corte criado como versão nova", { description: "Em 9:16, com legenda e peças do trecho. Abra no seletor de versão, em cima do editor." });
    } catch (e) {
      toast.error("O corte não foi criado", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const youtube = capitulosParaYoutube(p);
  const validade = capitulosValemNoYoutube(p);

  return (
    <div data-painel="capitulos">
      <TituloDoPainel titulo="Capítulos e virais" ajuda="Capítulos para vídeo longo (YouTube, aula, podcast) e os trechos que valem um corte curto. A IA (Jev) julga o assunto e o potencial; o título do capítulo é sempre um trecho dito, nada inventado. Sem custo para o cliente." />
      {!frases.length && <p className={texto.auxiliar}>Precisa da fala marcada (Timestamp).</p>}
      <div className="flex flex-wrap">
        {/* 16/10/2026: só ícones (nome no aria-label e no title). */}
        <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8 w-8 px-0")} onClick={() => void acharCapitulos()} disabled={!!ocupado || frases.length < 3} aria-label="Achar capítulos" title="Achar capítulos">
          {ocupado === "capitulos" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
        </button>
        <button type="button" className={juntar(botao.icone, "mb-1 disabled:pointer-events-none disabled:opacity-50")} onClick={() => void acharVirais()} disabled={!!ocupado || !frases.length} aria-label="Achar momentos virais" title="Achar momentos virais">
          {ocupado === "virais" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
        </button>
      </div>
      {andamento && (
        <p className={texto.auxiliar} aria-live="polite">
          {andamento}
        </p>
      )}
      {capitulos.length > 0 && (
        <>
          <Subtitulo>Capítulos</Subtitulo>
          <ul className="divide-y divide-border">
            {capitulos.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-1.5 text-[13px]">
                <button type="button" className="mr-2 shrink-0 tabular-nums text-muted-foreground underline" onClick={() => ctx.irParaTempo(c.tempo_s)}>
                  {tempoFino(c.tempo_s)}
                </button>
                <span className="min-w-0 flex-1 truncate">{c.rotulo}</span>
                <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => ctx.onOps([{ op: "remover_marcador", id: c.id }], "Tirar capítulo")} aria-label={`Tirar o capítulo ${c.rotulo}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={juntar(botao.icone, "mt-1 flex")} onClick={() => void copiarTexto(youtube).then((ok) => (ok ? toast.success("Capítulos copiados", { description: "Cole na descrição do YouTube." }) : toast.error("Não deu para copiar aqui", { description: "Baixe pelo botão Capítulos, em Exportar." })))} aria-label="Copiar para o YouTube" title="Copiar para o YouTube">
            <Copy className="h-4 w-4" />
          </button>
          {validade.motivo && <p className={juntar("mt-1 text-[12px] leading-4", validade.valem ? "text-muted-foreground" : "text-warning")}>{validade.motivo}</p>}
        </>
      )}
      {virais.length > 0 && (
        <>
          <Subtitulo>Momentos virais</Subtitulo>
          <ul className="divide-y divide-border">
            {virais.map((v) => (
              <li key={v.id} className="py-1.5 text-[13px]">
                <div className="flex min-w-0 items-center">
                  <button type="button" className="mr-2 shrink-0 tabular-nums text-muted-foreground underline" onClick={() => ctx.irParaTempo(v.tempo_s)}>
                    {tempoFino(v.tempo_s)}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{v.rotulo.replace(/^Viral \d+: /, "")}</span>
                  {v.nota !== null && <span className={juntar(etiqueta, "ml-1 bg-rose-500/10 text-rose-600 dark:text-rose-400")}>{Math.round((v.nota || 0) * 100)}</span>}
                </div>
                <div className="mt-1 flex items-center">
                  <span className={juntar(texto.auxiliar, "mr-auto")}>{v.fim_s ? `${Math.round(v.fim_s - v.tempo_s)} s` : ""}</span>
                  <button type="button" className={juntar(botao.icone, "h-7 w-7 disabled:pointer-events-none disabled:opacity-50")} onClick={() => v.fim_s && void criarCorte(v.tempo_s, v.fim_s, v.rotulo)} disabled={!!ocupado || !v.fim_s} aria-label="Criar corte 9:16" title="Criar corte 9:16">
                    {ocupado === `corte:${v.tempo_s}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => ctx.onOps([{ op: "remover_marcador", id: v.id }], "Tirar momento viral")} aria-label="Tirar este momento">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Exportar

export function PainelDeExportar({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId } = useMesa();
  const p = ctx.projeto;
  const maquina = useEstadoDaMaquina();
  const [formatos, setFormatos] = useState<string[]>([p.formato]);
  const [pedindo, setPedindo] = useState(false);
  const fila = useFilaDeRender(clientId, ctx.versaoId, chamarEditorVideo);
  const legendas = linhasDaLegenda(p);
  const youtube = capitulosParaYoutube(p);

  const alternar = (f: string) => setFormatos((l) => (l.indexOf(f) >= 0 ? l.filter((x) => x !== f) : l.concat([f])));

  const pedir = async (tipo: "render_final" | "amostra") => {
    setPedindo(true);
    try {
      await ctx.salvarAgora();
      if (ctx.estadoDoSalvamento() !== "salvo") throw new Error("O editor não salvou: use Tentar de novo na barra.");
      const lista = tipo === "amostra" ? [p.formato] : formatos;
      for (const f of lista) {
        const janela = tipo === "amostra" ? janelaDaAmostra(ctx.cursor(), ctx.cursor() + 12, p.duracao_s) : null;
        await pedirRender(chamarEditorVideo, { clientId, versaoId: ctx.versaoId, tipo, uid: uidDoClique(), revisao: ctx.revisao(), formato: f === p.formato ? null : f, inicio_s: janela ? janela.inicio_s : undefined, fim_s: janela ? janela.fim_s : undefined });
      }
      maquina.ler();
      toast.success(tipo === "amostra" ? "Amostra na fila" : `${lista.length} ${lista.length === 1 ? "render na fila" : "renders na fila"}`, {
        description:
          maquina.situacao === "ligado"
            ? "A máquina da agência está ligada: começa em instantes."
            : maquina.situacao === "erro"
              ? "Não deu para conferir a máquina agora: o pedido está na fila e roda quando ela estiver ligada."
              : "A máquina da agência está desligada: o pedido espera na fila e roda quando ela ligar.",
      });
    } catch (e) {
      toast.error("Não foi para a fila", { description: emPreparacao(e) ? "A fila de render está em preparação: falta publicar a função editor-video." : textoDoErro(e) });
    } finally {
      setPedindo(false);
    }
  };

  return (
    <div data-painel="exportar">
      <TituloDoPainel titulo="Exportar" />
      <EstadoDaMaquina estado={maquina} />
      <Subtitulo ajuda="Cada formato vira um MP4 (-14 LUFS) na Mídia do cliente. O recorte de cada formato segue o rosto rastreado.">Vídeo final</Subtitulo>
      <div className="flex flex-wrap" role="group" aria-label="Formatos do render">
        {Object.keys(FORMATOS_DO_PROJETO).map((f) => (
          <label key={f} className={juntar(botao.secundario, "mb-1 mr-1 h-8 cursor-pointer px-2.5", formatos.indexOf(f) >= 0 && "border-primary text-primary")}>
            <input type="checkbox" className="mr-1.5 h-3.5 w-3.5 accent-primary" checked={formatos.indexOf(f) >= 0} onChange={() => alternar(f)} />
            {f}
            {f === p.formato ? " (atual)" : ""}
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap">
        <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void pedir("render_final")} disabled={pedindo || !formatos.length || p.duracao_s <= 0} data-exportar-formatos="">
          {pedindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Film className="mr-1.5 h-3.5 w-3.5" />}
          Renderizar {formatos.length > 1 ? `${formatos.length} formatos` : formatos[0] || ""}
        </button>
        {/* 16/10/2026: só ícone; "Renderizar" fica com texto (ação principal, diz quantos formatos). */}
        <button type="button" className={juntar(botao.icone, "mb-1 disabled:pointer-events-none disabled:opacity-50")} onClick={() => void pedir("amostra")} disabled={pedindo || p.duracao_s <= 0} aria-label="Amostra de 12 s no cursor" title="Amostra de 12 s no cursor">
          <Timer className="h-4 w-4" />
        </button>
      </div>
      {fila.pedidos.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {fila.pedidos.slice(0, 8).map((x) => (
            <li key={x.id} className="flex min-w-0 items-center py-1.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate">
                {ROTULO_DO_TIPO[x.tipo]} {formatoDoPedido(x) || ""}: {rotuloDoPedido(x, Date.now(), fila.worker)}
              </span>
              {x.url && (
                <a className={juntar(botao.icone, "h-7 w-7")} href={x.url} target="_blank" rel="noreferrer" aria-label="Baixar MP4" title="Baixar MP4">
                  <Download className="h-3.5 w-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <Subtitulo>Textos do vídeo</Subtitulo>
      <div className="flex flex-wrap">
        {/* 16/10/2026: baixar em ícone; o formato fica pequeno ao lado para os dois não parecerem a mesma ação. */}
        <button type="button" className={juntar(botao.icone, "mb-1 mr-1 w-auto px-1.5 disabled:pointer-events-none disabled:opacity-50")} disabled={!legendas.length} onClick={() => baixarTexto(srtDasLinhas(legendas), `${nomeDoArquivo(p.titulo)}.srt`, "application/x-subrip")} aria-label="Legenda .srt" title="Baixar a legenda (.srt)">
          <Download className="h-4 w-4" />
          <span className="ml-0.5 text-[10px] font-medium">SRT</span>
        </button>
        <button type="button" className={juntar(botao.icone, "mb-1 w-auto px-1.5 disabled:pointer-events-none disabled:opacity-50")} disabled={!youtube} onClick={() => baixarTexto(youtube, `${nomeDoArquivo(p.titulo)}-capitulos.txt`)} aria-label="Capítulos" title="Baixar os capítulos (.txt)">
          <Download className="h-4 w-4" />
          <span className="ml-0.5 text-[10px] font-medium">TXT</span>
        </button>
      </div>
      {!legendas.length && <p className={texto.auxiliar}>Sem legenda na linha do tempo (gere em Legendas e textos).</p>}
    </div>
  );
}
