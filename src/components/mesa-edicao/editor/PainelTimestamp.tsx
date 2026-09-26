import { useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { usePedidos } from "@/components/mesa-videos/videosApi";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { custoDoTimestamp, juntarPartes, linhasDeLegenda, PROVEDORES_DE_TIMESTAMP, srtDasLinhas, type PalavraComTempo } from "../../../../supabase/functions/editor-video/ferramentas";
import { extrairAudio, partesDoAudio, suportaExtrairAudio, wavDe } from "@/lib/editor/audio";
import { chamarEditorVideo, emPreparacao, novoId, subirDoEditor } from "@/lib/editor/api";
import { segmentosDoSrt } from "@/lib/editor/transcricao";
import { lerFalaDaEntrada } from "@/lib/editor/fala";
import { aplicarOperacao, type Operacao } from "@/lib/editor/operacoes";
import { proporSkill } from "@/lib/editor/skills";
import { tempoFino } from "@/lib/editor/tempo";

/**
 * Botão Timestamp (frente V-B): manda SÓ o áudio (tirado aqui, mono 16 kHz)
 * e recebe a marcação palavra por palavra (e letra por letra quando o
 * provedor dá: alinhamento forçado). Sem legenda: transcreve (Whisper, em
 * partes de ~60 s com o início de cada parte somado nas palavras). Com
 * legenda ou roteiro: alinha o texto dado ao áudio. Custo antes, clique do
 * dono, resultado em linhas prontas (copiar texto ou SRT) e "Mandar para o
 * editor" (fala guardada no projeto, versionada, base das legendas e dos cortes).
 */

type Fase = { tipo: "parado" } | { tipo: "rodando"; texto: string } | { tipo: "pronto"; palavras: PalavraComTempo[]; letras: number; provedor: string; custo: number } | { tipo: "erro"; texto: string } | { tipo: "em_preparacao"; texto: string };

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function copiar(t: string) {
  try {
    void navigator.clipboard.writeText(t).then(() => toast.success("Copiado"));
  } catch {
    toast.error("Não deu para copiar aqui.");
  }
}

export default function PainelTimestamp({ projeto, urls, onAplicarProjeto }: { projeto: ProjetoDeEdicao; urls: Record<string, string>; onAplicarProjeto: (p: ProjetoDeEdicao, rotulo: string) => void }) {
  const { clientId } = useMesa();
  const pedidosQ = usePedidos(clientId);
  const fontes = Object.keys(projeto.fontes).filter((k) => projeto.fontes[k].midia !== "imagem");
  const [fonte, setFonte] = useState(fontes[0] || "");
  const [textoDado, setTextoDado] = useState("");
  const [fase, setFase] = useState<Fase>({ tipo: "parado" });
  const [confirmando, setConfirmando] = useState(false);
  const cancelado = useRef(false);
  const f = fonte ? projeto.fontes[fonte] : null;
  const modo = textoDado.trim().length > 1 ? "alinhar" : "transcrever";
  const duracao = f && f.duracao_s ? f.duracao_s : 0;
  const custo = custoDoTimestamp(modo, duracao);
  const provedor = modo === "alinhar" ? PROVEDORES_DE_TIMESTAMP.alinhamento.rotulo : PROVEDORES_DE_TIMESTAMP.whisper.rotulo;

  // Legenda que já veio da Entrada (pedido de transcrever/legendar com SRT) para esta fonte.
  const srtDaEntrada = useMemo(() => {
    if (!f || !f.arquivo_id) return null;
    const p = ((pedidosQ.data && pedidosQ.data.itens) || []).find((x: any) => x.alvo && x.alvo.arquivo_id === f.arquivo_id && x.resultado && typeof x.resultado.srt === "string");
    return p ? String((p as any).resultado.srt) : null;
  }, [f, pedidosQ.data]);

  // Fala que a Entrada já marcou para este arquivo (guardada no navegador): entra de graça.
  const falaDaEntrada = f && f.arquivo_id ? lerFalaDaEntrada(clientId, f.arquivo_id) : null;

  if (!fontes.length) return <EstadoVazio compacto icone={<Timer className="h-5 w-5" />} titulo="Sem vídeo ou áudio no projeto." descricao="Ponha um clipe na linha do tempo." />;

  const rodar = async () => {
    setConfirmando(false);
    if (!f || !urls[fonte]) return setFase({ tipo: "erro", texto: "A mídia ainda não abriu aqui. Espere um instante." });
    if (!suportaExtrairAudio()) return setFase({ tipo: "erro", texto: "Este navegador não tira o áudio do vídeo. Use Chrome, Edge ou Safari atualizados." });
    cancelado.current = false;
    const referencia = novoId();
    try {
      const audio = await extrairAudio(urls[fonte], (t) => setFase({ tipo: "rodando", texto: t }));
      if (modo === "transcrever") {
        const partes = partesDoAudio(audio.amostras, audio.taxa);
        const juntas: PalavraComTempo[][] = [];
        let gasto = 0;
        for (const p of partes) {
          if (cancelado.current) throw new Error("Parado. O que já foi marcado não foi guardado.");
          setFase({ tipo: "rodando", texto: `Marcando parte ${p.n + 1} de ${partes.length}` });
          const caminho = await subirDoEditor(clientId, "audio", wavDe(audio.amostras.subarray(p.de, p.ate), audio.taxa), "wav");
          const dur = p.fim_s - p.inicio_s;
          const r = await chamarEditorVideo<{ palavras: PalavraComTempo[]; custo_usd: number }>({
            acao: "timestamp_parte",
            client_id: clientId,
            audio_path: caminho,
            inicio_s: p.inicio_s,
            duracao_s: dur,
            idioma: "pt",
            referencia_id: referencia,
            custo_maximo_usd: custoDoTimestamp("transcrever", dur),
          });
          juntas.push(r.palavras || []);
          gasto += Number(r.custo_usd) || 0;
        }
        setFase({ tipo: "pronto", palavras: juntarPartes(juntas), letras: 0, provedor: PROVEDORES_DE_TIMESTAMP.whisper.modelo, custo: gasto });
      } else {
        setFase({ tipo: "rodando", texto: "Subindo o áudio" });
        const caminho = await subirDoEditor(clientId, "audio", wavDe(audio.amostras, audio.taxa), "wav");
        const ini = await chamarEditorVideo<{ pedido: Record<string, string> }>({
          acao: "alinhar_iniciar",
          client_id: clientId,
          audio_path: caminho,
          texto: textoDado,
          duracao_s: audio.duracao_s,
          referencia_id: referencia,
          custo_maximo_usd: custoDoTimestamp("alinhar", audio.duracao_s),
        });
        for (let k = 0; k < 300; k++) {
          if (cancelado.current) throw new Error("Parado. O alinhamento continua no provedor e não será cobrado aqui de novo.");
          setFase({ tipo: "rodando", texto: `Alinhando o texto ao áudio (${k * 3} s)` });
          await esperar(3000);
          const r = await chamarEditorVideo<{ situacao: string; palavras?: PalavraComTempo[]; letras?: PalavraComTempo[]; custo_usd?: number }>({
            acao: "alinhar_andamento",
            client_id: clientId,
            pedido: ini.pedido,
            referencia_id: referencia,
            duracao_s: audio.duracao_s,
          });
          if (r.situacao === "pronto") {
            setFase({ tipo: "pronto", palavras: r.palavras || [], letras: (r.letras || []).length, provedor: "alinhamento", custo: Number(r.custo_usd) || 0 });
            return;
          }
        }
        throw new Error("O alinhamento demorou demais. Tente de novo mais tarde.");
      }
    } catch (e) {
      if (emPreparacao(e)) setFase({ tipo: "em_preparacao", texto: "O Timestamp está em preparação: falta publicar a função editor-video." });
      else setFase({ tipo: "erro", texto: textoDoErro(e) });
    }
  };

  const mandar = (legendar: boolean) => {
    if (fase.tipo !== "pronto" || !f) return;
    const anterior = projeto.transcricoes[fonte];
    const op: Operacao = {
      op: "transcricao",
      fonte,
      transcricao: { segmentos: fase.palavras.slice(0, 12000), por_palavra: true, origem: fase.provedor, versao: (anterior ? anterior.versao : 0) + 1, em: new Date().toISOString() },
    };
    let novo = aplicarOperacao(projeto, op);
    if (legendar) novo = proporSkill("legendas", novo, { agora: new Date().toISOString() }).resultado;
    onAplicarProjeto(novo, legendar ? "Fala e legendas" : "Fala guardada");
    toast.success(legendar ? "Fala guardada e legendas feitas" : "Fala guardada no projeto", { description: `Versão ${(anterior ? anterior.versao : 0) + 1} da marcação de ${f.nome}.` });
  };

  const linhas = fase.tipo === "pronto" ? linhasDeLegenda(fase.palavras) : [];
  return (
    <div className="space-y-3" data-painel-timestamp="">
      <div className="flex min-w-0 items-center">
        <p className={juntar(texto.rotulo, "mr-1")}>Timestamp</p>
        <AjudaRecolhida titulo="Timestamp">
          Marca o tempo de cada palavra da fala. Sem texto: transcreve ({PROVEDORES_DE_TIMESTAMP.whisper.rotulo}, US$ {PROVEDORES_DE_TIMESTAMP.whisper.usd_por_minuto} por minuto). Com a legenda ou o roteiro colado: alinha o texto ao áudio, com tempo por palavra e por letra ({PROVEDORES_DE_TIMESTAMP.alinhamento.rotulo}, US$ {PROVEDORES_DE_TIMESTAMP.alinhamento.usd_por_hora_iniciada} por hora iniciada). Só o áudio sai do navegador.
        </AjudaRecolhida>
      </div>
      <label className="block">
        <span className={texto.rotulo}>Mídia</span>
        <select className={juntar(campo, "mt-1 h-8")} value={fonte} onChange={(e) => setFonte(e.target.value)}>
          {fontes.map((k) => (
            <option key={k} value={k}>
              {projeto.fontes[k].nome}
              {projeto.transcricoes[k] ? ` (marcada, v${projeto.transcricoes[k].versao})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="flex items-center">
          <span className={juntar(texto.rotulo, "mr-auto")}>Legenda ou roteiro (opcional)</span>
          {srtDaEntrada && (
            <button type="button" className="text-[11.5px] text-primary hover:underline" onClick={() => setTextoDado(segmentosDoSrt(srtDaEntrada).map((s) => s.t).join(" "))}>
              Usar a legenda da Entrada
            </button>
          )}
        </span>
        <textarea className={juntar(campoTexto, "mt-1 min-h-[64px]")} value={textoDado} onChange={(e) => setTextoDado(e.target.value)} maxLength={100000} placeholder="Cole o texto falado para alinhar. Vazio: transcreve." />
      </label>
      {fase.tipo === "rodando" ? (
        <div className="flex items-center">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          <span className={juntar(texto.auxiliar, "mr-auto")}>{fase.texto}</span>
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => (cancelado.current = true)}>
            Parar
          </button>
        </div>
      ) : confirmando ? (
        <div className="flex flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2">
          <span className="mb-1 mr-auto text-[12.5px]">
            {modo === "alinhar" ? "Alinhar" : "Transcrever"} {tempoFino(duracao)}: <strong className="tabular-nums">{usd(custo)}</strong>
          </span>
          <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void rodar()}>
            Marcar por {usd(custo)}
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center">
          <button type="button" className={juntar(botao.secundario, "mb-1 mr-2 h-8")} onClick={() => setConfirmando(true)} disabled={!duracao}>
            <Timer className="mr-1.5 h-3.5 w-3.5" />
            {modo === "alinhar" ? "Alinhar texto" : "Transcrever"}
          </button>
          <span className={juntar(texto.auxiliar, "mb-1 truncate")}>{duracao ? `${provedor.split(" (")[0]} · ${usd(custo)}` : "Mídia sem duração lida."}</span>
          {falaDaEntrada && falaDaEntrada.length > 0 && (
            <button type="button" className={juntar(botao.discreto, "mb-1 ml-auto h-8")} onClick={() => setFase({ tipo: "pronto", palavras: falaDaEntrada, letras: 0, provedor: "entrada", custo: 0 })} data-fala-da-entrada="">
              Usar a fala da Entrada (grátis)
            </button>
          )}
        </div>
      )}
      {fase.tipo === "erro" && <p className="text-[12px] text-destructive">{fase.texto}</p>}
      {fase.tipo === "em_preparacao" && <p className={texto.auxiliar} data-em-preparacao="">{fase.texto}</p>}
      {fase.tipo === "pronto" && (
        <div className="space-y-2 border-t border-border pt-3" data-resultado-timestamp="">
          <p className="flex items-center text-[12.5px]">
            <Check className="mr-1.5 h-3.5 w-3.5 text-primary" />
            {fase.palavras.length} palavras{fase.letras ? `, ${fase.letras} letras` : ""} · {usd(fase.custo)}
          </p>
          <div className="flex flex-wrap">
            <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => mandar(true)}>
              Mandar e legendar
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => mandar(false)}>
              Só mandar a fala
            </button>
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-8")} onClick={() => copiar(linhas.map((l) => l.texto).join("\n"))}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Texto
            </button>
            <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => copiar(srtDasLinhas(linhas))}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              SRT
            </button>
          </div>
          <ol className="divide-y divide-border">
            {linhas.slice(0, 400).map((l, k) => (
              <li key={k} className="flex min-w-0 py-1 text-[12.5px]">
                <span className="mr-2 w-14 shrink-0 tabular-nums text-muted-foreground">{tempoFino(l.i)}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{l.texto}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
