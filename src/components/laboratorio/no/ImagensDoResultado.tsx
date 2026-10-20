import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Columns2, Copy, Download, FolderDown, ImagePlus, Loader2, Maximize2, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { JanelaCentral, botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { ajustarImagem, custoDoPreencher, noMotorDaCasa, salvarNosArquivos, variarImagem, type ExecucaoDoLab, type ImagemDoLab } from "@/lib/laboratorio/api";
import { ErroDaMesa } from "@/lib/mesa/api";
import type { NoDoLab, TipoDeNo } from "@/lib/laboratorio/nos";
import { baixarImagem, useImagens } from "../ResultadoDoNo";
import { useAcoesDoQuadro } from "./contexto";
import { Segmentos } from "./SeletoresVisuais";

/**
 * As imagens dos nós criativos (Resultado, Carrossel, Anúncio, Template,
 * Influenciador, UGC, Logo), com as funções da Mesa Foto adaptadas ao Lab:
 * escolher a principal (a que segue para os próximos nós), ajustar com um
 * pedido, variar (1 a 4), usar como referência (nó Mídia ligado), salvar
 * nos arquivos (cliente ou Laboratório), baixar, ampliar e comparar com a
 * principal. Ajustar e variar mostram o custo antes, compacto no nó. Enquanto
 * o motor trabalha, "No motor" com o tempo, e as imagens aparecem conforme
 * chegam.
 */

export const TIPOS_CRIATIVOS: TipoDeNo[] = ["imagem", "carrossel", "anuncio", "template_designer", "influenciador", "ugc", "logo"];

const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

/** "No motor" com o tempo decorrido (a execução pode esperar na fila do motor). */
function NoMotor({ desde, chegaram }: { desde: string; chegaram: number }) {
  const inicio = useRef<number>(Date.parse(desde) || Date.now());
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((agora - inicio.current) / 1000));
  const tempo = s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  return (
    <div className="mb-2 min-w-0" data-no-motor="">
      <div className="mb-1 flex min-w-0 items-center">
        <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0 animate-pulse text-primary motion-reduce:animate-none" aria-hidden="true" />
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate font-medium text-foreground")}>No motor{chegaram ? ` · ${chegaram} pronta(s)` : ""}</span>
        <span className={juntar(texto.auxiliar, "tabular-nums")} data-tempo-no-motor="">
          {tempo}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="No motor" aria-valuetext={tempo}>
        <div className="h-full animate-pulse rounded-full bg-primary motion-reduce:animate-none" style={{ width: `${Math.min(92, 8 + s * 0.8)}%` }} />
      </div>
    </div>
  );
}

type Pedido = { modo: "ajustar" | "variar"; indice: number };

/** Ajustar (pedido curto) ou variar (1 a 4), com o custo antes, compacto. */
function PedidoDaImagem({ no, pedido, onFechar }: { no: NoDoLab; pedido: Pedido; onFechar: () => void }) {
  const a = useAcoesDoQuadro();
  const [textoDoPedido, setTextoDoPedido] = useState("");
  const [quantas, setQuantas] = useState("2");
  const [custo, setCusto] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const chamar = async (confirmado: boolean) => {
    if (pedido.modo === "ajustar" && !textoDoPedido.trim()) {
      setErro("Diga o que mudar.");
      return;
    }
    setErro("");
    setOcupado(true);
    try {
      await a.antesDeChamar();
      const ex =
        pedido.modo === "ajustar"
          ? await ajustarImagem({ projetoId: a.projetoId, noId: no.id, indice: pedido.indice, pedido: textoDoPedido, confirmado })
          : await variarImagem({ projetoId: a.projetoId, noId: no.id, indice: pedido.indice, quantidade: Number(quantas), confirmado });
      a.novaExecucao(no.id, ex);
      toast.success(pedido.modo === "ajustar" ? "Ajuste no motor" : "Variações no motor", { description: "As imagens aparecem no nó conforme chegam." });
      onFechar();
    } catch (e) {
      const c = custoDoPreencher(e);
      if (c !== null && !confirmado) setCusto(c);
      else setErro(textoDoErro(e, "Não deu agora. Tente de novo."));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="mb-2 min-w-0 rounded-md bg-primary/[0.06] p-2" data-pedido-da-imagem={pedido.modo}>
      {custo !== null ? (
        <div className="flex min-w-0 flex-wrap items-center" data-confirmar-custo="">
          <span className={juntar(texto.corpo, "mb-1 block w-full")}>
            {pedido.modo === "ajustar" ? "Ajustar" : `Variar ${quantas}×`} custa <strong className="tabular-nums">{dinheiro(custo)}</strong>
          </span>
          <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => setCusto(null)} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className={juntar(botao.primario, "ml-1 h-7 px-2.5 text-[12px]")} onClick={() => void chamar(true)} disabled={ocupado}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Confirmar"}
          </button>
        </div>
      ) : (
        <div className="min-w-0">
          {pedido.modo === "ajustar" ? (
            <>
              <label htmlFor={`ajuste-${no.id}`} className={juntar(texto.rotulo, "mb-1 block")}>
                O que mudar na imagem {pedido.indice + 1}
              </label>
              <input
                id={`ajuste-${no.id}`}
                className={juntar(campo, "h-8")}
                placeholder="Ex.: fundo mais claro, sem texto"
                value={textoDoPedido}
                onChange={(e) => setTextoDoPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void chamar(false);
                  if (e.key === "Escape") onFechar();
                }}
              />
            </>
          ) : (
            <>
              <span id={`variar-${no.id}-rotulo`} className={juntar(texto.rotulo, "mb-1 block")}>
                Variações da imagem {pedido.indice + 1}
              </span>
              <Segmentos id={`variar-${no.id}`} rotuloId={`variar-${no.id}-rotulo`} opcoes={["1", "2", "3", "4"].map((v) => ({ valor: v, rotulo: v }))} valor={quantas} onMudar={setQuantas} />
            </>
          )}
          <div className="mt-1.5 flex items-center">
            <span className="flex-1" />
            <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={onFechar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="button" className={juntar(botao.primario, "ml-1 h-7 px-2.5 text-[12px]")} onClick={() => void chamar(false)} disabled={ocupado} data-pedir-imagem="">
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : pedido.modo === "ajustar" ? "Ajustar" : "Variar"}
            </button>
          </div>
        </div>
      )}
      {erro ? (
        <p role="alert" className={juntar(texto.auxiliar, "mt-1 text-destructive")}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/** Salvar nos arquivos: do cliente ou na pasta do Laboratório (sem cliente, só a do Lab). */
function SalvarNosArquivos({ no, indice, grande = false }: { no: NoDoLab; indice: number; grande?: boolean }) {
  const a = useAcoesDoQuadro();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && e.target instanceof Node && !caixa.current.contains(e.target)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  const salvar = async (destino: "cliente" | "laboratorio") => {
    setAberto(false);
    setSalvando(true);
    try {
      await a.antesDeChamar();
      const salvos = await salvarNosArquivos({ projetoId: a.projetoId, noId: no.id, indices: [indice], destino });
      const pasta = salvos[0] ? salvos[0].pasta : destino === "cliente" ? "Arquivos do cliente" : "Laboratório";
      // A pasta do Laboratório já guarda o que o nó gera: a função só confirma onde está.
      if (destino === "laboratorio") toast.success("Já está na pasta do Laboratório", { description: `Em ${pasta}` });
      else toast.success("Salvo nos arquivos", { description: `Em ${pasta}` });
    } catch (e) {
      const codigo = e instanceof ErroDaMesa ? e.codigo : "";
      if (codigo === "sem_cliente") toast.warning("Este projeto não tem cliente", { description: "Escolha o cliente no Canvas Studio ou fique com a pasta do Laboratório." });
      else if (codigo === "sem_imagem") toast.warning("Ainda não há imagem pronta", { description: "Espere o motor terminar e tente de novo." });
      else toast.error("Não deu para salvar nos arquivos", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div ref={caixa} className="relative inline-flex">
      <button type="button" className={juntar(botao.icone, grande ? "h-8 w-8" : "h-7 w-7")} onClick={() => setAberto(!aberto)} aria-label="Salvar nos arquivos" title="Salvar nos arquivos" aria-haspopup="menu" aria-expanded={aberto} disabled={salvando}>
        {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FolderDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {aberto ? (
        <div role="menu" aria-label="Onde salvar" className="absolute bottom-full right-0 z-30 mb-1 w-[200px] rounded-lg border border-border bg-popover p-1 text-popover-foreground" style={{ boxShadow: "0 12px 32px -10px rgba(0,0,0,0.45)" }} data-menu-salvar="">
          {a.clienteId ? (
            <button type="button" role="menuitem" className={juntar(texto.corpo, "flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-muted")} onClick={() => void salvar("cliente")}>
              Arquivos do cliente
            </button>
          ) : null}
          <button type="button" role="menuitem" className={juntar(texto.corpo, "flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-muted")} onClick={() => void salvar("laboratorio")}>
            Pasta do Laboratório
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** As ações de uma imagem (no nó e na ampliação). */
function AcoesDaImagem({ no, imagens, urls, indice, principal, onPedido, onAmpliar, grande = false }: { no: NoDoLab; imagens: ImagemDoLab[]; urls: string[]; indice: number; principal: number; onPedido: (p: Pedido) => void; onAmpliar?: () => void; grande?: boolean }) {
  const a = useAcoesDoQuadro();
  const ehPrincipal = indice === principal;
  const tam = grande ? "h-8 w-8" : "h-7 w-7";
  const icone = "h-3.5 w-3.5";
  return (
    <div className="flex min-w-0 flex-wrap items-center" role="toolbar" aria-label={`Ações da imagem ${indice + 1}`} data-acoes-da-imagem={indice}>
      <button
        type="button"
        className={juntar(botao.icone, tam, ehPrincipal && "text-amber-500")}
        onClick={() => a.mudarDados(no.id, { principal: indice })}
        aria-pressed={ehPrincipal}
        aria-label={ehPrincipal ? "É a principal" : "Escolher como principal"}
        title={ehPrincipal ? "É a principal: é ela que segue para os próximos nós" : "Escolher como principal (segue para os próximos nós)"}
        data-escolher-principal={indice}
      >
        <Star className={juntar(icone, ehPrincipal && "fill-current")} aria-hidden="true" />
      </button>
      <button type="button" className={juntar(botao.icone, tam)} onClick={() => onPedido({ modo: "ajustar", indice })} aria-label="Ajustar" title="Ajustar com um pedido (mostra o custo antes)" data-ajustar-imagem={indice}>
        <SlidersHorizontal className={icone} aria-hidden="true" />
      </button>
      <button type="button" className={juntar(botao.icone, tam)} onClick={() => onPedido({ modo: "variar", indice })} aria-label="Variar" title="Variações desta imagem, de 1 a 4 (mostra o custo antes)" data-variar-imagem={indice}>
        <Copy className={icone} aria-hidden="true" />
      </button>
      <button type="button" className={juntar(botao.icone, tam)} onClick={() => a.usarComoReferencia(no.id, imagens[indice])} aria-label="Usar como referência" title="Usar como referência: cria um nó Mídia com esta imagem, já ligado" data-usar-referencia={indice}>
        <ImagePlus className={icone} aria-hidden="true" />
      </button>
      <SalvarNosArquivos no={no} indice={indice} grande={grande} />
      <button type="button" className={juntar(botao.icone, tam)} onClick={() => void baixarImagem(imagens[indice], urls[indice], `imagem-${indice + 1}.png`)} aria-label="Baixar" title="Baixar" data-baixar-imagem="">
        <Download className={icone} aria-hidden="true" />
      </button>
      {onAmpliar ? (
        <button type="button" className={juntar(botao.icone, tam)} onClick={onAmpliar} aria-label="Ampliar" title="Ampliar">
          <Maximize2 className={icone} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default function ImagensDoResultado({ no, execucao }: { no: NoDoLab; execucao: ExecucaoDoLab | undefined }) {
  const imagens = execucao ? execucao.saida.imagens : [];
  const urls = useImagens(imagens);
  const total = imagens.length;
  const doJev = execucao && execucao.saida.escolha ? execucao.saida.escolha.indice : 0;
  const principal = Math.min(Math.max(0, typeof no.dados.principal === "number" ? no.dados.principal : doJev), Math.max(0, total - 1));
  const [atual, setAtual] = useState(principal);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [comparar, setComparar] = useState(false);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  // Na fila, rodando, ou aguardando o motor da casa (estudio_arte): só o no_acompanhar termina.
  const noMotor = !!execucao && (execucao.status === "rodando" || execucao.status === "na_fila" || noMotorDaCasa(no.tipo, execucao));
  const i = Math.min(atual, Math.max(0, total - 1));
  if (!total && !noMotor) return null;
  const ir = (passo: number) => setAmpliada((x) => (x === null ? x : (x + passo + total) % total));
  return (
    <div className="mt-2 min-w-0" data-imagens-do-resultado={no.id}>
      {noMotor ? <NoMotor desde={execucao ? execucao.created_at : ""} chegaram={total} /> : null}
      {total ? (
        <>
          <div className={juntar("grid min-w-0 gap-1.5", total === 1 ? "grid-cols-1" : total > 4 ? "grid-cols-3" : "grid-cols-2")}>
            {urls.map((u, k) => (
              <button
                key={k}
                type="button"
                className={juntar("nodrag relative block w-full overflow-hidden rounded-md bg-muted", k === i && total > 1 && "ring-2 ring-primary")}
                style={total === 1 ? undefined : { paddingTop: "100%" }}
                onClick={() => setAtual(k)}
                onDoubleClick={() => setAmpliada(k)}
                aria-label={`Imagem ${k + 1}${k === principal ? " (principal)" : ""}`}
                aria-pressed={k === i}
                title="Toque para escolher; dois toques para ampliar"
                data-imagem-gerada={k}
              >
                {u ? <img src={u} alt="" className={total === 1 ? "block h-auto max-h-[420px] w-full object-cover" : "absolute inset-0 h-full w-full object-cover"} loading="lazy" /> : <span className={total === 1 ? "block h-40" : ""} />}
                {k === principal ? (
                  <span className="pointer-events-none absolute left-1 top-1 inline-flex h-5 items-center rounded-full bg-black/60 px-1.5 text-[11px] font-medium text-white" data-selo-principal="">
                    <Star className="mr-0.5 h-3 w-3 fill-current text-amber-400" aria-hidden="true" />
                    Principal
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="mt-1 min-w-0">
            <AcoesDaImagem no={no} imagens={imagens} urls={urls} indice={i} principal={principal} onPedido={setPedido} onAmpliar={() => setAmpliada(i)} />
          </div>
          {pedido ? <PedidoDaImagem key={`${pedido.modo}-${pedido.indice}`} no={no} pedido={pedido} onFechar={() => setPedido(null)} /> : null}
        </>
      ) : null}

      <JanelaCentral
        aberta={ampliada !== null}
        onFechar={() => {
          setAmpliada(null);
          setComparar(false);
        }}
        titulo={ampliada !== null ? `Imagem ${ampliada + 1} de ${total}${ampliada === principal ? " · principal" : ""}` : "Imagem"}
        largura="xl"
        acoes={
          ampliada !== null ? (
            <>
              {total > 1 ? (
                <>
                  <button type="button" className={juntar(botao.icone, comparar && "bg-muted text-foreground")} onClick={() => setComparar(!comparar)} aria-pressed={comparar} aria-label="Comparar com a principal" title="Comparar com a principal" disabled={ampliada === principal}>
                    <Columns2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={botao.icone} onClick={() => ir(-1)} aria-label="Imagem anterior" title="Imagem anterior">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={botao.icone} onClick={() => ir(1)} aria-label="Próxima imagem" title="Próxima imagem">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </>
          ) : null
        }
        rodape={
          ampliada !== null ? (
            <div className="flex min-w-0 flex-1 items-center">
              <AcoesDaImagem
                no={no}
                imagens={imagens}
                urls={urls}
                indice={ampliada}
                principal={principal}
                grande
                onPedido={(p) => {
                  setAmpliada(null);
                  setAtual(p.indice);
                  setPedido(p);
                }}
              />
              {ampliada === principal ? (
                <span className={juntar(texto.auxiliar, "ml-2 inline-flex items-center")}>
                  <Check className="mr-1 h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  Segue para os próximos nós
                </span>
              ) : null}
            </div>
          ) : null
        }
        data-imagem-ampliada=""
      >
        {ampliada !== null ? (
          comparar && ampliada !== principal ? (
            <div className="grid min-w-0 grid-cols-2 gap-2" data-comparando="">
              {[principal, ampliada].map((k) => (
                <figure key={k} className="min-w-0">
                  {urls[k] ? <img src={urls[k]} alt={`Imagem ${k + 1}`} className="mx-auto block h-auto max-h-[64vh] w-full rounded-md object-contain" /> : null}
                  <figcaption className={juntar(texto.auxiliar, "mt-1 text-center")}>{k === principal ? `Principal (imagem ${k + 1})` : `Imagem ${k + 1}`}</figcaption>
                </figure>
              ))}
            </div>
          ) : urls[ampliada] ? (
            <img src={urls[ampliada]} alt={`Imagem ${ampliada + 1}`} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain" />
          ) : null
        ) : null}
      </JanelaCentral>
    </div>
  );
}
