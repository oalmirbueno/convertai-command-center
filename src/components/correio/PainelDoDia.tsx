import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { fraseDoErro } from "@/lib/produto/api";
import {
  apagarCompromisso,
  apagarTarefa,
  criarCompromisso,
  criarTarefa,
  hojeEmBrasilia,
  horaDoCompromisso,
  listarCompromissos,
  listarTarefas,
  marcarTarefa,
  type EuNoCorreio,
} from "@/lib/produto/correio-dia";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, botao, campo, foco, juntar, texto } from "@/components/sistema";

export const chaveDasTarefas = ["produto", "correio", "tarefas"] as const;
export const chaveDaAgenda = (dia: string) => ["produto", "correio", "agenda", dia] as const;

const cartao = "min-w-0 rounded-lg bg-card p-5";

/** As tarefas da pessoa: marcar, criar e apagar. Tarefa vinda de e-mail mostra de onde veio. */
export function TarefasDoDia({ eu, compacto = false }: { eu: EuNoCorreio; compacto?: boolean }) {
  const qc = useQueryClient();
  const tarefas = useQuery({ queryKey: chaveDasTarefas, queryFn: listarTarefas });
  const [nova, setNova] = useState("");
  const reler = () => qc.invalidateQueries({ queryKey: chaveDasTarefas });
  const lista = tarefas.data || [];
  const visiveis = compacto ? lista.filter((t) => !t.feita_em).slice(0, 5) : lista;
  const feitas = lista.filter((t) => t.feita_em).length;
  const fazer = async (acao: () => Promise<void>) => {
    try {
      await acao();
      await reler();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar a tarefa."));
    }
  };
  return (
    <section className={cartao} aria-label="Tarefas" data-tarefas-do-correio="">
      <div className="mb-3 flex min-w-0 items-baseline">
        <h2 className={juntar(texto.corpo, "flex-1 font-semibold")}>{compacto ? "Tarefas do dia" : "Tarefas"}</h2>
        {lista.length > 0 && <span className={texto.auxiliar}>{feitas} de {lista.length} feitas</span>}
      </div>
      {!compacto && lista.length > 0 && (
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((feitas / lista.length) * 100)}%` }} />
        </div>
      )}
      {tarefas.isLoading ? (
        <p className={texto.auxiliar}>Abrindo.</p>
      ) : visiveis.length === 0 ? (
        <p className={texto.auxiliar}>{lista.length ? "Tudo feito por hoje." : "Nenhuma tarefa ainda. Um e-mail vira tarefa com um toque."}</p>
      ) : (
        <ul>
          {visiveis.map((t) => (
            <li key={t.id} className="flex min-w-0 items-start border-t border-border py-2.5 first:border-t-0 first:pt-0">
              <input type="checkbox" checked={!!t.feita_em} onChange={() => void fazer(() => marcarTarefa(t.id, !t.feita_em))} className="mr-3 mt-0.5 h-5 w-5 shrink-0 accent-primary" aria-label={t.titulo} />
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block", t.feita_em ? "text-muted-foreground line-through" : "font-medium")}>{t.titulo}</span>
                {t.origem && <span className={juntar(texto.auxiliar, "block truncate")}>{t.origem}</span>}
              </span>
              {!compacto && (
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void fazer(() => apagarTarefa(t.id))} aria-label={`Apagar a tarefa ${t.titulo}`} title="Apagar">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex h-11 min-w-0 items-center rounded-full bg-muted px-4"
        onSubmit={(e) => {
          e.preventDefault();
          const titulo = nova.trim();
          if (!titulo) return;
          setNova("");
          void fazer(() => criarTarefa(eu, { titulo, origem: "Criada por você" }));
        }}
      >
        <Plus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova tarefa" aria-label="Nova tarefa" maxLength={200} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" data-campo="nova-tarefa" />
      </form>
    </section>
  );
}

/** A agenda de hoje da pessoa. Compromisso pode nascer de um e-mail (o botão Marcar reunião abre a mesma janela). */
export function AgendaDeHoje({ eu, compacto = false }: { eu: EuNoCorreio; compacto?: boolean }) {
  const qc = useQueryClient();
  const dia = hojeEmBrasilia();
  const agenda = useQuery({ queryKey: chaveDaAgenda(dia), queryFn: () => listarCompromissos(dia) });
  const [criando, setCriando] = useState(false);
  const lista = agenda.data || [];
  return (
    <section className={cartao} aria-label="Agenda de hoje" data-agenda-do-correio="">
      <div className="mb-3 flex min-w-0 items-center">
        <h2 className={juntar(texto.corpo, "flex-1 font-semibold")}>{compacto ? "Hoje" : "Agenda de hoje"}</h2>
        <button type="button" className={botao.icone} onClick={() => setCriando(true)} aria-label="Novo compromisso" title="Novo compromisso">
          <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
        </button>
      </div>
      {agenda.isLoading ? (
        <p className={texto.auxiliar}>Abrindo.</p>
      ) : lista.length === 0 ? (
        <p className={texto.auxiliar}>Nada marcado para hoje.</p>
      ) : (
        <ul className="space-y-3">
          {lista.map((c) => (
            <li key={c.id} className="flex min-w-0 items-start">
              <span className="w-16 shrink-0 text-[20px] font-medium leading-7 tabular-nums">{horaDoCompromisso(c.inicio)}</span>
              <span className="min-w-0 flex-1 rounded-lg bg-muted px-3.5 py-2.5">
                <span className={juntar(texto.corpo, "block font-semibold")}>{c.titulo}</span>
                {c.detalhe && <span className={juntar(texto.auxiliar, "block")}>{c.detalhe}</span>}
              </span>
              {!compacto && (
                <button
                  type="button"
                  className={juntar(botao.icone, "ml-1")}
                  aria-label={`Apagar ${c.titulo}`}
                  title="Apagar"
                  onClick={() => void apagarCompromisso(c.id).then(() => qc.invalidateQueries({ queryKey: chaveDaAgenda(dia) })).catch((e) => toast.error(fraseDoErro(e)))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {criando && <NovoCompromisso eu={eu} onFechar={() => setCriando(false)} />}
    </section>
  );
}

/** A janela de marcar compromisso ou reunião. Vinda de um e-mail, já chega com o título e a origem. */
export function NovoCompromisso({ eu, onFechar, sugestao }: { eu: EuNoCorreio; onFechar: () => void; sugestao?: { titulo: string; detalhe?: string; caixa_id?: string; mensagem_ref?: string } }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ titulo: sugestao ? sugestao.titulo : "", detalhe: sugestao && sugestao.detalhe ? sugestao.detalhe : "", dia: hojeEmBrasilia(), hora: "15:00" });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      await criarCompromisso(eu, { ...f, caixa_id: sugestao ? sugestao.caixa_id : null, mensagem_ref: sugestao ? sugestao.mensagem_ref : null });
      await qc.invalidateQueries({ queryKey: ["produto", "correio", "agenda"] });
      toast.success("Marcado na sua agenda.");
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, e instanceof Error ? e.message : "Não foi possível marcar."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo={sugestao ? "Marcar reunião" : "Novo compromisso"}
      ajuda="Fica na sua agenda do correio. O convite para a outra pessoa você envia pela resposta do e-mail."
      rodape={<button type="button" className={juntar(botao.primario, foco)} onClick={() => void salvar()} disabled={salvando || !f.titulo.trim()} data-salvar-compromisso="">{salvando ? "Salvando..." : "Marcar"}</button>}
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="O que é">
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={campo} maxLength={200} data-campo="compromisso" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Com quem ou onde">
          <input value={f.detalhe} onChange={(e) => setF({ ...f, detalhe: e.target.value })} className={campo} maxLength={300} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Dia">
          <input type="date" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Hora">
          <input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} className={campo} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
