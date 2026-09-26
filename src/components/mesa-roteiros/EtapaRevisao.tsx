import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Check, CheckCircle2, Loader2, MessageSquare, RotateCcw, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { dataEHora, usd } from "@/lib/mesa/api";
import {
  duracaoEstimada,
  modoDoTipo,
  motivoParaNaoMudar,
  versaoPorNumero,
  type LinhaDoRoteiro,
  type StatusDoRoteiro,
} from "../../../supabase/functions/_shared/roteiro-modelo";
import { atualizarNoCache, chamarRoteiros, mudarStatus, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, AvisoDoJevCartao, SeloDoStatus } from "./Comuns";

/**
 * Etapa 3: revisão salva. Versões (cada uma com origem, nota, custo e código),
 * comentários por bloco, e o status: Aprovar (a versão atual fica aprovada e
 * imutável; o roteiro aprovado fica ligado à peça da agenda e vira modelo do
 * cliente), Marcar como gravado, Voltar e Arquivar.
 */

const ORIGEM: Record<string, string> = { ia: "gerada pela IA", edicao: "edição da equipe", agente: "pedido ao agente", modelo: "a partir de modelo" };

export default function EtapaRevisao({ roteiroId, onAbrirRoteiro }: { roteiroId: string | null; onAbrirRoteiro: (id: string, etapa?: "roteiro" | "revisao") => void }) {
  const { clientId } = useMesa();
  const roteirosQ = useRoteiros(clientId);
  const lista = roteirosQ.data ? roteirosQ.data.lista : [];
  const linha = roteiroId ? lista.filter((r) => r.id === roteiroId)[0] || null : null;

  if (roteirosQ.data && roteirosQ.data.indisponivel) return <AvisoDoBanco />;
  if (roteirosQ.isLoading) return <p className="text-[12.5px] text-muted-foreground">Carregando...</p>;
  if (!linha) {
    const vivos = lista.filter((r) => !r.arquivado_em);
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[14px] font-semibold">Escolha o roteiro para revisar</h2>
        {!vivos.length && <p className="mt-2 text-[12.5px] text-muted-foreground">Nenhum roteiro ainda. Comece pela Agenda.</p>}
        <ul className="mt-2 divide-y divide-border">
          {vivos.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{r.titulo}</span>
              <SeloDoStatus status={r.status} />
              <Button type="button" size="sm" variant="outline" className="ml-2 h-8 text-[12px]" onClick={() => onAbrirRoteiro(r.id, "revisao")}>Revisar</Button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return <Revisao key={linha.id} linha={linha} onAbrirRoteiro={onAbrirRoteiro} />;
}

function Revisao({ linha, onAbrirRoteiro }: { linha: LinhaDoRoteiro; onAbrirRoteiro: (id: string, etapa?: "roteiro" | "revisao") => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [vendo, setVendo] = useState<number>(linha.versao_atual);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [bloco, setBloco] = useState("");
  const versao = versaoPorNumero(linha.versoes, vendo);
  const atual = versaoPorNumero(linha.versoes, linha.versao_atual);
  const arquivado = !!linha.arquivado_em;

  const rodar = async (chave: string, fn: () => Promise<any>, ok?: string) => {
    setOcupado(chave);
    try {
      const r = await fn();
      if (r && r.roteiro) atualizarNoCache(qc, clientId, r.roteiro);
      if (ok) toast.success(ok, r && r.modelo ? { description: `Virou modelo do cliente: ${r.modelo.nome}.` } : undefined);
      return r;
    } catch (e) {
      avisarErro(e, "Não foi possível concluir");
      return null;
    } finally {
      setOcupado(null);
    }
  };

  const status = (novo: StatusDoRoteiro, ok: string) => rodar(`status:${novo}`, () => mudarStatus(linha.id, novo), ok);
  const podeIr = (novo: StatusDoRoteiro) => linha.status !== novo && !motivoParaNaoMudar(linha.status, novo, arquivado);
  const abertos = linha.comentarios.filter((c) => !c.resolvido);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]" data-revisao={linha.id}>
      <div className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex min-w-0 flex-wrap items-center">
            <h2 className="mr-auto min-w-0 truncate text-[16px] font-semibold">{linha.titulo}</h2>
            <SeloDoStatus status={linha.status} />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {modoDoTipo(linha.tipo).rotulo} · versão atual {linha.versao_atual}
            {linha.versao_aprovada ? ` · aprovada: versão ${linha.versao_aprovada}${linha.aprovado_em ? ` em ${dataEHora(linha.aprovado_em)}` : ""}` : " · ainda não aprovada"}
            {linha.task_id ? " · ligado à peça da agenda" : " · avulso"}
            {arquivado ? " · arquivado" : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center" data-acoes-de-status="">
            {podeIr("aprovado") && (
              <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void status("aprovado", linha.status === "gravado" ? "Voltou para aprovado" : `Versão ${linha.versao_atual} aprovada`)}>
                {ocupado === "status:aprovado" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                {linha.status === "gravado" ? "Voltar para aprovado" : "Aprovar"}
              </Button>
            )}
            {podeIr("gravado") && (
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void status("gravado", "Marcado como gravado")}>
                <Video className="mr-1 h-3.5 w-3.5" />Marcar como gravado
              </Button>
            )}
            {podeIr("rascunho") && (
              <Button type="button" size="sm" variant="ghost" className="mb-1 mr-2 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void status("rascunho", "Voltou para rascunho")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />Voltar para rascunho
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mb-1 mr-2 h-8 text-[12px]"
              disabled={!!ocupado}
              onClick={() => void rodar("arquivar", () => chamarRoteiros("arquivar", { roteiro_id: linha.id, arquivar: !arquivado }), arquivado ? "Roteiro desarquivado" : "Roteiro arquivado")}
            >
              {arquivado ? <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> : <Archive className="mr-1 h-3.5 w-3.5" />}
              {arquivado ? "Desarquivar" : "Arquivar"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" onClick={() => onAbrirRoteiro(linha.id, "roteiro")}>Editar roteiro</Button>
          </div>
          {linha.status === "rascunho" && <p className="mt-1 text-[11.5px] text-muted-foreground">Aprovar trava a versão {linha.versao_atual}: corrigir depois cria outra versão.</p>}
        </section>

        {versao && (
          <section className="rounded-2xl border border-border bg-card p-4" data-versao-vista={versao.numero}>
            <div className="flex min-w-0 flex-wrap items-center">
              <h3 className="mr-auto text-[13.5px] font-semibold">Versão {versao.numero}{versao.numero === linha.versao_atual ? " (atual)" : ""}</h3>
              <span className="text-[11.5px] text-muted-foreground">
                {duracaoEstimada(versao.conteudo).min_s} a {duracaoEstimada(versao.conteudo).max_s}s · código {versao.hash}
              </span>
            </div>
            <AvisoDoJevCartao aviso={versao.aviso} />
            <ol className="mt-2 space-y-2">
              {versao.conteudo.blocos.map((b, i) => (
                <li key={b.id} className={`rounded-xl p-2.5 ${i === 0 ? "bg-foreground text-background" : "bg-muted/50"}`}>
                  <p className={`text-[10.5px] font-semibold uppercase tracking-wide ${i === 0 ? "text-primary-foreground/80" : "text-primary"}`}>
                    {String(i + 1).padStart(2, "0")} {b.funcao} · {b.segundos}s
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{b.fala}</p>
                  {(b.texto_na_tela || b.broll) && (
                    <p className={`mt-1 text-[11px] ${i === 0 ? "opacity-80" : "text-muted-foreground"}`}>{[b.texto_na_tela ? `Na tela: ${b.texto_na_tela}` : "", b.broll ? `Apoio: ${b.broll}` : ""].filter(Boolean).join(" · ")}</p>
                  )}
                </li>
              ))}
            </ol>
            {versao.conteudo.cta && <p className="mt-2 text-[12px]"><span className="font-medium">CTA:</span> {versao.conteudo.cta}</p>}
            {versao.numero !== linha.versao_atual && !arquivado && linha.status !== "gravado" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 h-8 text-[12px]"
                disabled={!!ocupado}
                onClick={() => void rodar("restaurar", () => chamarRoteiros("versao_restaurar", { roteiro_id: linha.id, versao: versao.numero }), `Versão ${versao.numero} restaurada como nova versão`).then((r) => r && r.versao && setVendo(r.versao.numero))}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />Restaurar esta versão
              </Button>
            )}
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4" data-versoes="">
          <h3 className="text-[13.5px] font-semibold">Versões</h3>
          <ul className="mt-2 max-h-[320px] space-y-1 overflow-y-auto">
            {linha.versoes.slice().reverse().map((v) => (
              <li key={v.numero}>
                <button
                  type="button"
                  onClick={() => setVendo(v.numero)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${vendo === v.numero ? "bg-primary/10" : "hover:bg-muted"}`}
                  aria-pressed={vendo === v.numero}
                >
                  <span className="font-medium">Versão {v.numero}</span>
                  {v.numero === linha.versao_atual && <span className="ml-1 text-primary">atual</span>}
                  {v.numero === linha.versao_aprovada && <span className="ml-1 inline-flex items-center text-primary"><Check className="mr-0.5 h-3 w-3" />aprovada</span>}
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {ORIGEM[v.origem] || v.origem} · {dataEHora(v.criado_em)}{v.custo_usd ? ` · ${usd(v.custo_usd)}` : ""}{v.nota ? ` · ${v.nota}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4" data-comentarios="">
          <h3 className="flex items-center text-[13.5px] font-semibold"><MessageSquare className="mr-1.5 h-4 w-4 text-primary" />Comentários{abertos.length ? ` (${abertos.length} abertos)` : ""}</h3>
          <p className="text-[11px] text-muted-foreground">Os abertos entram no próximo "Gerar de novo".</p>
          <ul className="mt-2 max-h-[320px] space-y-2 overflow-y-auto">
            {linha.comentarios.slice().reverse().map((c) => (
              <li key={c.id} className={`rounded-lg border p-2 text-[12px] ${c.resolvido ? "border-border opacity-60" : "border-primary/30"}`}>
                <p className="[overflow-wrap:anywhere]">{c.texto}</p>
                <p className="mt-1 flex items-center text-[10.5px] text-muted-foreground">
                  <span className="mr-auto truncate">{c.autor_nome} · versão {c.versao}{c.bloco_id ? ` · bloco ${c.bloco_id.replace("b", "")}` : ""}</span>
                  <button
                    type="button"
                    className="ml-2 shrink-0 underline-offset-2 hover:underline"
                    disabled={!!ocupado}
                    onClick={() => void rodar(`c:${c.id}`, () => chamarRoteiros("comentario_resolver", { roteiro_id: linha.id, comentario_id: c.id, resolvido: !c.resolvido }))}
                  >
                    {c.resolvido ? "Reabrir" : "Resolver"}
                  </button>
                </p>
              </li>
            ))}
          </ul>
          <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="Comentário para a equipe ou para a próxima versão" className="mt-2 text-[12.5px]" aria-label="Novo comentário" />
          <div className="mt-2 flex items-center">
            <select value={bloco} onChange={(e) => setBloco(e.target.value)} className="mr-2 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[12px]" aria-label="Bloco do comentário">
              <option value="">Roteiro inteiro</option>
              {(atual ? atual.conteudo.blocos : []).map((b, i) => (
                <option key={b.id} value={b.id}>Bloco {i + 1}: {b.funcao}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              className="h-8 text-[12px]"
              disabled={!comentario.trim() || !!ocupado}
              onClick={() => void rodar("comentar", () => chamarRoteiros("comentar", { roteiro_id: linha.id, texto: comentario.trim(), bloco_id: bloco || undefined })).then((r) => r && setComentario(""))}
            >
              Comentar
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}
