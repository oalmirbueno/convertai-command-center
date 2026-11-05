import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, botao, campo, juntar, texto } from "@/components/sistema";
import { diaEmSaoPaulo, estadoDoGanho, fechamentoDoEstado, ganhoRecusado, mesDoGanho, moverLead, proximoMes, ultimoErroDoComercial, type FechamentoDoGanho, type Lead } from "@/lib/comercial";
import { cadastrarNoGanho, reenviarConviteDoGanho, type ResultadoDoCadastroNoGanho } from "@/lib/ganhoDoLead";
import CamposDoGanho from "./CamposDoGanho";

type Cadastro = "novo" | "existente" | "depois";

/** Mesmo dia no mês seguinte; sem esse dia no mês (31 em novembro), o último dia dele. */
export function mesmoDiaNoProximoMes(dia: string): string {
  const mes = proximoMes(`${dia.slice(0, 7)}-01`);
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes.slice(0, 8)}${String(Math.min(Number(dia.slice(8, 10)), ultimo)).padStart(2, "0")}`;
}

/**
 * Fechar um lead (05/11/2026): o ganho pede o que o cadastro precisa e já deixa tudo pronto, do quadro ou da ficha.
 * "Novo cadastro" cria a conta, lança no Financeiro e envia o convite; "Já é cliente" e "Depois" não lançam nada.
 */
export default function JanelaDoGanho({ lead, clientes, onCancelar, onConcluido }: {
  lead: Lead;
  clientes: Array<{ id: string; nome: string }>;
  onCancelar: () => void;
  onConcluido: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const hoje = diaEmSaoPaulo(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
  const mes = mesDoGanho(lead, hoje);
  const [cadastro, setCadastro] = useState<Cadastro>(lead.won_client_id ? "existente" : "novo");
  const [clienteId, setClienteId] = useState(lead.won_client_id || "");
  const [nome, setNome] = useState(lead.name || "");
  const [empresa, setEmpresa] = useState(lead.company || "");
  const [email, setEmail] = useState(lead.email || "");
  const [whatsapp, setWhatsapp] = useState(lead.whatsapp || "");
  const [comoFoi, setComoFoi] = useState(() => estadoDoGanho(lead, mes));
  const [mensalidadePaga, setMensalidadePaga] = useState(false);
  const [vencimento, setVencimento] = useState(hoje);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDoCadastroNoGanho | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);

  const novo = cadastro === "novo";
  const temMensalidade = lead.monthly_value > 0;
  const noProximoMes = comoFoi.inicio === "proximo";
  const venceEm = noProximoMes && vencimento < proximoMes(mes) ? mesmoDiaNoProximoMes(hoje) : vencimento;

  const invalidar = () => Promise.all(["clients", "billing", "comercial-leads"].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] })));

  const confirmar = async () => {
    const fechado = fechamentoDoEstado(lead, comoFoi, mes);
    if (ganhoRecusado(fechado)) return void toast.error(fechado.erro);
    const fechamento = fechado as FechamentoDoGanho;
    if (cadastro === "existente" && !clienteId) return void toast.error("Escolha o cliente.");
    if (novo) {
      if (!nome.trim() || !empresa.trim()) return void toast.error("Preencha o nome e a empresa.");
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return void toast.error("O cliente precisa de um e-mail válido para receber o acesso.");
    }
    setSalvando(true);
    try {
      if (novo) {
        const pagaAgora = temMensalidade && !noProximoMes && mensalidadePaga;
        const r = await cadastrarNoGanho({
          lead, nome, empresa, email, whatsapp,
          fechamento: { ...fechamento, mensalidade_inicio: temMensalidade ? `${(pagaAgora ? hoje : venceEm).slice(0, 7)}-01` : null },
          mensalidadeVencimento: temMensalidade && !pagaAgora ? venceEm : null,
          mensalidadePaga: pagaAgora,
        });
        await invalidar();
        setLink(r.linkDoConvite);
        setResultado(r);
        return;
      }
      const ok = await moverLead({ lead, paraEstagio: "ganho", clienteGanho: cadastro === "existente" ? clienteId : null, fechamento });
      if (!ok) throw new Error(ultimoErroDoComercial() || "Não foi possível marcar o ganho.");
      await invalidar();
      toast.success(`${lead.name}: ganho.`);
      await onConcluido();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível marcar o ganho.");
    } finally {
      setSalvando(false);
    }
  };

  const reenviar = async () => {
    if (!resultado) return;
    setReenviando(true);
    try {
      const novoLink = await reenviarConviteDoGanho(resultado.clientId, email, nome);
      if (novoLink) setLink(novoLink);
      setResultado({ ...resultado, conviteEnviado: true });
      toast.success("Convite reenviado por e-mail.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível reenviar.");
    } finally {
      setReenviando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link || "");
      toast.success("Link copiado.");
    } catch {
      toast.error("Selecione e copie o link manualmente.");
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !salvando) void (resultado ? onConcluido() : onCancelar()); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center text-[15px]">
            <Trophy className="mr-2 h-4 w-4 text-success" aria-hidden="true" />
            Fechou com {lead.name}
          </DialogTitle>
        </DialogHeader>

        {resultado ? (
          <div className="min-w-0 space-y-3" data-ganho-pronto="">
            <p className={juntar(texto.corpo, "flex items-center font-medium")}>
              <Check className="mr-2 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              {resultado.contaNova ? "Cliente cadastrado e lançado no Financeiro." : resultado.vinculado ? "Ligado ao cliente que já existia." : "Cadastro completado e lançado no Financeiro."}
            </p>
            {resultado.vinculado && <p className={texto.auxiliar}>Ele já tinha plano ou cobrança, então nada novo entrou no Financeiro.</p>}
            {resultado.contaNova && resultado.conviteEnviado && <p className={texto.auxiliar}>Convite de primeiro acesso enviado para {email.trim()}.</p>}
            {!resultado.contaNova && <p className={texto.auxiliar}>Este e-mail já tinha conta: nenhum convite novo foi enviado.</p>}
            {resultado.contaNova && !resultado.conviteEnviado && (
              <p className={juntar(texto.auxiliar, "text-destructive")}>O e-mail de convite não saiu. O cliente está criado: reenvie ou copie o link e mande direto.</p>
            )}
            <div className="flex flex-wrap items-center justify-end [&>*]:ml-2 [&>*]:mt-2">
              {resultado.contaNova && !resultado.conviteEnviado && (
                <button type="button" onClick={() => void reenviar()} disabled={reenviando} className={botao.secundario}>{reenviando ? "Reenviando..." : "Reenviar e-mail"}</button>
              )}
              {resultado.contaNova && link && <button type="button" onClick={() => void copiar()} className={botao.secundario}>Copiar link</button>}
              <button type="button" onClick={() => void onConcluido()} className={botao.primario}>Fechar</button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            <CampoDeFormulario rotulo="Cadastro do cliente" apoio={novo ? "Cria a conta, lança no Financeiro e envia o convite por e-mail." : "Só marca o ganho: nada entra no Financeiro."}>
              <SeletorCompacto
                opcoes={[{ valor: "novo", rotulo: "Novo cadastro" }, { valor: "existente", rotulo: "Já é cliente" }, { valor: "depois", rotulo: "Depois" }]}
                valor={cadastro}
                onEscolher={(v) => setCadastro(v as Cadastro)}
                rotulo="Cadastro do cliente"
              />
            </CampoDeFormulario>

            {novo && (
              <GrupoDeCampos colunas={2}>
                <CampoDeFormulario rotulo="Nome" obrigatorio><input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></CampoDeFormulario>
                <CampoDeFormulario rotulo="Empresa" obrigatorio><input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={campo} /></CampoDeFormulario>
                <CampoDeFormulario rotulo="E-mail" obrigatorio><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} /></CampoDeFormulario>
                <CampoDeFormulario rotulo="WhatsApp"><input inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={campo} /></CampoDeFormulario>
              </GrupoDeCampos>
            )}
            {cadastro === "existente" && (
              <CampoDeFormulario rotulo="Cliente no painel" obrigatorio>
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo}>
                  <option value="">Escolha</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </CampoDeFormulario>
            )}

            <CamposDoGanho entrada={lead.one_off_value} mensalidade={lead.monthly_value} mes={mes} estado={comoFoi} onMudar={setComoFoi} />

            {novo && temMensalidade && (
              <GrupoDeCampos colunas={2}>
                {!noProximoMes && (
                  <CampoDeFormulario rotulo="Primeira mensalidade" largo={mensalidadePaga}>
                    <SeletorCompacto
                      opcoes={[{ valor: "nao", rotulo: "Vai pagar" }, { valor: "sim", rotulo: "Já pagou" }]}
                      valor={mensalidadePaga ? "sim" : "nao"}
                      onEscolher={(v) => setMensalidadePaga(v === "sim")}
                      rotulo="Primeira mensalidade"
                    />
                  </CampoDeFormulario>
                )}
                {(noProximoMes || !mensalidadePaga) && (
                  <CampoDeFormulario rotulo="Vence em" obrigatorio>
                    <input type="date" value={venceEm} onChange={(e) => setVencimento(e.target.value)} className={campo} />
                  </CampoDeFormulario>
                )}
              </GrupoDeCampos>
            )}

            {lead.monthly_value === 0 && lead.one_off_value === 0 && (
              <p className={texto.auxiliar}>Sem valor definido: a meta de mensalidade nova não conta nada por ele.</p>
            )}

            <div className="flex items-center justify-end [&>*+*]:ml-2">
              <button type="button" onClick={onCancelar} disabled={salvando} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={() => void confirmar()} disabled={salvando} className={juntar(botao.primario, "bg-success hover:bg-success/90")}>
                {salvando ? "Salvando..." : novo ? "Confirmar e cadastrar" : "Confirmar ganho"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
