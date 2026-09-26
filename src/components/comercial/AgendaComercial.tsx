import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Clock, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CampoDeFormulario,
  EstadoVazio,
  GrupoDeCampos,
  Painel,
  RegiaoRolavel,
  botao,
  campo,
  foco,
  juntar,
  texto,
} from "@/components/sistema";
import {
  TIPOS_DE_ATIVIDADE,
  type Atividade,
  type Lead,
  apagarAtividade,
  concluirAtividade,
  rotuloDaAtividade,
  salvarAtividade,
} from "@/lib/comercial";
import { ehTexto, useEstadoDoComercial } from "./useEstadoDoComercial";

/**
 * A agenda do comercial, em calendario de mes.
 *
 * Antes era uma lista de "atrasadas, hoje, depois". Lista responde o que
 * fazer agora, mas nao responde a pergunta que se faz ao marcar uma reuniao:
 * "como esta minha semana?". Num calendario a resposta e o proprio desenho
 * da tela, e marcar vira tocar no dia.
 *
 * Aceita compromisso PROPRIO, sem lead: reuniao de planejamento, bloco para
 * escrever proposta, conversa com quem ainda nao virou lead. Sem isso a
 * agenda seria metade da verdade, e ninguem confiaria nela para saber se o
 * dia esta cheio.
 *
 * Rolagem: de 1024 px para cima o mês e o dia ficam lado a lado e cada um
 * rola sozinho; no celular um embaixo do outro, a página rola normal.
 */

interface Props {
  atividades: Atividade[];
  leads: Lead[];
  onAbrirLead: (lead: Lead) => void;
  onMudou: () => Promise<unknown>;
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const pad = (n: number) => String(n).padStart(2, "0");
const diaIso = (data: Date) =>
  `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Só a primeira letra maiúscula ("Sábado, 26 de setembro"); `capitalize` faria "De". */
const inicialMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ehDia = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * O dia local de um compromisso.
 *
 * A conta usa o relogio de quem esta olhando, e nao a data em UTC: uma
 * reuniao das 21h de Brasilia cai no dia seguinte em UTC, e apareceria na
 * casinha errada do calendario.
 */
const diaDoCompromisso = (atividade: Atividade) => diaIso(new Date(atividade.due_at));

export default function AgendaComercial({
  atividades,
  leads,
  onAbrirLead,
  onMudou,
}: Props) {
  const queryClient = useQueryClient();
  const hoje = new Date();
  const hojeIso = diaIso(hoje);
  // Mês e dia escolhidos ficam guardados enquanto é o mesmo dia: sair e voltar
  // mantém; amanhã a agenda abre em hoje de novo (a chave leva a data).
  const [diaEscolhido, setDiaEscolhido] = useEstadoDoComercial<string>(`agenda:dia:${hojeIso}`, hojeIso, { validar: ehDia, esperaMs: 0 });
  const [mesGuardado, setMesGuardado] = useEstadoDoComercial<string>(`agenda:mes:${hojeIso}`, hojeIso.slice(0, 8) + "01", { validar: ehDia, esperaMs: 0 });
  const mesAberto = useMemo(() => {
    const [ano, mes] = mesGuardado.split("-").map(Number);
    return new Date(ano, mes - 1, 1);
  }, [mesGuardado]);
  const setMesAberto = (data: Date) => setMesGuardado(diaIso(new Date(data.getFullYear(), data.getMonth(), 1)));
  const [novoEm, setNovoEm] = useState<string | null>(null);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Atividade[]>();
    for (const atividade of atividades) {
      const dia = diaDoCompromisso(atividade);
      const lista = mapa.get(dia) || [];
      lista.push(atividade);
      mapa.set(dia, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.due_at.localeCompare(b.due_at));
    }
    return mapa;
  }, [atividades]);

  const porLead = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  // A grade comeca no domingo da semana do dia 1 e vai ate fechar a ultima
  // semana: mes que comeca na quinta perderia os tres primeiros dias se a
  // grade comecasse no dia 1.
  const celulas = useMemo(() => {
    const primeiro = new Date(mesAberto.getFullYear(), mesAberto.getMonth(), 1);
    const inicio = new Date(primeiro);
    inicio.setDate(inicio.getDate() - inicio.getDay());
    const dias: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      dias.push(dia);
      if (
        i >= 27 &&
        dia.getDay() === 6 &&
        dia.getMonth() !== mesAberto.getMonth() &&
        dia > primeiro
      ) {
        break;
      }
    }
    return dias;
  }, [mesAberto]);

  const recarregar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["comercial-atividades"] });
    await onMudou();
  };

  const doDia = porDia.get(diaEscolhido) || [];
  const agoraIso = new Date().toISOString();
  const abertasAtrasadas = atividades.filter(
    (a) => !a.done_at && a.due_at < agoraIso,
  ).length;
  const tituloDoDia = inicialMaiuscula(
    new Date(`${diaEscolhido}T12:00:00`).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    }),
  );

  const navegacaoDoMes = (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setMesAberto(new Date(mesAberto.getFullYear(), mesAberto.getMonth() - 1, 1))}
        className={botao.icone}
        aria-label="Mês anterior"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => {
          setMesAberto(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
          setDiaEscolhido(hojeIso);
        }}
        className={juntar(botao.discreto, "h-8")}
      >
        Hoje
      </button>
      <button
        type="button"
        onClick={() => setMesAberto(new Date(mesAberto.getFullYear(), mesAberto.getMonth() + 1, 1))}
        className={botao.icone}
        aria-label="Próximo mês"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Agenda do comercial">
      <div className="grid min-w-0 gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:grid-rows-[minmax(0,1fr)] desk:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <RegiaoRolavel rotulo="Calendário do mês" memoria="comercial:agenda:mes" className="lg:pr-1">
          <Painel
            titulo={inicialMaiuscula(mesAberto.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }))}
            descricao={
              abertasAtrasadas > 0 ? (
                <span className="text-warning">
                  {abertasAtrasadas}{" "}
                  {abertasAtrasadas === 1 ? "compromisso passou da hora" : "compromissos passaram da hora"}
                </span>
              ) : undefined
            }
            acao={navegacaoDoMes}
          >
            <div className="grid grid-cols-7 gap-1">
              {DIAS_DA_SEMANA.map((dia) => (
                <p key={dia} className={juntar(texto.rotulo, "pb-1 text-center")}>
                  {dia}
                </p>
              ))}
              {celulas.map((data) => {
                const chave = diaIso(data);
                const doMes = data.getMonth() === mesAberto.getMonth();
                const lista = porDia.get(chave) || [];
                const abertas = lista.filter((a) => !a.done_at);
                const temAtraso = abertas.some((a) => a.due_at < agoraIso);
                const escolhido = chave === diaEscolhido;
                return (
                  <button
                    key={chave}
                    type="button"
                    onClick={() => setDiaEscolhido(chave)}
                    aria-pressed={escolhido}
                    aria-label={`${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}${abertas.length ? `, ${abertas.length} ${abertas.length === 1 ? "compromisso" : "compromissos"}` : ""}`}
                    className={juntar(
                      "flex min-h-[52px] min-w-0 flex-col items-start rounded-md p-1 text-left transition-colors lg:min-h-[64px]",
                      foco,
                      escolhido ? "bg-primary/10 ring-1 ring-inset ring-primary" : doMes ? "hover:bg-muted" : "opacity-50 hover:bg-muted",
                    )}
                  >
                    <span
                      className={juntar(
                        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                        chave === hojeIso ? "bg-primary text-primary-foreground" : doMes ? "text-foreground" : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {data.getDate()}
                    </span>
                    {abertas.length > 0 && (
                      <span
                        aria-hidden="true"
                        className={juntar(
                          "mt-0.5 w-full truncate rounded px-1 text-[10px] font-medium leading-4 tabular-nums",
                          temAtraso ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary",
                        )}
                      >
                        {abertas.length}
                        <span className="hidden sm:inline"> {abertas.length === 1 ? "compromisso" : "compromissos"}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Painel>
        </RegiaoRolavel>

        <RegiaoRolavel rotulo="Compromissos do dia" memoria="comercial:agenda:dia" className="lg:pr-1">
          <Painel
            semEspaco
            titulo={tituloDoDia}
            descricao={doDia.length > 0 ? `${doDia.length} ${doDia.length === 1 ? "compromisso" : "compromissos"}` : undefined}
            acao={
              <button type="button" onClick={() => setNovoEm(diaEscolhido)} className={botao.primario} aria-label={`Marcar compromisso em ${tituloDoDia}`}>
                <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Marcar</span>
              </button>
            }
          >
            {doDia.length === 0 ? (
              <div className="p-3">
                <EstadoVazio compacto titulo="Nenhum compromisso neste dia." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {doDia.map((atividade) => {
                  const lead = atividade.lead_id ? porLead.get(atividade.lead_id) : null;
                  const feita = Boolean(atividade.done_at);
                  const atrasada = !feita && atividade.due_at < agoraIso;
                  return (
                    <li key={atividade.id} className={juntar("flex min-w-0 items-center px-4 py-2.5", feita && "opacity-60")}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await concluirAtividade(atividade, !feita)) await recarregar();
                          else toast.error("Não foi possível salvar.");
                        }}
                        title={feita ? "Reabrir" : "Concluir"}
                        aria-label={feita ? `Reabrir ${atividade.title}` : `Concluir ${atividade.title}`}
                        aria-pressed={feita}
                        className={juntar(
                          "mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                          foco,
                          feita ? "border-border text-muted-foreground" : "border-primary/50 text-primary hover:bg-primary/10",
                        )}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <div className="mr-2 min-w-0 flex-1">
                        <p className={juntar(texto.corpo, "truncate", feita ? "text-muted-foreground line-through" : "font-medium")}>
                          {atividade.title}
                        </p>
                        <p className={juntar(texto.auxiliar, "flex min-w-0 items-center", atrasada && "font-medium text-warning")}>
                          <Clock className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="shrink-0 tabular-nums">{horaDe(atividade.due_at)}</span>
                          <span className="shrink-0">&nbsp;· {rotuloDaAtividade(atividade.kind)}&nbsp;·&nbsp;</span>
                          {lead ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => onAbrirLead(lead)}
                              onKeyDown={(e) => e.key === "Enter" && onAbrirLead(lead)}
                              className="min-w-0 cursor-pointer truncate font-medium text-primary hover:underline"
                            >
                              {lead.name}
                            </span>
                          ) : (
                            <span className="inline-flex shrink-0 items-center">
                              <User className="mr-0.5 h-3 w-3" aria-hidden="true" />
                              seu
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await apagarAtividade(atividade.id)) {
                            await recarregar();
                            toast.success("Compromisso removido.");
                          } else toast.error("Não foi possível remover.");
                        }}
                        title="Remover"
                        aria-label={`Remover ${atividade.title}`}
                        className={juntar(botao.icone, "hover:text-destructive")}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Painel>
        </RegiaoRolavel>
      </div>

      {novoEm && (
        <NovoCompromisso
          dia={novoEm}
          leads={leads}
          onFechar={() => setNovoEm(null)}
          onSalvo={async () => {
            setNovoEm(null);
            await recarregar();
          }}
        />
      )}
    </AreaDeTrabalho>
  );
}

function NovoCompromisso({
  dia,
  leads,
  onFechar,
  onSalvo,
}: {
  dia: string;
  leads: Lead[];
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [tipo, setTipo] = useState("reuniao");
  // O título escrito e não salvo volta ao reabrir (rascunho por dia).
  const [titulo, setTitulo, esquecerTitulo] = useEstadoDoComercial(`rascunho:compromisso:${dia}`, "", { validar: ehTexto });
  const [hora, setHora] = useState("09:00");
  const [leadId, setLeadId] = useState("proprio");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (titulo.trim().length < 2) {
      toast.error("Diga o que vai acontecer.");
      return;
    }
    setSalvando(true);
    const ok = await salvarAtividade({
      leadId: leadId === "proprio" ? null : leadId,
      kind: tipo,
      title: titulo,
      dueAt: `${dia}T${hora}`,
    });
    setSalvando(false);
    if (!ok) {
      toast.error("Não foi possível marcar.");
      return;
    }
    esquecerTitulo();
    toast.success("Marcado.");
    await onSalvo();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {inicialMaiuscula(
              new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              }),
            )}
          </DialogTitle>
        </DialogHeader>
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
              {TIPOS_DE_ATIVIDADE.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Hora">
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="O que vai acontecer" obrigatorio largo>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} autoFocus />
          </CampoDeFormulario>
          {/* Com quem, ou com ninguem: a reuniao de planejamento e tao
              compromisso quanto a ligacao para o lead, e precisa caber aqui. */}
          <CampoDeFormulario rotulo="Com quem" largo>
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className={campo}>
              <option value="proprio">Compromisso seu (sem lead)</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                  {lead.company ? ` (${lead.company})` : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        </GrupoDeCampos>
        <div className="flex items-center justify-end [&>*+*]:ml-2">
          <button type="button" onClick={onFechar} className={botao.secundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>
            Marcar na agenda
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
