import { useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { botao, etiqueta, juntar, lista as estiloDeLista } from "@/components/sistema/estilos";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { textoDoErro } from "@/lib/mesa/api";
import { useErrosDoEstudio, type ErroDoEstudio } from "@/lib/mesa/errosDoEstudio";
import { useMesa } from "./MesaContexto";

/**
 * "Ver erros (N)" na faixa do Estúdio (16/11/2026). O panorama da casa dizia
 * "erro: 7" da fila de geração e nenhuma tela mostrava quais nem por quê.
 *
 * Mostra as lâminas que deram erro nos últimos 7 (ou 30) dias, com o motivo em
 * português, marcando o que já foi resolvido por outra rodada do mesmo
 * trabalho e o que segue pendente. Só leitura: gerar de novo continua na peça.
 * Admin pode ver todos os clientes (o que a RLS deixa ver).
 *
 * O botão fica sempre na faixa: com erro nos últimos 7 dias deste cliente, "Ver erros (N)";
 * sem erro, só o ícone (dá para abrir os 30 dias ou, no admin, todos os clientes).
 */

type Vista = "pendentes" | "todos";
const ETAPAS: Record<string, string> = { fundo: "fundo", gerar: "gerar", conferir: "conferir", corrigir: "corrigir" };

export function quando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/** O que cabe na linha de baixo: lâmina, etapa, tentativas e quando. */
export function detalheDoErro(e: ErroDoEstudio): string {
  const partes: string[] = [];
  if (e.ordem) partes.push(`lâmina ${e.ordem}`);
  if (e.etapa) partes.push(`etapa ${ETAPAS[e.etapa] || e.etapa}`);
  if (e.tentativas) partes.push(`${e.tentativas} ${e.tentativas === 1 ? "tentativa" : "tentativas"}`);
  const q = quando(e.criado_em);
  if (q) partes.push(q);
  return partes.join(" · ");
}

function Chip({ ativo, onClick, children, dado }: { ativo: boolean; onClick: () => void; children: ReactNode; dado: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      data-filtro-erros={dado}
      className={juntar(botao.barra, "border border-border", ativo && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
    >
      {children}
    </button>
  );
}

export default function ErrosDoEstudio() {
  const { clientId, isAdmin } = useMesa();
  const [aberto, setAberto] = useState(false);
  const [vista, setVista] = useState<Vista>("pendentes");
  const [todosOsClientes, setTodosOsClientes] = useState(false);
  const [dias, setDias] = useState(7);
  // A contagem do botão: este cliente, 7 dias (leve: só erros, um minuto de cache).
  const doBotao = useErrosDoEstudio(clientId, 7);
  const alvo = isAdmin && todosOsClientes ? null : clientId;
  const daJanela = useErrosDoEstudio(alvo, dias, aberto);
  const leitura = alvo === clientId && dias === 7 ? doBotao : daJanela;

  const total = doBotao.data?.resumo.total || 0;
  const pendentesDoBotao = doBotao.data?.resumo.pendentes || 0;
  const itens = (leitura.data?.itens || []).filter((e) => vista === "todos" || !e.resolvido_depois);
  const resumo = leitura.data?.resumo;

  return (
    <>
      {total ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className={juntar(botao.barra, "my-1", pendentesDoBotao ? "text-warning hover:text-warning" : "")}
          title={`Erros da geração nos últimos 7 dias: ${pendentesDoBotao} pendente(s), ${total - pendentesDoBotao} já resolvido(s)`}
          data-abrir-erros-do-estudio=""
        >
          <AlertTriangle className="mr-1 h-4 w-4" aria-hidden="true" />
          Ver erros ({total})
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className={juntar(botao.icone, "my-1")}
          aria-label="Ver erros (0)"
          title="Nenhum erro da geração nos últimos 7 dias. Abrir para ver 30 dias."
          data-abrir-erros-do-estudio=""
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <JanelaCentral
        aberta={aberto}
        onMudar={setAberto}
        largura="lg"
        corpo="fixo"
        semEspaco
        icone={<AlertTriangle className="h-4 w-4" />}
        titulo="Erros do Estúdio"
        descricao={resumo ? `${resumo.total} em ${dias} dias · ${resumo.pendentes} pendente(s) · ${resumo.resolvidos} já resolvido(s)` : undefined}
        ajuda="Lâminas da fila de geração que deram erro. “Já resolvido” quer dizer que outra rodada da mesma peça terminou certo depois. Para gerar de novo, abra a peça no Estúdio."
        acoes={
          <button type="button" className={botao.icone} aria-label="Ler de novo" title="Ler de novo" onClick={() => void leitura.refetch()} disabled={leitura.isFetching}>
            <RefreshCw className={juntar("h-4 w-4", leitura.isFetching && "animate-spin")} aria-hidden="true" />
          </button>
        }
        data-erros-do-estudio=""
      >
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-2">
          <Chip ativo={vista === "pendentes"} onClick={() => setVista("pendentes")} dado="pendentes">Pendentes</Chip>
          <Chip ativo={vista === "todos"} onClick={() => setVista("todos")} dado="todos">Todos</Chip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Chip ativo={dias === 7} onClick={() => setDias(7)} dado="7d">7 dias</Chip>
          <Chip ativo={dias === 30} onClick={() => setDias(30)} dado="30d">30 dias</Chip>
          {isAdmin && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <Chip ativo={!todosOsClientes} onClick={() => setTodosOsClientes(false)} dado="cliente">Este cliente</Chip>
              <Chip ativo={todosOsClientes} onClick={() => setTodosOsClientes(true)} dado="todos-os-clientes">Todos os clientes</Chip>
            </>
          )}
        </div>
        <RegiaoRolavel modo="sempre" classeDeFora="min-h-0 flex-1" className="p-3" sobre="cartao" rotulo="Erros do Estúdio">
          {leitura.isLoading && <p className="flex items-center text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Lendo os erros…</p>}
          {leitura.isError && <p className="rounded-md bg-destructive/10 p-2.5 text-[13px]">{textoDoErro(leitura.error)}</p>}
          {leitura.isSuccess && !itens.length && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              {vista === "pendentes" && resumo && resumo.total ? "Nenhum erro pendente: todos já foram resolvidos por outra rodada." : "Nenhum erro nesta janela."}
            </p>
          )}
          {leitura.data?.mais && <p className="mb-2 text-[12px] text-muted-foreground">Mostrando os 100 mais recentes.</p>}
          <ul className={juntar(estiloDeLista.aberta, estiloDeLista.divisoria)} aria-label="Erros do Estúdio">
            {itens.map((e) => (
              <li key={e.id} className={juntar(estiloDeLista.linha, "items-start")} data-erro-do-estudio={e.id} data-resolvido={e.resolvido_depois ? "sim" : "nao"}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="min-w-0 text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{e.titulo || "Peça sem título"}</p>
                    {e.resolvido_depois ? (
                      <span className={juntar(etiqueta, "bg-muted text-foreground")} title={e.resolvido_em ? `Outra rodada terminou certo em ${quando(e.resolvido_em)}` : undefined}>Já resolvido</span>
                    ) : (
                      <span className={juntar(etiqueta, "bg-warning/15 text-warning")}>Pendente</span>
                    )}
                    {e.orfao && <span className={juntar(etiqueta, "bg-muted text-muted-foreground")} title={e.motivo_orfao || undefined}>Órfão</span>}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug [overflow-wrap:anywhere]">{e.erro_mensagem}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground [overflow-wrap:anywhere]">
                    {alvo === null && e.cliente ? `${e.cliente} · ` : ""}
                    {detalheDoErro(e)}
                    {e.erro_codigo ? <span className="ml-1 font-mono text-[11px]" title={e.erro_original || undefined}>({e.erro_codigo})</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </RegiaoRolavel>
      </JanelaCentral>
    </>
  );
}
