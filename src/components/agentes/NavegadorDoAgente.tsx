import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Images, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import Secao from "@/components/sistema/Secao";
import { botao, etiqueta, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import {
  type CasoDoNavegador,
  DEFINICOES_DOS_CASOS,
  decidirTarefa,
  executorLigado,
  invalidarNavegador,
  pararTarefa,
  pedirAoNavegador,
  provasDaTarefa,
  type ProvaNaTela,
  resumoDoResultado,
  ROTULO_DA_TAREFA,
  tarefaAtiva,
  type TarefaDoNavegador,
  useEstadoDoNavegador,
  useTarefasDoNavegador,
} from "@/lib/agentes/navegadorApi";

/**
 * Navegador do agente (frente MOD, 30/09/2026): computer use pela API, só
 * leitura e coleta. Tudo abre na JanelaCentral (regra do dono: pop-up no meio, nunca gaveta).
 *
 * - BotaoDoNavegador: pede uma tarefa (capturar site, conferir post, coletar
 *   dados públicos). A tarefa nasce esperando o dono.
 * - TarefasDoNavegador: a fila do cliente com Confirmar (só o dono), Parar (o
 *   dono ou quem pediu, a qualquer momento) e as provas (um print por passo).
 */

const TRAVAS =
  "Roda num navegador isolado da máquina da agência, só depois do Confirmar do dono. Só abre os domínios da lista, não envia formulário, não faz login nem pagamento (página com senha ou cartão faz parar), guarda um print de cada passo e para no teto de passos e de custo ou quando alguém clica em Parar.";

const COR_DO_ESTADO: Record<string, string> = {
  aguardando_dono: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  aprovada: "bg-muted text-foreground",
  executando: "bg-primary/10 text-primary",
  feita: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  falhou: "bg-destructive/10 text-destructive",
  cancelada: "bg-muted text-muted-foreground",
};

export function BotaoDoNavegador({
  caso,
  clientId,
  origem,
  url = "",
  rotulo,
  compacto = false,
}: {
  caso: CasoDoNavegador;
  clientId: string | null;
  origem: "mesa_site" | "agenda" | "proposta" | "painel";
  url?: string;
  rotulo?: string;
  compacto?: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  // Caso com modelo nasce desligado no código: só o servidor diz se a variável ligou (busca já).
  const estado = useEstadoDoNavegador(aberto || DEFINICOES_DOS_CASOS[caso].usaModelo);
  const [endereco, setEndereco] = useState(url);
  const [dominios, setDominios] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const def = DEFINICOES_DOS_CASOS[caso];
  const noServidor = estado.data ? estado.data.casos.find((c) => c.valor === caso) : null;
  const motivo = noServidor ? noServidor.motivo : def.usaModelo ? def.motivoDesligado : null;
  const ligado = noServidor ? noServidor.ligado : !def.usaModelo;
  const nome = rotulo || def.rotulo;

  const pedir = async () => {
    setEnviando(true);
    try {
      await pedirAoNavegador({ caso, url: endereco.trim(), dominios, objetivo: objetivo.trim() || undefined, origem, client_id: clientId });
      toast.success("Pedido feito", { description: "A tarefa espera o Confirmar do dono e roda no navegador isolado da agência." });
      setAberto(false);
      invalidarNavegador(qc);
    } catch (e) {
      toast.error("O navegador do agente recusou o pedido", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={juntar(compacto ? botao.barra : botao.secundario)}
        onClick={() => { setEndereco(url); setAberto(true); }}
        disabled={!ligado}
        title={ligado ? nome : String(motivo || "Desligado")}
        aria-label={nome}
        data-navegador-do-agente={caso}
        data-ligado={ligado ? "sim" : "nao"}
      >
        <Globe className="h-3.5 w-3.5 sm:mr-1.5" />
        <span className={compacto ? "hidden sm:inline" : ""}>{nome}</span>
      </button>
      <JanelaCentral
        aberta={aberto}
        onMudar={(v) => { if (!enviando) setAberto(v); }}
        largura="md"
        icone={<Globe className="h-4 w-4" />}
        titulo={nome}
        ajuda={TRAVAS}
        descricao={`Espera o Confirmar do dono. Até ${def.tetoPassos} passos${def.tetoCustoUsd > 0 ? `, até US$ ${def.tetoCustoUsd.toFixed(2)}` : ", sem custo de modelo"}.`}
        rodape={
          <>
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => setAberto(false)} disabled={enviando}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void pedir()} disabled={enviando || !endereco.trim()}>
              {enviando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Pedir ao dono
            </button>
          </>
        }
      >
          <div className="space-y-3">
            <label className="block">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Endereço</span>
              <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="https://site.com.br" inputMode="url" />
            </label>
            <label className="block">
              <span className={juntar(texto.rotulo, "mb-1 block")}>Outros domínios permitidos (opcional)</span>
              <Input value={dominios} onChange={(e) => setDominios(e.target.value)} placeholder="cdn.site.com.br, loja.site.com.br" />
            </label>
            {def.usaModelo && (
              <label className="block">
                <span className={juntar(texto.rotulo, "mb-1 block")}>O que coletar</span>
                <Textarea value={objetivo} onChange={(e) => setObjetivo(e.target.value)} rows={3} maxLength={500} placeholder="Serviços, preços públicos e diferenciais da página inicial" />
              </label>
            )}
          </div>
      </JanelaCentral>
    </>
  );
}

export function TarefasDoNavegador({ clientId, origem, url, titulo = "Navegador do agente" }: { clientId: string | null; origem?: string; url?: string; titulo?: string }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const admin = !!profile && profile.role === "admin";
  const tarefasQ = useTarefasDoNavegador(clientId, origem);
  const estadoQ = useEstadoDoNavegador(!!(tarefasQ.data && tarefasQ.data.itens.length));
  const [confirmando, setConfirmando] = useState<TarefaDoNavegador | null>(null);
  const [provas, setProvas] = useState<{ tarefa: TarefaDoNavegador; lista: ProvaNaTela[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const tarefas = ((tarefasQ.data && tarefasQ.data.itens) || []).filter((t) => !url || t.url_inicial === url || t.url_inicial === `${url}/`);
  const ligado = executorLigado(estadoQ.data);
  const pendentes = tarefas.filter((t) => t.estado === "aguardando_dono").length;

  const agir = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setOcupado(id);
    try {
      await fn();
      toast.success(ok);
      invalidarNavegador(qc);
    } catch (e) {
      toast.error("Não deu certo", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const abrirProvas = async (t: TarefaDoNavegador) => {
    setOcupado(t.id);
    try {
      const r = await provasDaTarefa(t.id);
      setProvas({ tarefa: t, lista: r.provas || [] });
    } catch (e) {
      toast.error("Não deu para abrir as provas", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  if (!tarefas.length && !tarefasQ.isError) return null;

  return (
    <Secao
      divisoria
      nivel={3}
      titulo={titulo}
      resumo={pendentes ? `${pendentes} esperando o dono` : ligado ? "Executor ligado" : "Executor desligado"}
      recolher={`navegador-do-agente:${clientId || "agencia"}:${origem || "todas"}`}
      ajuda={`${TRAVAS} ${ligado ? "O executor da agência está ligado." : "Nenhum executor ligado agora: a tarefa aprovada espera até um dia (workers/computador)."}`}
      data-navegador-do-agente-fila
    >
      {tarefasQ.isError && <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(tarefasQ.error)}</p>}
      <ul className="divide-y divide-border">
        {tarefas.map((t) => (
          <li key={t.id} className="flex min-w-0 flex-wrap items-center py-2">
            <div className="mr-2 min-w-0 flex-1">
              <p className="truncate text-[13px] leading-5">{t.titulo}</p>
              <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>
                {t.dominios.join(", ")} · {t.passos_feitos}/{t.teto_passos} passos{Number(t.custo_usd) > 0 ? ` · US$ ${Number(t.custo_usd).toFixed(2)}` : ""}
                {resumoDoResultado(t) ? ` · ${resumoDoResultado(t)}` : ""}
              </p>
            </div>
            <span className={juntar(etiqueta, "mr-1", t.vencida ? "bg-muted" : COR_DO_ESTADO[t.estado] || "bg-muted")}>{t.vencida ? "Venceu" : ROTULO_DA_TAREFA[t.estado] || t.estado}</span>
            {admin && t.estado === "aguardando_dono" && (
              <button type="button" className={botao.barra} onClick={() => setConfirmando(t)} disabled={ocupado === t.id} aria-label={`Confirmar ${t.titulo}`}>
                <Check className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Confirmar</span>
              </button>
            )}
            {tarefaAtiva(t) && (admin || (profile && t.criado_por === profile.id)) && (
              <button type="button" className={botao.barra} onClick={() => void agir(t.id, () => pararTarefa(t.id), "Parada")} disabled={ocupado === t.id} aria-label={`Parar ${t.titulo}`}>
                <Square className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Parar</span>
              </button>
            )}
            {t.passos_feitos > 0 && (
              <button type="button" className={botao.barra} onClick={() => void abrirProvas(t)} disabled={ocupado === t.id} aria-label={`Provas de ${t.titulo}`}>
                <Images className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Provas</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      <JanelaCentral
        aberta={!!confirmando}
        onMudar={(v) => { if (!v && !ocupado) setConfirmando(null); }}
        largura="md"
        icone={<Check className="h-4 w-4" />}
        titulo="Confirmar a tarefa do navegador"
        descricao={confirmando ? confirmando.titulo : ""}
        ajuda={TRAVAS}
        rodape={
          <>
            <button
              type="button"
              className={juntar(botao.discreto, "mr-2")}
              onClick={() => confirmando && void agir(confirmando.id, () => decidirTarefa(confirmando.id, "cancelada"), "Cancelada").then(() => setConfirmando(null))}
              disabled={!!ocupado}
            >
              Recusar
            </button>
            <button
              type="button"
              className={botao.primario}
              onClick={() => confirmando && void agir(confirmando.id, () => decidirTarefa(confirmando.id, "aprovada"), "Confirmada: vai para o navegador da agência").then(() => setConfirmando(null))}
              disabled={!!ocupado}
            >
              {ocupado && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirmar
            </button>
          </>
        }
      >
          {confirmando && (
            <dl className="space-y-2 text-[13px] leading-5">
              <div><dt className={texto.rotulo}>Endereço</dt><dd className="[overflow-wrap:anywhere]">{confirmando.url_inicial}</dd></div>
              <div><dt className={texto.rotulo}>Só estes domínios</dt><dd className="[overflow-wrap:anywhere]">{confirmando.dominios.join(", ")}</dd></div>
              {confirmando.objetivo && <div><dt className={texto.rotulo}>O que coletar</dt><dd>{confirmando.objetivo}</dd></div>}
              <div><dt className={texto.rotulo}>Teto</dt><dd>{confirmando.teto_passos} passos{Number(confirmando.teto_custo_usd) > 0 ? ` e US$ ${Number(confirmando.teto_custo_usd).toFixed(2)} de modelo` : ", sem modelo (roteiro fixo, custo zero)"}</dd></div>
              <div><dt className={texto.rotulo}>Travas</dt><dd>Só leitura; sem login, senha, formulário ou pagamento; um print por passo; Parar a qualquer momento.</dd></div>
              {!ligado && <p className="text-[12px] text-amber-700 dark:text-amber-300">Nenhum executor ligado agora: depois do Confirmar, a tarefa espera até um dia.</p>}
            </dl>
          )}
      </JanelaCentral>

      <JanelaCentral
        aberta={!!provas}
        onMudar={(v) => { if (!v) setProvas(null); }}
        largura="xl"
        icone={<Images className="h-4 w-4" />}
        titulo="Provas, passo a passo"
        descricao={provas ? provas.tarefa.titulo : ""}
      >
          {provas && (
            <ol className="space-y-4">
              {provas.lista.map((p) => (
                <li key={p.passo} className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1")}>Passo {p.passo}: {p.legenda}</p>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" className="block">
                      <img src={p.url} alt={`Passo ${p.passo}: ${p.legenda}`} className="w-full rounded-md border border-border" loading="lazy" />
                    </a>
                  ) : (
                    <p className={texto.auxiliar}>Print indisponível.</p>
                  )}
                </li>
              ))}
              {!provas.lista.length && <li className={texto.auxiliar}>Sem provas ainda.</li>}
            </ol>
          )}
      </JanelaCentral>
    </Secao>
  );
}
