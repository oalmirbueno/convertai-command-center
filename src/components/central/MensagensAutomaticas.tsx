import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCheck, Loader2, PauseCircle, Pencil, Send, ShieldCheck, SkipForward, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  EstadoDeErro, EstadoVazio, Secao, botao, campo, campoTexto, espaco, etiqueta, juntar, superficie, texto,
} from "@/components/sistema";
import {
  MOTIVO_DE_PARAR, aprovarModelo, aprovarReguaDoCliente, brl, decidirMensagem, definirGrupoDoCliente, lerPainelDasMensagens,
  pausarModelo, resumoDaCobranca, revogarReguaDoCliente, salvarModelo, textoDoLembrete,
  type MensagemAutomatica, type ModeloDeMensagem, type PainelDasMensagens, type TipoDeModelo,
} from "@/lib/mensagensAutomaticas";
import { rpcAusente } from "@/lib/resumoDoDia";

/*
 * Cobranças e lembrete de aprovação (27/10/2026), dentro de Mensagens da
 * semana: o mesmo lugar onde o dono aprova o que vai para o grupo do cliente.
 * O painel prepara; o dono aprova; o Hermes envia e registra. Nada sai sem ele:
 * - Cobranças (D+1, D+5, D+10): aprovar com um toque, ou a régua inteira do
 *   cliente (as próximas etapas já saem aprovadas enquanto ele não pagar).
 * - Lembrete de aprovação: o dono aprova o modelo uma vez; sem modelo
 *   aprovado, nenhum lembrete sai. Pausar para tudo na hora.
 */

const CHAVE = ["mensagens-automaticas"] as const;

const NOME_DO_MODELO: Record<TipoDeModelo, string> = {
  lembrete_aprovacao: "Lembrete de aprovação",
  cobranca_d1: "Cobrança · D+1",
  cobranca_d5: "Cobrança · D+5",
  cobranca_d10: "Cobrança · D+10",
};

const quando = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

const erroEmFrase = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (/MENSAGEM_SEM_GRUPO/.test(msg)) return "Informe o nome exato do grupo do cliente no WhatsApp.";
  if (/MENSAGEM_MUDOU|MENSAGEM_JA_DECIDIDA/.test(msg)) return "A mensagem mudou enquanto você olhava. Atualizei a lista.";
  if (/MODELO_INCOMPLETO/.test(msg)) return msg.replace(/^.*MODELO_INCOMPLETO:\s*/, "");
  if (/CENTRAL_ADMIN_REQUIRED|42501/.test(msg)) return "Só o admin aprova mensagens ao cliente.";
  return msg || "Não foi possível agora.";
};

/** A prévia como o cliente vê no grupo. */
function Balao({ corpo }: { corpo: string }) {
  return (
    <div className="min-w-0 rounded-md bg-[#efeae2] px-3 py-3 dark:bg-[#0b141a]" data-balao="whatsapp">
      <p className="ml-auto min-w-0 max-w-[92%] whitespace-pre-wrap rounded-md rounded-tr-none bg-[#d9fdd3] px-2.5 py-2 text-[13px] leading-5 text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">{corpo || "Sem texto"}</p>
    </div>
  );
}

function usePainel(ativo: boolean) {
  return useQuery({
    queryKey: CHAVE,
    enabled: ativo,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ painel: PainelDasMensagens | null }> => {
      try {
        return { painel: await lerPainelDasMensagens() };
      } catch (e) {
        if (rpcAusente({ message: e instanceof Error ? e.message : String(e) })) return { painel: null };
        throw e;
      }
    },
  });
}

function CartaoDeCobranca({ m, aoMudar }: { m: MensagemAutomatica; aoMudar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [textoEditado, setTextoEditado] = useState(m.mensagem);
  const [grupo, setGrupo] = useState("");
  const [ocupado, setOcupado] = useState<"aprovar" | "regua" | "pular" | null>(null);
  const semGrupo = !m.grupo && !m.grupoConhecido;
  const { total, desde } = resumoDaCobranca(m);

  const agir = async (acao: "aprovar" | "regua" | "pular") => {
    if (acao !== "pular" && semGrupo && !grupo.trim()) { toast.error("Informe o nome exato do grupo do cliente no WhatsApp."); return; }
    setOcupado(acao);
    try {
      if (acao === "regua") {
        const r = await aprovarReguaDoCliente(m.clientId, grupo);
        toast.success(r.aprovadasAgora ? `Régua aprovada para ${m.cliente}. O Hermes envia esta agora e as próximas no dia certo, enquanto não pagar.` : `Régua aprovada para ${m.cliente}.`);
      } else {
        const r = await decidirMensagem(m, acao === "aprovar" ? "aprovado" : "rejeitado", { texto: editando ? textoEditado : undefined, grupo });
        if (r.parou) toast.info(`Não enviada: ${MOTIVO_DE_PARAR[r.parou] || r.parou}.`);
        else toast.success(acao === "aprovar" ? "Aprovada. O Hermes envia no grupo (dia útil, 9h às 18h) e registra." : "Pulada: esta não vai.");
      }
    } catch (e) {
      toast.error(`${m.cliente}: ${erroEmFrase(e)}`);
    } finally {
      setOcupado(null);
      await aoMudar();
    }
  };

  return (
    <li className={juntar(superficie.painel, "flex min-w-0 flex-col p-4")} data-cobranca={m.id}>
      <div className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">
          <p className={juntar(texto.corpo, "truncate font-medium")}>{m.cliente}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>{brl(total)} em aberto desde {desde}</p>
        </div>
        <span className={juntar(etiqueta, "ml-2 shrink-0 bg-warning/10 text-warning")}>D+{m.etapa}</span>
      </div>
      <p className={juntar(texto.auxiliar, "mt-2 truncate")} title={m.grupo || m.grupoConhecido || undefined}>{m.grupo || m.grupoConhecido ? `WhatsApp · ${m.grupo || m.grupoConhecido}` : "Grupo do cliente não conhecido"}</p>
      {semGrupo && (
        <input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Nome exato do grupo no WhatsApp" aria-label={`Grupo de ${m.cliente} no WhatsApp`} className={juntar(campo, "mt-2")} />
      )}
      <div className="mt-3 min-w-0">
        {editando
          ? <textarea value={textoEditado} onChange={(e) => setTextoEditado(e.target.value)} rows={7} className={campoTexto} aria-label={`Texto da cobrança de ${m.cliente}`} />
          : <Balao corpo={m.mensagem} />}
      </div>
      <div className="mt-auto flex min-w-0 items-center pt-3">
        <button type="button" onClick={() => void agir("aprovar")} disabled={!!ocupado} className={juntar(botao.primario, "mr-1 h-8")} aria-label={`Aprovar e enviar a cobrança de ${m.cliente}`}>
          {ocupado === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Aprovar e enviar
        </button>
        <button type="button" onClick={() => void agir("regua")} disabled={!!ocupado} className={juntar(botao.secundario, "h-8")} title="Aprova esta e já deixa aprovadas as próximas etapas (D+5, D+10) deste cliente, enquanto ele não pagar" aria-label={`Aprovar a régua inteira de ${m.cliente}`}>
          {ocupado === "regua" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Régua inteira"}
        </button>
        <button type="button" onClick={() => setEditando(!editando)} disabled={!!ocupado} className={juntar(botao.icone, "ml-auto")} title={editando ? "Ver a prévia" : "Editar o texto antes de aprovar"} aria-label={`Editar a cobrança de ${m.cliente}`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => void agir("pular")} disabled={!!ocupado} className={botao.icone} title="Pular: esta não vai" aria-label={`Pular a cobrança de ${m.cliente}`}>
          {ocupado === "pular" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <SkipForward className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </li>
  );
}

/** Uma linha do histórico curto (na fila, enviada, parada). */
function Linha({ m }: { m: MensagemAutomatica }) {
  const situacao = m.enviadaEm ? `enviada ${quando(m.enviadaEm)}`
    : m.status === "aprovado" ? "aprovada, o Hermes envia"
      : m.status === "cancelado" ? `parou: ${MOTIVO_DE_PARAR[m.motivoDeParar || ""] || m.motivoDeParar || "cancelada"}`
        : m.status === "rejeitado" ? "pulada" : m.status === "expirado" ? "venceu sem envio" : "esperando você";
  const tom = m.enviadaEm ? "text-success" : m.status === "aprovado" ? "text-primary" : "text-muted-foreground";
  return (
    <li className="flex min-w-0 items-center py-1.5" data-historico={m.status}>
      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{m.cliente}{m.tipo === "cobranca" ? ` · D+${m.etapa}` : ` · ${m.itensDoLembrete.length} ${m.itensDoLembrete.length === 1 ? "peça" : "peças"}`}</span>
      <span className={juntar(texto.auxiliar, "ml-3 shrink-0", tom)}>{situacao}</span>
    </li>
  );
}

function ModeloDoLembrete({ modelo, painel, aoMudar }: { modelo: ModeloDeMensagem; painel: PainelDasMensagens; aoMudar: () => Promise<void> }) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const atual = rascunho ?? modelo.texto;
  const aprovado = !!modelo.aprovadoTexto;
  const mudou = aprovado && atual.trim() !== (modelo.aprovadoTexto || "").trim();
  const exemplo = painel.esperandoCliente[0];
  const previa = textoDoLembrete(atual, exemplo?.cliente || "Cliente", exemplo?.itens.length ? exemplo.itens : [{ fileId: "x", titulo: "Post de exemplo", dias: 3 }]);

  const fazer = async (acao: "aprovar" | "pausar") => {
    setOcupado(true);
    try {
      if (acao === "aprovar") {
        await aprovarModelo("lembrete_aprovacao", atual);
        toast.success("Modelo aprovado. Os lembretes saem pelo Hermes em dia útil, das 9h às 18h, 1 por cliente por dia.");
      } else {
        await pausarModelo("lembrete_aprovacao");
        toast.success("Lembretes pausados. O que estava na fila e não saiu foi cancelado.");
      }
      setRascunho(null);
    } catch (e) {
      toast.error(erroEmFrase(e));
    } finally {
      setOcupado(false);
      await aoMudar();
    }
  };

  return (
    <div className={juntar(superficie.painel, "min-w-0 p-4")} data-modelo-lembrete={aprovado ? "aprovado" : "sem-aprovacao"}>
      <div className="flex min-w-0 items-center">
        <ShieldCheck className={juntar("mr-2 h-4 w-4 shrink-0", aprovado ? "text-success" : "text-warning")} aria-hidden="true" />
        <p className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>
          {aprovado ? `Modelo aprovado${modelo.aprovadoEm ? ` em ${quando(modelo.aprovadoEm)}` : ""}` : "Modelo sem aprovação: nenhum lembrete sai"}
        </p>
      </div>
      <div className={juntar(espaco.grade, "mt-3 lg:grid-cols-2")}>
        <div className="min-w-0">
          <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor="modelo-lembrete">Texto-base ({"{pecas}"}, {"{lista}"} e {"{link}"} são preenchidos sozinhos)</label>
          <textarea id="modelo-lembrete" value={atual} onChange={(e) => setRascunho(e.target.value)} rows={7} className={campoTexto} disabled={ocupado} />
        </div>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1")}>Como o cliente vê{exemplo ? ` (${exemplo.cliente})` : ""}</p>
          <Balao corpo={previa} />
        </div>
      </div>
      <div className="mt-3 flex min-w-0 items-center">
        <button type="button" onClick={() => void fazer("aprovar")} disabled={ocupado || (aprovado && !mudou)} className={juntar(botao.primario, "h-8")}>
          {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {aprovado ? "Aprovar o texto novo" : "Aprovar o modelo"}
        </button>
        {aprovado && (
          <button type="button" onClick={() => void fazer("pausar")} disabled={ocupado} className={juntar(botao.discreto, "ml-1 h-8")}>
            <PauseCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />Pausar lembretes
          </button>
        )}
      </div>
    </div>
  );
}

function ClienteEsperandoLinha({ c, aoMudar }: { c: PainelDasMensagens["esperandoCliente"][number]; aoMudar: () => Promise<void> }) {
  const [grupo, setGrupo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const maisAntiga = c.itens.reduce((m, i) => Math.max(m, i.dias), 0);
  const salvar = async () => {
    if (!grupo.trim()) return;
    setOcupado(true);
    try {
      await definirGrupoDoCliente(c.clientId, grupo);
      toast.success(`Grupo de ${c.cliente} salvo.`);
    } catch (e) {
      toast.error(erroEmFrase(e));
    } finally {
      setOcupado(false);
      await aoMudar();
    }
  };
  return (
    <li className="flex min-w-0 flex-wrap items-center py-1.5" data-esperando={c.clientId}>
      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{c.cliente}</span>
      <span className={juntar(texto.auxiliar, "ml-3 shrink-0")}>{c.itens.length} {c.itens.length === 1 ? "peça" : "peças"} · a mais antiga há {maisAntiga} {maisAntiga === 1 ? "dia" : "dias"}</span>
      {c.grupo ? <span className={juntar(texto.auxiliar, "ml-3 max-w-[40%] shrink-0 truncate")} title={c.grupo}>{c.grupo}</span> : (
        <span className="ml-3 flex min-w-0 items-center">
          <input value={grupo} onChange={(e) => setGrupo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void salvar(); }} placeholder="Grupo no WhatsApp" aria-label={`Grupo de ${c.cliente} no WhatsApp`} className={juntar(campo, "h-8 w-48")} disabled={ocupado} />
          <button type="button" onClick={() => void salvar()} disabled={ocupado || !grupo.trim()} className={juntar(botao.icone, "ml-1")} title="Salvar o grupo" aria-label={`Salvar o grupo de ${c.cliente}`}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
          </button>
        </span>
      )}
    </li>
  );
}

function ModeloDeCobranca({ modelo, aoMudar }: { modelo: ModeloDeMensagem; aoMudar: () => Promise<void> }) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const atual = rascunho ?? modelo.texto;
  const salvar = async () => {
    setOcupado(true);
    try {
      await salvarModelo(modelo.tipo, atual);
      setRascunho(null);
      toast.success(`${NOME_DO_MODELO[modelo.tipo]}: texto salvo. Vale para as próximas cobranças.`);
    } catch (e) {
      toast.error(erroEmFrase(e));
    } finally {
      setOcupado(false);
      await aoMudar();
    }
  };
  return (
    <div className="min-w-0">
      <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor={`modelo-${modelo.tipo}`}>{NOME_DO_MODELO[modelo.tipo]}</label>
      <textarea id={`modelo-${modelo.tipo}`} value={atual} onChange={(e) => setRascunho(e.target.value)} rows={7} className={campoTexto} disabled={ocupado} />
      <button type="button" onClick={() => void salvar()} disabled={ocupado || rascunho === null || rascunho.trim() === modelo.texto.trim()} className={juntar(botao.secundario, "mt-2 h-8")}>
        {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}Salvar texto
      </button>
    </div>
  );
}

export default function MensagensAutomaticas() {
  const { profile } = useAuth();
  const eAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const consulta = usePainel(eAdmin);
  const painel = consulta.data?.painel ?? null;
  const atualizar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAVE }),
      queryClient.invalidateQueries({ queryKey: ["resumo-do-dia"] }),
      queryClient.invalidateQueries({ queryKey: ["mensagens-automaticas-decisoes"] }),
    ]);
  };

  const grupos = useMemo(() => {
    const ms = painel?.mensagens ?? [];
    const cobrancasPendentes = ms.filter((m) => m.tipo === "cobranca" && m.status === "pendente" && !m.enviadaEm);
    const historicoCobranca = ms.filter((m) => m.tipo === "cobranca" && !(m.status === "pendente" && !m.enviadaEm)).slice(0, 12);
    const historicoLembrete = ms.filter((m) => m.tipo === "lembrete_aprovacao").slice(0, 12);
    return { cobrancasPendentes, historicoCobranca, historicoLembrete };
  }, [painel]);

  // Vindo do Hoje ou do sino (/central/mensagens#cobrancas ou #lembretes): leva à seção quando ela aparece.
  const temPainel = !!painel;
  useEffect(() => {
    const alvo = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (temPainel && (alvo === "cobrancas" || alvo === "lembretes")) document.getElementById(alvo)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [temPainel]);

  if (!eAdmin) return null;
  if (consulta.isLoading) return null;
  if (consulta.error) {
    return <EstadoDeErro titulo="Não foi possível ler as cobranças e os lembretes." descricao={(consulta.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void atualizar()}>Tentar de novo</button>} />;
  }
  // Banco ainda sem a migration: a tela segue só com as mensagens da semana.
  if (!painel) return null;

  const modeloDoLembrete = painel.modelos.find((m) => m.tipo === "lembrete_aprovacao");
  const modelosDeCobranca = painel.modelos.filter((m) => m.tipo !== "lembrete_aprovacao");
  const nomeDoCliente = new Map(painel.mensagens.map((m) => [m.clientId, m.cliente] as const));
  const historico = (itens: MensagemAutomatica[], rotulo: string): ReactNode => itens.length > 0 && (
    <div className="mt-4 min-w-0">
      <p className={juntar(texto.rotulo, "mb-1")}>{rotulo}</p>
      <ul className="min-w-0 divide-y divide-border" aria-label={rotulo}>{itens.map((m) => <Linha key={m.id} m={m} />)}</ul>
    </div>
  );

  return (
    <div className="min-w-0" data-mensagens-automaticas="">
      <Secao
        id="cobrancas"
        titulo="Cobranças"
        descricao={grupos.cobrancasPendentes.length ? `${grupos.cobrancasPendentes.length} para aprovar` : "Nada para aprovar"}
        ajuda="D+1, D+5 e D+10 depois do vencimento, com valor, vencimento, Pix e o link do financeiro. Aprovar envia esta pelo Hermes; Régua inteira já aprova as próximas etapas deste cliente enquanto ele não pagar. Pagou, para sozinho."
        recolher="mensagens-semana:cobrancas"
      >
        {grupos.cobrancasPendentes.length === 0
          ? <EstadoVazio compacto titulo="Nenhuma cobrança esperando você." descricao="Quando uma cobrança chegar ao D+1, D+5 ou D+10, ela aparece aqui pronta." />
          : (
            <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4")} aria-label="Cobranças para aprovar">
              {grupos.cobrancasPendentes.map((m) => <CartaoDeCobranca key={`${m.id}:${m.hash}`} m={m} aoMudar={atualizar} />)}
            </ul>
          )}
        {painel.reguas.length > 0 && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center">
            <span className={juntar(texto.auxiliar, "mr-2")}>Régua aprovada:</span>
            {painel.reguas.map((id) => (
              <button key={id} type="button" className={juntar(botao.discreto, "h-8")} title="Revogar: as próximas etapas voltam a pedir você" onClick={() => { void revogarReguaDoCliente(id).then(() => { toast.success("Régua revogada."); return atualizar(); }).catch((e) => toast.error(erroEmFrase(e))); }}>
                {nomeDoCliente.get(id) || "Cliente"} · revogar
              </button>
            ))}
          </div>
        )}
        {historico(grupos.historicoCobranca, "Últimas cobranças")}
      </Secao>

      <Secao
        id="lembretes"
        titulo="Lembrete de aprovação"
        descricao={modeloDoLembrete?.aprovadoTexto ? "Ligado" : "Esperando o seu modelo"}
        ajuda="Quando uma peça fica mais de 48 h esperando o cliente, o painel prepara 1 mensagem curta por cliente por dia (dia útil, 9h às 18h) com as peças e o link de aprovação. Você aprova o modelo uma vez; o Hermes envia no grupo e registra. O cliente aprovou (ou a equipe marcou que aprovou por fora), o lembrete para."
        recolher="mensagens-semana:lembretes"
      >
        {modeloDoLembrete && <ModeloDoLembrete modelo={modeloDoLembrete} painel={painel} aoMudar={atualizar} />}
        {painel.esperandoCliente.length > 0 && (
          <div className="mt-4 min-w-0">
            <p className={juntar(texto.rotulo, "mb-1")}>Esperando o cliente há mais de 48 h</p>
            <ul className="min-w-0 divide-y divide-border" aria-label="Esperando o cliente">
              {painel.esperandoCliente.map((c) => <ClienteEsperandoLinha key={c.clientId} c={c} aoMudar={atualizar} />)}
            </ul>
          </div>
        )}
        {historico(grupos.historicoLembrete, "Últimos lembretes")}
      </Secao>

      <Secao titulo="Textos da cobrança" descricao="D+1, D+5 e D+10" recolher="mensagens-semana:modelos-cobranca" recolhidaDeInicio>
        <div className={juntar(espaco.grade, "lg:grid-cols-3")}>
          {modelosDeCobranca.map((m) => <ModeloDeCobranca key={m.tipo} modelo={m} aoMudar={atualizar} />)}
        </div>
        {!painel.temPix && <p className={juntar(texto.auxiliar, "mt-2 text-warning")}>Sem chave Pix nos dados da agência: a mensagem manda só o link do financeiro.</p>}
      </Secao>
    </div>
  );
}
