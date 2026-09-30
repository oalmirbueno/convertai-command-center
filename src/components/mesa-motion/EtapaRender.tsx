import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clapperboard, Loader2, Square } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import Painel from "@/components/sistema/Painel";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { ROTULO_DA_ETAPA, type EtapaDoRender } from "../../../supabase/functions/_shared/render-do-editor";
import { renderDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, type Filme, type PedidoDoMotion, uidDoClique, useFilaDoFilme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 9: montagem e render. Um projeto por formato na Mesa Edição (as cenas
 * com alfa na linha do tempo, música e efeitos no pico) e o render final pela
 * fila da máquina da agência (-14 LUFS, miniatura). Entrega: registro para o
 * documento de entrega e, só com a autorização do cliente escrita, o
 * portfólio da agência. Nada é enviado ao cliente por aqui.
 */

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const fila = useFilaDoFilme(filme.id);
  const [indo, setIndo] = useState<string | null>(null);
  const [faltando, setFaltando] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const [port, setPort] = useState({ ligado: false, quem: "", como: "", em: "" });

  const prontas = filme.formatos.every((f) => filme.cenas.every((c) => (c.tipo_plano === "hf" ? !!renderDaCena(filme, c, "final", f) : !!c.arquivo)));
  const finais = (fila.data && fila.data.finais) || [];
  const linksDaFila = (fila.data && fila.data.links) || {};
  const porFormato: Record<string, PedidoDoMotion | undefined> = {};
  filme.formatos.forEach((f) => (porFormato[f] = finais.find((p) => p.entrada && p.entrada.formato === f)));

  const montar = async () => {
    setIndo("montar");
    setFaltando([]);
    try {
      const d = await chamarMotion<{ filme: Filme }>("montar", { filme_id: filme.id, uid: uidDoClique("filme") });
      guardar(d.filme);
      void fila.refetch();
    } catch (e) {
      const det = (e as { detalhes?: { faltando?: string[] } }).detalhes;
      if (det && Array.isArray(det.faltando)) setFaltando(det.faltando);
      avisarErro(e, "O filme não foi montado");
    } finally {
      setIndo(null);
    }
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
  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Montar e renderizar"
        descricao={prontas ? `Tudo pronto para ${filme.formatos.join(", ")}` : "Faltam cenas finais"}
        ajuda="Cria (ou dá a próxima versão de) um projeto por formato na Mesa Edição, com as cenas na linha do tempo, a música e os efeitos no pico, e põe o render na fila. Dá para ajustar tudo lá no editor."
        acao={
          <button type="button" className={botao.primario} onClick={() => void montar()} disabled={indo === "montar"} data-montar="">
            {indo === "montar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="mr-1 h-3.5 w-3.5" />}
            Montar e renderizar
          </button>
        }
      >
        {faltando.length > 0 && (
          <ul className="space-y-1" role="alert">
            {faltando.map((f) => (
              <li key={f} className={juntar(texto.auxiliar, "text-warning")}>
                {f}
              </li>
            ))}
          </ul>
        )}
        {fila.data && fila.data.worker.situacao !== "ligado" && <p className={juntar(texto.auxiliar, "text-warning")}>A máquina da agência (worker de render) não está ligada: o render espera na fila.</p>}
      </Secao>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        {filme.formatos.map((f) => {
          const p = porFormato[f];
          const url = p && p.estado === "pronto" && p.saida_path ? linksDaFila[p.saida_path] : null;
          const mini = p && p.resultado && p.resultado.miniatura_path ? linksDaFila[String(p.resultado.miniatura_path)] : null;
          return (
            <Painel key={f} recolher={false} titulo={`Filme ${f}`} descricao={p ? (p.estado === "pronto" ? String((p.resultado && p.resultado.resumo) || "Pronto") : p.estado === "erro" ? p.erro_mensagem || "Não saiu" : p.estado === "rodando" ? `${p.etapa ? ROTULO_DA_ETAPA[p.etapa as EtapaDoRender] || p.etapa : "Renderizando"} ${Math.round((Number(p.progresso) || 0) * 100)}%` : "Na fila") : "Ainda não montado"}>
              <div className="min-w-0 space-y-2">
                {url && <video src={url} poster={mini || undefined} controls playsInline className={juntar("block rounded-md border border-border bg-muted", f === "16:9" ? "w-full" : "w-full max-w-[280px]")} />}
                {p && (p.estado === "fila" || p.estado === "rodando") && (
                  <button type="button" className={botao.barra} onClick={() => void cancelar(p.id)}>
                    <Square className="mr-1 h-3 w-3" />
                    Cancelar
                  </button>
                )}
                {p && (
                  <Link to={`/mesa-edicao?client=${clientId}&etapa=editar`} className={juntar(botao.discreto, "px-0")}>
                    Abrir na Mesa Edição ({filme.nome} {f})
                  </Link>
                )}
              </div>
            </Painel>
          );
        })}
      </div>

      <Secao titulo="Entrega" descricao={entrega.em ? `Registrada em ${new Date(entrega.em).toLocaleString("pt-BR")}${entrega.portfolio ? " · no portfólio" : ""}` : "Ainda não registrada"} ajuda="Registra os arquivos, a miniatura e o LUFS no filme e no registro de ações (entra no documento de entrega). O envio ao cliente segue pela aprovação da Mesa Edição.">
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
        <button type="button" className={juntar(botao.primario, "mt-3")} onClick={() => void entregar()} disabled={indo === "entregar" || (port.ligado && (port.quem.trim().length < 2 || port.como.trim().length < 3))}>
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
  return <ComFilme>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
