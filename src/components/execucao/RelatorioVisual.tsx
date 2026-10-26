import { useState } from "react";
import { nomeDaTarefaDoBanco } from "@/lib/nomeDaTarefa";
import { AlertTriangle, CheckCircle2, Clock, Hand, ListTodo } from "lucide-react";
import { falhaDaExecucao, estadoDaExecucao, destinoDaEvidencia } from "@/lib/execucaoApresentacao";
import { fraseDoAgente, tipoDaEntrega } from "@/lib/execucaoHumana";
import { limparTecnico } from "@/lib/cadernoExecucao";
import EvidenciaVisual from "./EvidenciaVisual";
import { botao, juntar, superficie } from "@/components/sistema";

/**
 * Relatório da execução em quadro (16/10/2026, dono: "a aba de relatório está muito confusa...
 * na fila, tem que ser mais visual, mais intuitivo"). Quatro colunas que contam o fluxo (Na fila,
 * Fazendo, Esperando você, Feito), cada cartão com o tipo da entrega, o agente falando o que faz
 * e a prova em miniatura; abaixo, as falhas da semana em frase de gente. Clicar abre o diário.
 */

type Coluna = { id: string; nome: string; Icone: typeof Clock; cor: string; fundo: string; estados: string[]; soComProva?: boolean };
const COLUNAS: Coluna[] = [
  { id: "fila", nome: "Na fila", Icone: ListTodo, cor: "text-muted-foreground", fundo: "bg-muted-foreground", estados: ["queued"] },
  { id: "fazendo", nome: "Fazendo", Icone: Clock, cor: "text-info", fundo: "bg-info", estados: ["in_progress"] },
  { id: "voce", nome: "Esperando você", Icone: Hand, cor: "text-warning", fundo: "bg-warning", estados: ["review", "awaiting_input", "blocked"] },
  { id: "feito", nome: "Feito com prova", Icone: CheckCircle2, cor: "text-success", fundo: "bg-success", estados: ["done"], soComProva: true },
];
const POR_COLUNA = 8;

export default function RelatorioVisual({ vinculos, runs, agentes, tarefas, aoAbrir }: {
  vinculos: Record<string, any>[]; runs: Record<string, any>[]; agentes: { id: string; display_name: string }[];
  tarefas: Map<string, any>; aoAbrir: (id: string, titulo: string) => void;
}) {
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const nome = (id: string) => agentes.find((a) => a.id === id)?.display_name || "Agente";
  const listas = COLUNAS.map((c) => ({
    c,
    lista: vinculos
      .filter((v) => c.estados.includes(v.status) && (!c.soComProva || v.last_evidence))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))),
  }));
  const recentes = runs.filter((r) => Date.parse(r.started_at) >= Date.now() - 7 * 86400000);
  const incidentes = recentes.filter((r) => ["failed", "timeout"].includes(r.status));
  const total = listas.reduce((t, l) => t + l.lista.length, 0);

  return (
    <div className="space-y-5">
      {/* O fluxo numa barra: de onde para onde o trabalho está andando. */}
      <div className={juntar(superficie.painel, "p-4")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {listas.map(({ c, lista }) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className={juntar("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60", c.cor)}><c.Icone className="h-5 w-5" aria-hidden="true" /></span>
              <span><span className="block text-[24px] font-semibold tabular-nums leading-7">{lista.length}</span><span className="block text-[12px] text-muted-foreground">{c.nome}</span></span>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {listas.map(({ c, lista }) => lista.length > 0 && <span key={c.id} className={c.fundo} style={{ width: `${(lista.length / total) * 100}%` }} />)}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {listas.map(({ c, lista }) => {
          const tudo = abertas[c.id];
          const visiveis = tudo ? lista : lista.slice(0, POR_COLUNA);
          return (
            <section key={c.id} aria-label={c.nome} className="flex min-w-0 flex-col rounded-lg bg-muted/30 p-2.5">
              <h3 className={juntar("mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold", c.cor)}><c.Icone className="h-4 w-4" aria-hidden="true" />{c.nome}<span className="ml-auto font-normal tabular-nums text-muted-foreground">{lista.length}</span></h3>
              {lista.length === 0 ? <p className="px-1 py-6 text-center text-[12px] text-muted-foreground">Nada aqui.</p> : (
                <ul className="space-y-2">
                  {visiveis.map((v) => {
                    const t = tarefas.get(v.kanban_task_id || v.painel_task_id);
                    const titulo = t?.title ? nomeDaTarefaDoBanco(t).semCliente : limparTecnico(String(v.last_action || "")) || "Atividade do agente";
                    const cliente = t?.project?.client ? (t.project.client.company_name || t.project.client.full_name) : null;
                    const tipo = tipoDaEntrega(t?.delivery_type, titulo);
                    const prova = v.last_evidence && destinoDaEvidencia(String(v.last_evidence)) ? String(v.last_evidence) : null;
                    return (
                      <li key={v.id} className={juntar(superficie.painel, "overflow-hidden")}>
                        {prova && c.id !== "fila" && <EvidenciaVisual url={prova} nome={titulo} compacto />}
                        <button type="button" className="block w-full p-3 text-left hover:bg-muted/40" onClick={() => aoAbrir(v.id, titulo)}>
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {tipo && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{tipo}</span>}
                            <span className="min-w-0 truncate">{cliente || "Operação interna"}</span>
                          </span>
                          <span className="mt-1.5 line-clamp-2 block text-[13px] font-medium leading-snug">{titulo}</span>
                          <span className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground" aria-hidden="true">{nome(v.operator_id).trim()[0]?.toUpperCase()}</span>
                            <span className="line-clamp-2">{fraseDoAgente({ status: v.status, titulo, cliente, tipo, motivo: v.block_reason ? limparTecnico(v.block_reason) : null })}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {lista.length > POR_COLUNA && <button type="button" className={juntar(botao.discreto, "mt-2 h-8 text-[12px]")} onClick={() => setAbertas((a) => ({ ...a, [c.id]: !tudo }))}>{tudo ? "Mostrar menos" : `Ver mais ${lista.length - POR_COLUNA}`}</button>}
            </section>
          );
        })}
      </div>

      <section className={juntar(superficie.painel, "p-4")}>
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold"><AlertTriangle className={juntar("h-4 w-4", incidentes.length ? "text-warning" : "text-success")} aria-hidden="true" />Últimos 7 dias</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{recentes.length} execuções registradas · {incidentes.length ? `${incidentes.length} pararam no meio ou falharam` : "nenhuma falhou"}</p>
        {incidentes.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {incidentes.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[13px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                <span><strong className="font-medium">{nome(r.operator_id)}</strong>: {limparTecnico(falhaDaExecucao(r.error) || estadoDaExecucao(r.status))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
