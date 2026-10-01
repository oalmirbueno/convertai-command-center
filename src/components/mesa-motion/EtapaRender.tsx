import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clapperboard, Film, Loader2, Square } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { chaveDasVersoes } from "@/components/mesa-videos/videosApi";
import { ROTULO_DA_ETAPA, type EtapaDoRender } from "../../../supabase/functions/_shared/render-do-editor";
import { renderDaCena } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, faltantesDoFilme, type Filme, finaisQueFaltam, type PedidoDoMotion, uidDoClique, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import { useAcoesDaCena } from "./useAcoesDaCena";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 9: montagem e render. Um projeto por formato na Mesa Edição (as cenas
 * com alfa na linha do tempo, música e efeitos no pico) e o render final pela
 * fila da máquina da agência (-14 LUFS, miniatura). Entrega: registro para o
 * documento de entrega e, só com a autorização do cliente escrita, o
 * portfólio da agência. Nada é enviado ao cliente por aqui.
 *
 * O que falta para montar sai do próprio filme (não fica velho) e vira passo:
 * "Pedir as cenas finais que faltam" e "Abrir a Construção". Com o render em
 * andamento o botão trava (nada de versão repetida por clique); pronto, vira
 * "Montar de novo". A Entrega só libera com um filme pronto, como o servidor.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const comoTexto = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function estadoDoCartao(p: PedidoDoMotion | undefined): string {
  if (!p) return "Montado";
  if (p.estado === "pronto") return String((p.resultado && p.resultado.resumo) || "Pronto");
  if (p.estado === "erro") return p.erro_mensagem || "Não saiu";
  if (p.estado === "cancelado") return "Cancelado";
  if (p.estado === "rodando") return `${p.etapa ? ROTULO_DA_ETAPA[p.etapa as EtapaDoRender] || p.etapa : "Renderizando"} ${Math.round((Number(p.progresso) || 0) * 100)}%`;
  return "Na fila";
}

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const fila = useFilaDoFilme(filme.id);
  const acoes = useAcoesDaCena(filme);
  const [indo, setIndo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [port, setPort] = useState({ ligado: false, quem: "", como: "", em: "" });
  const [confirmar, setConfirmar] = useState(false);
  useEffect(() => {
    if (!confirmar) return;
    const t = window.setTimeout(() => setConfirmar(false), 6000);
    return () => window.clearTimeout(t);
  }, [confirmar]);

  const temCenas = filme.cenas.length > 0;
  const prontas = temCenas && filme.formatos.every((f) => filme.cenas.every((c) => (c.tipo_plano === "hf" ? !!renderDaCena(filme, c, "final", f) : !!c.arquivo)));
  const finais = (fila.data && fila.data.finais) || [];
  const linksDaFila = (fila.data && fila.data.links) || {};
  const pedidosDaMontagem = obj(filme.montagem.pedidos);
  const versoes = obj(filme.montagem.versoes);
  const idsDaMontagem = Object.keys(pedidosDaMontagem).map((k) => comoTexto(pedidosDaMontagem[k])).filter(Boolean);
  const porFormato: Record<string, PedidoDoMotion | undefined> = {};
  filme.formatos.forEach((f) => {
    const id = comoTexto(pedidosDaMontagem[f]);
    porFormato[f] = (id && finais.find((p) => p.id === id)) || finais.find((p) => p.entrada && p.entrada.formato === f);
  });
  // Só a versão atual (a última montagem) trava o botão.
  const atuais = filme.formatos.map((f) => porFormato[f]).filter((p): p is PedidoDoMotion => !!p && idsDaMontagem.indexOf(p.id) >= 0);
  const renderizando = atuais.some((p) => p.estado === "fila" || p.estado === "rodando");
  const nProntos = atuais.filter((p) => p.estado === "pronto").length;
  const todosProntos = atuais.length > 0 && atuais.length === filme.formatos.length && nProntos === atuais.length;
  const faltantes = temCenas ? faltantesDoFilme(filme) : [];
  const lote = finaisQueFaltam(filme, fila.data);
  const comCartao = filme.formatos.filter((f) => !!porFormato[f] || !!comoTexto(versoes[f]));
  // Mesma regra do servidor: um render final da montagem pronto e com arquivo. Fila que não carregou não trava (o servidor decide).
  const temPronto = finais.some((p) => idsDaMontagem.indexOf(p.id) >= 0 && p.estado === "pronto" && !!p.saida_path);
  const podeEntregar = idsDaMontagem.length > 0 && (!fila.data || fila.isError || temPronto);

  const montar = async () => {
    setIndo("montar");
    try {
      const d = await chamarMotion<{ filme: Filme }>("montar", { filme_id: filme.id, uid: uidDoClique("filme") });
      guardar(d.filme);
      void fila.refetch();
      // A Mesa Edição guarda a lista de versões por 30 s: sem isto o link abriria a versão antiga.
      void qc.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
    } catch (e) {
      avisarErro(e, "O filme não foi montado");
    } finally {
      setIndo(null);
    }
  };

  const pedirFinais = () => {
    if (!confirmar) return setConfirmar(true);
    setConfirmar(false);
    void acoes.pedirEmLote("finais", lote.map((x) => ({ cenaId: x.cena.id, modo: "final" as const, formatos: x.formatos, rotulo: `Cena ${x.numero}` })));
  };

  const entregar = async () => {
    setIndo("entregar");
    try {
      const d = await chamarMotion<{ filme: Filme; links: Record<string, string> }>("entregar", { filme_id: filme.id, nota: nota.trim() || undefined, portfolio: port.ligado ? { quem: port.quem, como: port.como, em: port.em || undefined } : undefined });
      guardar(d.filme, d.links);
    } catch (e) {
      avisarErro(e, "A entrega não foi registrada");
    } finally {
      setIndo(null);
    }
  };

  const cancelar = async (id: string) => {
    try {
      await chamarMotion("render_cancelar", { filme_id: filme.id, pedido_id: id });
      void fila.refetch();
    } catch (e) {
      avisarErro(e, "Não foi possível cancelar");
    }
  };

  const entrega = filme.entrega as { em?: string; renders?: Array<{ formato: string; duracao_s: number | null; lufs: number | null }>; portfolio?: { quem: string } | null };
  if (!temCenas && !idsDaMontagem.length && !entrega.em) return <EstadoVazio icone={<Clapperboard className="h-5 w-5" />} titulo="Escolha um storyboard antes" acao={<button type="button" className={botao.secundario} onClick={() => irPara("storyboards")}>Abrir os storyboards</button>} />;

  const estadoDoRender = !temCenas ? "Sem cenas" : renderizando ? `Renderizando ${nProntos} de ${atuais.length}` : todosProntos ? "Filme pronto" : prontas ? `Tudo pronto para ${filme.formatos.join(", ")}` : "Faltam cenas finais";
  const linkDaEdicao = (f: string, p: PedidoDoMotion | undefined) => {
    const daFila = p && typeof p.versao_id === "string" && UUID.test(p.versao_id) ? p.versao_id : null;
    const doFilme = comoTexto(versoes[f]);
    const versao = daFila || (UUID.test(doFilme) ? doFilme : null);
    return `/mesa-edicao?client=${clientId}&etapa=editar${versao ? `&versao=${versao}` : ""}${marca ? `&marca=${marca.id}` : ""}`;
  };

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Montar e renderizar"
        descricao={`${estadoDoRender}${temCenas && !comCartao.length ? " · ainda não montado" : ""}`}
        ajuda="Cria (ou dá a próxima versão de) um projeto por formato na Mesa Edição, com as cenas na linha do tempo, a música e os efeitos no pico, e põe o render na fila. Dá para ajustar tudo lá no editor. Com o render em andamento, o botão espera; para montar de novo antes, cancele."
        acao={
          renderizando ? (
            <button type="button" className={botao.primario} disabled data-montar="renderizando">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Renderizando ({nProntos} de {atuais.length})
            </button>
          ) : (
            <button type="button" className={todosProntos ? botao.secundario : botao.primario} onClick={() => void montar()} disabled={indo === "montar" || !temCenas} data-montar="">
              {indo === "montar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-1 h-3.5 w-3.5" />}
              {todosProntos ? "Montar de novo (nova versão)" : "Montar e renderizar"}
            </button>
          )
        }
      >
        {faltantes.length > 0 && (
          <div className="min-w-0" data-faltantes="">
            <ul className="space-y-1" role="alert">
              {faltantes.slice(0, 8).map((x) => (
                <li key={`${x.numero}-${x.motivo}`} className={juntar(texto.auxiliar, "text-warning")}>
                  Cena {x.numero}: {x.motivo}
                  {x.formatos.length ? ` (${x.formatos.join(", ")})` : ""}
                </li>
              ))}
              {faltantes.length > 8 && <li className={texto.auxiliar}>e mais {faltantes.length - 8}</li>}
            </ul>
            <div className="mt-2 flex min-w-0 flex-wrap items-center">
              {lote.length > 0 && (
                <button type="button" className={juntar(botao.secundario, "mb-1 mr-2")} onClick={pedirFinais} disabled={!!acoes.lote} data-pedir-finais={confirmar ? "confirmar" : ""}>
                  {acoes.lote === "finais" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Film className="mr-1 h-3.5 w-3.5" />}
                  {confirmar ? "Confirmar" : `Pedir as cenas finais que faltam (${lote.length})`}
                </button>
              )}
              <button type="button" className={juntar(botao.discreto, "mb-1")} onClick={() => irPara("construcao")}>
                Abrir a Construção
              </button>
            </div>
          </div>
        )}
        {fila.data && fila.data.worker.situacao !== "ligado" && <p className={juntar(texto.auxiliar, "mt-2 text-warning")}>A máquina da agência (worker de render) não está ligada: o render espera na fila.</p>}
      </Secao>

      {comCartao.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {comCartao.map((f) => {
            const p = porFormato[f];
            const url = p && p.estado === "pronto" && p.saida_path ? linksDaFila[p.saida_path] : null;
            const mini = p && p.resultado && p.resultado.miniatura_path ? linksDaFila[String(p.resultado.miniatura_path)] : null;
            return (
              <Painel key={f} recolher={false} titulo={`Filme ${f}`} descricao={estadoDoCartao(p)}>
                <div className="min-w-0 space-y-2">
                  {url && <video src={url} poster={mini || undefined} controls playsInline className={juntar("block rounded-md border border-border bg-muted", f === "16:9" ? "w-full" : "w-full max-w-[280px]")} />}
                  {p && (p.estado === "fila" || p.estado === "rodando") && (
                    <button type="button" className={botao.barra} onClick={() => void cancelar(p.id)}>
                      <Square className="mr-1 h-3 w-3" />
                      Cancelar
                    </button>
                  )}
                  <Link to={linkDaEdicao(f, p)} className={juntar(botao.discreto, "px-0")} data-abrir-na-edicao={f}>
                    Abrir na Mesa Edição ({filme.nome} {f})
                  </Link>
                </div>
              </Painel>
            );
          })}
        </div>
      )}

      <Secao titulo="Entrega" descricao={entrega.em ? `Registrada em ${new Date(entrega.em).toLocaleString("pt-BR")}${entrega.portfolio ? " · no portfólio" : ""}` : podeEntregar ? "Ainda não registrada" : "Nenhum filme pronto ainda"} ajuda="Registra os arquivos, a miniatura e o LUFS no filme e no registro de ações (entra no documento de entrega). O envio ao cliente segue pela aprovação da Mesa Edição.">
        <textarea className={campoTexto} value={nota} maxLength={1200} onChange={(e) => setNota(e.target.value)} placeholder="Nota da entrega: o que foi feito, trocas e limites (sem prometer resultado)" aria-label="Nota da entrega" />
        <label className="mt-3 flex items-center">
          <input type="checkbox" className="mr-2" checked={port.ligado} onChange={(e) => setPort({ ...port, ligado: e.target.checked })} />
          <span className={texto.corpo}>Pôr no portfólio da agência (o cliente autorizou)</span>
        </label>
        {port.ligado && (
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <input className={campo} placeholder="Quem autorizou" value={port.quem} maxLength={120} onChange={(e) => setPort({ ...port, quem: e.target.value })} aria-label="Quem autorizou" />
            <input className={campo} placeholder="Como (e-mail, grupo, contrato)" value={port.como} maxLength={300} onChange={(e) => setPort({ ...port, como: e.target.value })} aria-label="Como autorizou" />
            <input className={campo} type="date" value={port.em} onChange={(e) => setPort({ ...port, em: e.target.value })} aria-label="Quando autorizou" />
          </div>
        )}
        <button type="button" className={juntar(botao.primario, "mt-3")} onClick={() => void entregar()} disabled={indo === "entregar" || !podeEntregar || (port.ligado && (port.quem.trim().length < 2 || port.como.trim().length < 3))} data-entregar="">
          {indo === "entregar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
          Registrar a entrega
        </button>
        {entrega.renders && entrega.renders.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{entrega.renders.map((r) => `${r.formato}: ${r.duracao_s} s, ${r.lufs} LUFS`).join(" · ")}</p>}
      </Secao>
      <button type="button" className={botao.discreto} onClick={() => irPara("construcao")}>
        Voltar à construção
      </button>
    </div>
  );
}

export default function EtapaRender({ irPara }: { irPara: IrPara }) {
  return <ComFilme irPara={irPara}>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
