import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, KeyRound, RefreshCw } from "lucide-react";
import { AjudaRecolhida, Carregando, EstadoDeErro, Secao, botao, foco, juntar, lista, texto } from "@/components/sistema";
import {
  CHAVE_DO_ESTADO_DOS_MOTORES,
  COR_DA_SITUACAO,
  lerEstadoDosMotores,
  ordenarPorUrgencia,
  rotuloDaSituacao,
  type EstadoDoMotor,
} from "@/lib/motores/estadoDosMotores";
import { dataCurta } from "../../../supabase/functions/motores-estado/modulos/estado";

/**
 * Configurações, Estado dos motores (frente MTR, 30/09/2026): uma linha por
 * motor (site, render do Motion, render da Mesa Edição, imagem, vídeo e as
 * chaves da IA) com a situação e o resumo; abrindo a linha, o último sinal,
 * a fila, o último erro legível e o que falta fazer. Só leitura, sem custo.
 *
 * Carregado sob demanda pela linha "Estado dos motores" da SettingsPage.
 */

export const AJUDA_DOS_MOTORES =
  "Os motores são o que trabalha fora da tela: o motor de código do site e o worker de render (Motion e Mesa Edição) rodam " +
  "na máquina da agência; a geração de imagem e de vídeo roda no servidor com as chaves dos provedores. Parado quer dizer " +
  "que o pedido espera na fila até o motor voltar. O passo a passo para ligar está em docs/motores/LIGAR-OS-MOTORES.md " +
  "(workers\\ligar\\ligar-todos.cmd liga os dois workers). Nada aqui gasta crédito.";

function LinhaDoMotor({ m, aberto, onAlternar, onAbrirChaves }: { m: EstadoDoMotor; aberto: boolean; onAlternar: () => void; onAbrirChaves?: (id?: string | null) => void }) {
  const chaves = Array.isArray(m.chaves) ? m.chaves : [];
  const cor = COR_DA_SITUACAO[m.situacao];
  const idDoCorpo = `motor-${m.id}-detalhes`;
  return (
    <li className="min-w-0" data-motor={m.id} data-situacao={m.situacao}>
      <button type="button" onClick={onAlternar} aria-expanded={aberto} aria-controls={idDoCorpo} className={juntar(lista.linha, "w-full text-left", foco)}>
        <span className={juntar("mr-3 h-2 w-2 shrink-0 rounded-full", cor.ponto)} aria-hidden="true" />
        <span className="mr-3 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{m.nome}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{m.resumo}</span>
        </span>
        <span className={juntar(texto.etiqueta, "mr-2 shrink-0", cor.texto)}>{rotuloDaSituacao(m)}</span>
        <ChevronRight className={juntar("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} aria-hidden="true" />
      </button>
      {aberto && (
        <div id={idDoCorpo} className="min-w-0 pb-3 pl-7 pr-2">
          <dl className={juntar(texto.auxiliar, "min-w-0")}>
            {m.ultimo_sinal && (
              <div className="flex min-w-0 py-0.5">
                <dt className="mr-2 shrink-0">Último sinal</dt>
                <dd className="min-w-0 text-foreground">{dataCurta(m.ultimo_sinal)}</dd>
              </div>
            )}
            {(m.fila.esperando > 0 || m.fila.rodando > 0) && (
              <div className="flex min-w-0 py-0.5">
                <dt className="mr-2 shrink-0">Fila</dt>
                <dd className="min-w-0 text-foreground">
                  {m.fila.esperando} esperando, {m.fila.rodando} em andamento
                  {m.fila.desde ? ` (desde ${dataCurta(m.fila.desde)})` : ""}
                </dd>
              </div>
            )}
            {m.ultimo_erro && (
              <div className="flex min-w-0 py-0.5" data-ultimo-erro="">
                <dt className="mr-2 shrink-0">Último erro{m.ultimo_erro.em ? ` (${dataCurta(m.ultimo_erro.em)})` : ""}</dt>
                <dd className="min-w-0 break-words text-foreground">{m.ultimo_erro.texto}</dd>
              </div>
            )}
          </dl>
          {m.falta.length > 0 && (
            <div className="mt-2 min-w-0" data-falta="">
              <p className={juntar(texto.rotulo, "mb-1")}>O que fazer</p>
              <ol className={juntar(texto.corpo, "min-w-0 list-decimal pl-5")}>
                {m.falta.map((f) => (
                  <li key={f} className="break-words py-0.5">
                    {f}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {m.detalhes.length > 0 && (
            <ul className={juntar(texto.auxiliar, "mt-2 min-w-0 list-disc pl-5")}>
              {m.detalhes.map((d) => (
                <li key={d} className="break-words py-0.5">
                  {d}
                </li>
              ))}
            </ul>
          )}
          {chaves.length > 0 && (
            <p className={juntar(texto.auxiliar, "mt-2")} data-atalho-chaves="">
              {onAbrirChaves ? (
                <button type="button" onClick={() => onAbrirChaves(chaves[0])} className={juntar("inline-flex items-center font-medium text-primary underline-offset-2 hover:underline", foco)}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Abrir Chaves e custos
                </button>
              ) : (
                "Peça a um admin para cadastrar a chave em Configurações › Chaves e custos."
              )}
            </p>
          )}
          {!m.ultimo_sinal && !m.ultimo_erro && !m.falta.length && !m.detalhes.length && !chaves.length && m.fila.esperando + m.fila.rodando === 0 && (
            <p className={texto.auxiliar}>Nada pendente.</p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * `semTitulo`: dentro da linha "Estado dos motores" das Configurações (a linha
 * já é o título). `onAbrirChaves`: o motor sem chave mostra o atalho para
 * Configurações › Chaves e custos (frente CHV; só o admin recebe).
 */
export default function EstadoDosMotores({ semTitulo = false, onAbrirChaves }: { semTitulo?: boolean; onAbrirChaves?: (id?: string | null) => void } = {}) {
  const q = useQuery({ queryKey: CHAVE_DO_ESTADO_DOS_MOTORES, queryFn: lerEstadoDosMotores, staleTime: 30_000, refetchOnWindowFocus: false });
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const alternar = (id: string) => setAbertos((a) => ({ ...a, [id]: !a[id] }));
  const atualizar = (
    <button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className={juntar(botao.secundario, "h-8 px-3")} data-atualizar-motores="">
      <RefreshCw className={juntar("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} aria-hidden="true" />
      Atualizar
    </button>
  );
  const quadro = q.data;
  const descricao = quadro ? `${quadro.geral.texto} · conferido ${dataCurta(quadro.conferido_em)}` : undefined;
  return (
    <Secao titulo={semTitulo ? undefined : "Estado dos motores"} descricao={descricao} ajuda={semTitulo ? undefined : AJUDA_DOS_MOTORES} acao={semTitulo ? <><AjudaRecolhida rotulo="O que são os motores">{AJUDA_DOS_MOTORES}</AjudaRecolhida>{atualizar}</> : atualizar} recolher={false} data-estado-dos-motores="">
      {q.isLoading ? (
        <Carregando rotulo="Conferindo os motores" linhas={4} />
      ) : q.isError ? (
        <EstadoDeErro titulo="Não foi possível ler o estado dos motores." descricao={q.error instanceof Error ? q.error.message : undefined} acao={atualizar} />
      ) : quadro ? (
        <>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {ordenarPorUrgencia(quadro.motores).map((m) => (
              <LinhaDoMotor key={m.id} m={m} aberto={!!abertos[m.id]} onAlternar={() => alternar(m.id)} onAbrirChaves={onAbrirChaves} />
            ))}
          </ul>
          {quadro.avisos.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>Leitura incompleta: {quadro.avisos.slice(0, 3).join("; ")}</p>}
        </>
      ) : null}
    </Secao>
  );
}
