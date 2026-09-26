import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Check, CheckCircle2, ClipboardCheck, Loader2, MessageSquare, Pencil, RotateCcw, Video } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { dataEHora, usd } from "@/lib/mesa/api";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  duracaoEstimada,
  modoDoTipo,
  motivoParaNaoMudar,
  versaoPorNumero,
  type LinhaDoRoteiro,
  type StatusDoRoteiro,
} from "../../../supabase/functions/_shared/roteiro-modelo";
import { atualizarNoCache, chamarRoteiros, mudarStatus, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, AvisoDoJevCartao, Cabecalho, RotuloLargo, SeloDoStatus } from "./Comuns";

/**
 * Etapa 3: revisão salva. Versões (cada uma com origem, nota, custo e código),
 * comentários por bloco, e o status: Aprovar (a versão atual fica aprovada e
 * imutável; o roteiro aprovado fica ligado à peça da agenda e vira modelo do
 * cliente), Marcar como gravado, Voltar e Arquivar.
 *
 * Sistema de design (26/09): sem cartão por seção; a versão vista e o
 * rascunho do comentário ficam guardados por roteiro.
 */

const ORIGEM: Record<string, string> = { ia: "gerada pela IA", edicao: "edição da equipe", agente: "pedido ao agente", modelo: "a partir de modelo" };

export default function EtapaRevisao({ roteiroId, onAbrirRoteiro }: { roteiroId: string | null; onAbrirRoteiro: (id: string, etapa?: "roteiro" | "revisao") => void }) {
  const { clientId } = useMesa();
  const roteirosQ = useRoteiros(clientId);
  const lista = roteirosQ.data ? roteirosQ.data.lista : [];
  const linha = roteiroId ? lista.filter((r) => r.id === roteiroId)[0] || null : null;

  if (roteirosQ.data && roteirosQ.data.indisponivel) return <AvisoDoBanco />;
  if (roteirosQ.isLoading) return <Carregando forma="lista" linhas={4} rotulo="Lendo os roteiros" />;
  if (!linha) {
    const vivos = lista.filter((r) => !r.arquivado_em);
    return (
      <section className="min-w-0 space-y-3">
        <Cabecalho titulo="Escolha o roteiro para revisar" estado={`${vivos.length} ${vivos.length === 1 ? "roteiro" : "roteiros"}`} />
        {!vivos.length ? (
          <EstadoVazio compacto titulo="Nenhum roteiro ainda." descricao="Comece pela Agenda." />
        ) : (
          <ul className={juntar(superficie.painel, "divide-y divide-border")}>
            {vivos.map((r) => (
              <li key={r.id} className="flex min-w-0 items-center px-4 py-2.5">
                <span className="mr-2 min-w-0 flex-1 truncate text-[13px]">{r.titulo}</span>
                <SeloDoStatus status={r.status} />
                <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-3 text-[12px]")} onClick={() => onAbrirRoteiro(r.id, "revisao")}>
                  Revisar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return <Revisao key={linha.id} linha={linha} onAbrirRoteiro={onAbrirRoteiro} />;
}

function Revisao({ linha, onAbrirRoteiro }: { linha: LinhaDoRoteiro; onAbrirRoteiro: (id: string, etapa?: "roteiro" | "revisao") => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  // A versão vista (por roteiro e versão atual: versão nova abre nela) e o rascunho do
  // comentário ficam guardados (sair e voltar mantém).
  const [vendo, setVendo] = useEstadoDaTela<number>(`mesa-roteiros:revisao:vendo:${linha.id}:${linha.versao_atual}`, linha.versao_atual, {
    validar: (v) => typeof v === "number" && linha.versoes.some((x) => x.numero === v),
  });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [comentario, setComentario] = useEstadoDaTela<string>(`mesa-roteiros:revisao:comentario:${linha.id}`, "");
  const [bloco, setBloco] = useState("");
  const versao = versaoPorNumero(linha.versoes, vendo) || versaoPorNumero(linha.versoes, linha.versao_atual);
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
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" data-revisao={linha.id}>
      <div className="min-w-0 space-y-6">
        <section className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-start">
            <div className="mr-3 min-w-0 flex-1">
              <h2 className="truncate text-[18px] font-semibold leading-7">{linha.titulo}</h2>
              <p className={juntar(texto.auxiliar, "truncate")}>
                {modoDoTipo(linha.tipo).rotulo} · v{linha.versao_atual}
                {linha.versao_aprovada ? ` · aprovada v${linha.versao_aprovada}${linha.aprovado_em ? ` em ${dataEHora(linha.aprovado_em)}` : ""}` : " · ainda não aprovada"}
                {linha.task_id ? " · ligado à peça da agenda" : " · avulso"}
                {arquivado ? " · arquivado" : ""}
              </p>
            </div>
            <SeloDoStatus status={linha.status} />
          </div>
          <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1" data-acoes-de-status="">
            {podeIr("aprovado") && (
              <button
                type="button"
                className={botao.primario}
                disabled={!!ocupado}
                onClick={() => void status("aprovado", linha.status === "gravado" ? "Voltou para aprovado" : `Versão ${linha.versao_atual} aprovada`)}
              >
                {ocupado === "status:aprovado" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                {linha.status === "gravado" ? "Voltar para aprovado" : "Aprovar"}
              </button>
            )}
            {podeIr("gravado") && (
              <button type="button" className={botao.secundario} disabled={!!ocupado} onClick={() => void status("gravado", "Marcado como gravado")}>
                <Video className="mr-1 h-3.5 w-3.5" />
                Marcar como gravado
              </button>
            )}
            {podeIr("rascunho") && (
              <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => void status("rascunho", "Voltou para rascunho")}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Voltar para rascunho
              </button>
            )}
            <button
              type="button"
              className={botao.discreto}
              disabled={!!ocupado}
              aria-label={arquivado ? "Desarquivar" : "Arquivar"}
              onClick={() => void rodar("arquivar", () => chamarRoteiros("arquivar", { roteiro_id: linha.id, arquivar: !arquivado }), arquivado ? "Roteiro desarquivado" : "Roteiro arquivado")}
            >
              {arquivado ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              <RotuloLargo>{arquivado ? "Desarquivar" : "Arquivar"}</RotuloLargo>
            </button>
            <button type="button" className={botao.secundario} onClick={() => onAbrirRoteiro(linha.id, "roteiro")} aria-label="Editar roteiro">
              <Pencil className="h-3.5 w-3.5" />
              <RotuloLargo>Editar roteiro</RotuloLargo>
            </button>
          </div>
          {linha.status === "rascunho" && <p className={texto.auxiliar}>Aprovar trava a versão {linha.versao_atual}: corrigir depois cria outra versão.</p>}
        </section>

        {versao && (
          <section className="min-w-0 space-y-3 border-t border-border pt-5" data-versao-vista={versao.numero}>
            <Cabecalho
              nivel={3}
              titulo={`Versão ${versao.numero}${versao.numero === linha.versao_atual ? " (atual)" : ""}`}
              estado={`${duracaoEstimada(versao.conteudo).min_s} a ${duracaoEstimada(versao.conteudo).max_s}s · código ${versao.hash}`}
              acoes={
                versao.numero !== linha.versao_atual && !arquivado && linha.status !== "gravado" ? (
                  <button
                    type="button"
                    className={botao.secundario}
                    disabled={!!ocupado}
                    aria-label="Restaurar esta versão"
                    onClick={() =>
                      void rodar("restaurar", () => chamarRoteiros("versao_restaurar", { roteiro_id: linha.id, versao: versao.numero }), `Versão ${versao.numero} restaurada como nova versão`).then(
                        (r) => r && r.versao && setVendo(r.versao.numero),
                      )
                    }
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <RotuloLargo>Restaurar esta versão</RotuloLargo>
                  </button>
                ) : null
              }
            />
            <AvisoDoJevCartao aviso={versao.aviso} />
            <ol className="divide-y divide-border">
              {versao.conteudo.blocos.map((b, i) => (
                <li key={b.id} className={juntar("min-w-0 py-2.5", i === 0 && "border-l-2 border-primary pl-3")}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {String(i + 1).padStart(2, "0")} {b.funcao} · {b.segundos}s
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{b.fala}</p>
                  {(b.texto_na_tela || b.broll) && (
                    <p className="mt-1 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{[b.texto_na_tela ? `Na tela: ${b.texto_na_tela}` : "", b.broll ? `Apoio: ${b.broll}` : ""].filter(Boolean).join(" · ")}</p>
                  )}
                </li>
              ))}
            </ol>
            {versao.conteudo.cta && (
              <p className="text-[12.5px] [overflow-wrap:anywhere]">
                <span className="font-medium">CTA:</span> {versao.conteudo.cta}
              </p>
            )}
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-6 border-t border-border pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
        <section className="min-w-0 space-y-2" data-versoes="">
          <Cabecalho nivel={3} icone={<ClipboardCheck className="h-4 w-4" />} titulo="Versões" estado={`${linha.versoes.length} ${linha.versoes.length === 1 ? "versão" : "versões"}`} />
          <ul className="space-y-0.5 xl:max-h-[320px] xl:overflow-y-auto xl:overscroll-contain">
            {linha.versoes
              .slice()
              .reverse()
              .map((v) => (
                <li key={v.numero}>
                  <button
                    type="button"
                    onClick={() => setVendo(v.numero)}
                    className={juntar("w-full rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors", versao && versao.numero === v.numero ? "bg-primary/10" : "hover:bg-muted", foco)}
                    aria-pressed={!!versao && versao.numero === v.numero}
                  >
                    <span className="font-medium">Versão {v.numero}</span>
                    {v.numero === linha.versao_atual && <span className="ml-1 text-primary">atual</span>}
                    {v.numero === linha.versao_aprovada && (
                      <span className="ml-1 inline-flex items-center text-primary">
                        <Check className="mr-0.5 h-3 w-3" />
                        aprovada
                      </span>
                    )}
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {ORIGEM[v.origem] || v.origem} · {dataEHora(v.criado_em)}
                      {v.custo_usd ? ` · ${usd(v.custo_usd)}` : ""}
                      {v.nota ? ` · ${v.nota}` : ""}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>

        <section className="min-w-0 space-y-2 border-t border-border pt-5" data-comentarios="">
          <Cabecalho
            nivel={3}
            icone={<MessageSquare className="h-4 w-4" />}
            titulo="Comentários"
            ajuda={'Os abertos entram no próximo "Gerar de novo".'}
            estado={abertos.length ? `${abertos.length} ${abertos.length === 1 ? "aberto" : "abertos"}` : "Nenhum aberto"}
          />
          <ul className="divide-y divide-border xl:max-h-[320px] xl:overflow-y-auto xl:overscroll-contain">
            {linha.comentarios
              .slice()
              .reverse()
              .map((c) => (
                <li key={c.id} className={juntar("py-2 text-[12.5px]", c.resolvido && "opacity-60")}>
                  <p className={juntar("[overflow-wrap:anywhere]", !c.resolvido && "border-l-2 border-primary/50 pl-2")}>{c.texto}</p>
                  <p className="mt-1 flex min-w-0 items-center text-[11px] text-muted-foreground">
                    <span className="mr-auto min-w-0 truncate">
                      {c.autor_nome} · versão {c.versao}
                      {c.bloco_id ? ` · bloco ${c.bloco_id.replace("b", "")}` : ""}
                    </span>
                    <button
                      type="button"
                      className={juntar("ml-2 shrink-0 rounded-sm underline-offset-2 hover:underline", foco)}
                      disabled={!!ocupado}
                      onClick={() => void rodar(`c:${c.id}`, () => chamarRoteiros("comentario_resolver", { roteiro_id: linha.id, comentario_id: c.id, resolvido: !c.resolvido }))}
                    >
                      {c.resolvido ? "Reabrir" : "Resolver"}
                    </button>
                  </p>
                </li>
              ))}
          </ul>
          <CampoDeFormulario rotulo="Novo comentário">
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Para a equipe ou para a próxima versão"
              className={juntar(campoTexto, "min-h-[64px]")}
              aria-label="Novo comentário"
            />
          </CampoDeFormulario>
          <div className="flex min-w-0 items-center">
            <select value={bloco} onChange={(e) => setBloco(e.target.value)} className={juntar(campo, "mr-2 min-w-0 flex-1")} aria-label="Bloco do comentário">
              <option value="">Roteiro inteiro</option>
              {(atual ? atual.conteudo.blocos : []).map((b, i) => (
                <option key={b.id} value={b.id}>
                  Bloco {i + 1}: {b.funcao}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={botao.primario}
              disabled={!comentario.trim() || !!ocupado}
              onClick={() => void rodar("comentar", () => chamarRoteiros("comentar", { roteiro_id: linha.id, texto: comentario.trim(), bloco_id: bloco || undefined })).then((r) => r && setComentario(""))}
            >
              Comentar
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
