import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SERVICES } from "@/components/admin/CreateClientModal";
import { CampoDeFormulario, EstadoDeErro, GrupoDeCampos, Secao, SeletorCompacto, botao, campo, juntar, texto } from "@/components/sistema";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import { diaEmSaoPaulo, estadoDoGanho, fechamentoDoEstado, ganhoRecusado, mesDoGanho, proximoMes, type FechamentoDoGanho, type Lead } from "@/lib/comercial";
import { cadastrarNoGanho, reenviarConviteDoGanho, type ResultadoDoCadastroNoGanho, type TipoDoCliente } from "@/lib/ganhoDoLead";
import CamposDoGanho from "./CamposDoGanho";

type Cadastro = "novo" | "existente";

/** Mesmo dia no mês seguinte; sem esse dia no mês (31 em novembro), o último dia dele. */
export function mesmoDiaNoProximoMes(dia: string): string {
  const mes = proximoMes(`${dia.slice(0, 7)}-01`);
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes.slice(0, 8)}${String(Math.min(Number(dia.slice(8, 10)), ultimo)).padStart(2, "0")}`;
}

export const tipoDoLead = (lead: Pick<Lead, "monthly_value" | "one_off_value">): TipoDoCliente | "" =>
  lead.monthly_value > 0 && lead.one_off_value > 0 ? "hybrid" : lead.monthly_value > 0 ? "recurring" : lead.one_off_value > 0 ? "one_off" : "";

const numero = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Fechar um lead (05/11/2026; dono: "primeiro coloca se é avulso ou não e todos os detalhes; aí sim marca como ganho").
 * Só existe ganho com cliente: o banco recusa qualquer outro caminho. A mesma janela no quadro e na ficha, e o resultado
 * é o do Novo cliente: "Cliente criado", convite por e-mail e o link para mandar no grupo.
 */
export default function JanelaDoGanho({ lead, clientes, onCancelar, onConcluido }: {
  lead: Lead;
  clientes: Array<{ id: string; nome: string }>;
  onCancelar: () => void;
  onConcluido: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const { data: planos } = useFinancePlans();
  const hoje = diaEmSaoPaulo(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
  const mes = mesDoGanho(lead, hoje);
  const [cadastro, setCadastro] = useState<Cadastro>(lead.won_client_id ? "existente" : "novo");
  const [clienteId, setClienteId] = useState(lead.won_client_id || "");
  const [nome, setNome] = useState(lead.name || "");
  const [empresa, setEmpresa] = useState(lead.company || "");
  const [email, setEmail] = useState(lead.email || "");
  const [whatsapp, setWhatsapp] = useState(lead.whatsapp || "");
  const [tipo, setTipo] = useState<TipoDoCliente | "">(tipoDoLead(lead));
  const [marca, setMarca] = useState("");
  const [planoNome, setPlanoNome] = useState("");
  const [valorMensal, setValorMensal] = useState(lead.monthly_value > 0 ? String(lead.monthly_value) : "");
  const [valorProjeto, setValorProjeto] = useState(lead.one_off_value > 0 ? String(lead.one_off_value) : "");
  const [servicos, setServicos] = useState<Record<string, boolean>>({});
  const [comoFoi, setComoFoi] = useState(() => estadoDoGanho(lead, mes));
  const [mensalidadePaga, setMensalidadePaga] = useState(false);
  const [vencimento, setVencimento] = useState(lead.mensalidade_inicio && lead.mensalidade_inicio > hoje ? mesmoDiaNoProximoMes(hoje) : hoje);
  const [proximaParcela, setProximaParcela] = useState(mesmoDiaNoProximoMes(hoje));
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDoCadastroNoGanho | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);

  const novo = cadastro === "novo";
  const comMensalidade = tipo === "recurring" || tipo === "hybrid";
  const comProjeto = tipo === "one_off" || tipo === "hybrid";
  const mensal = comMensalidade ? numero(valorMensal) : 0;
  const projeto = comProjeto ? numero(valorProjeto) : 0;
  const noProximoMes = comoFoi.inicio === "proximo";
  const venceEm = noProximoMes && vencimento < proximoMes(mes) ? mesmoDiaNoProximoMes(hoje) : vencimento;
  const planosAtivos = (planos || []).filter((p) => p.isActive);

  const confirmar = async () => {
    if (!tipo) return void toast.error("Escolha se o cliente é recorrente, avulso ou híbrido.");
    if (comMensalidade && mensal <= 0) return void toast.error("Informe o valor da mensalidade.");
    if (comProjeto && projeto <= 0) return void toast.error("Informe o valor do projeto.");
    const fechado = fechamentoDoEstado({ one_off_value: projeto, monthly_value: mensal }, comoFoi, mes);
    if (ganhoRecusado(fechado)) return void toast.error(fechado.erro);
    const fechamento = fechado as FechamentoDoGanho;
    if (!novo && !clienteId) return void toast.error("Escolha o cliente.");
    if (novo) {
      if (!nome.trim() || !empresa.trim()) return void toast.error("Preencha o nome e a empresa.");
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return void toast.error("O cliente precisa de um e-mail válido para receber o acesso.");
    }
    const pagaAgora = comMensalidade && !noProximoMes && mensalidadePaga;
    setSalvando(true);
    try {
      const r = await cadastrarNoGanho({
        lead,
        clienteExistente: novo ? null : clienteId,
        tipo,
        mensalidade: mensal,
        valorDoProjeto: projeto,
        nome,
        empresa,
        email,
        whatsapp,
        marca,
        planoNome,
        servicos: novo ? servicos : null,
        fechamento: { ...fechamento, mensalidade_inicio: comMensalidade ? `${(pagaAgora ? hoje : venceEm).slice(0, 7)}-01` : null },
        proximaParcela: comProjeto && comoFoi.entrada === "parcelada" ? proximaParcela : null,
        mensalidadeVencimento: comMensalidade && !pagaAgora ? venceEm : null,
        mensalidadePaga: pagaAgora,
      });
      await Promise.all(["clients", "billing", "comercial-leads"].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] })));
      setLink(r.linkDoConvite);
      setResultado(r);
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
      toast.success("Convite enviado por e-mail.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível enviar.");
    } finally {
      setReenviando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link || "");
      toast.success("Link copiado! Envie ao cliente pelo grupo.");
    } catch {
      toast.error("Selecione e copie o link manualmente.");
    }
  };

  // Cadastro que falhou no meio (conta criada, banco não gravou): repetir completa, e o convite ainda precisa sair.
  const faltaConvite = !!resultado && !resultado.conviteEnviado && (resultado.contaNova || !resultado.vinculado);

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto && !salvando) void (resultado ? onConcluido() : onCancelar()); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center text-[15px]">
            <Trophy className="mr-2 h-4 w-4 text-success" aria-hidden="true" />
            {resultado ? (resultado.vinculado ? "Ganho ligado ao cliente" : "Cliente criado") : `Fechou com ${lead.name}`}
          </DialogTitle>
        </DialogHeader>

        {resultado ? (
          <div className="min-w-0 space-y-4" data-ganho-pronto="">
            <div className="flex min-w-0 items-center">
              <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden="true">
                <Check className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className={juntar(texto.corpo, "truncate font-semibold")}>{empresa.trim() || nome.trim()}</p>
                <p className={juntar(texto.auxiliar, "truncate")}>{resultado.vinculado ? "Já tinha plano ou cobrança: nada novo entrou no Financeiro." : "Já está em Clientes e no Financeiro."}</p>
              </div>
            </div>
            {faltaConvite ? (
              <EstadoDeErro
                titulo="O e-mail de convite não foi enviado."
                descricao="O cliente foi criado. Reenvie o convite ou copie o link e mande direto."
                acao={
                  <div className="flex flex-col items-end [&>*+*]:mt-2">
                    <button type="button" onClick={() => void reenviar()} disabled={reenviando} className={botao.primario}>{reenviando ? "Enviando..." : "Enviar e-mail"}</button>
                    {link && <button type="button" onClick={() => void copiar()} className={botao.secundario}>Copiar link</button>}
                  </div>
                }
              />
            ) : link ? (
              <Secao
                titulo="Convite de primeiro acesso"
                descricao={`Enviado por e-mail para ${email.trim()}`}
                ajuda="O cliente clica, cria a própria senha e já entra no portal. Mande o link também no grupo."
                acao={<button type="button" onClick={() => void copiar()} className={botao.secundario}>Copiar link</button>}
              />
            ) : null}
            {link && <p className={juntar(texto.auxiliar, "break-all")} data-link-do-convite="">{link}</p>}
            <div className="flex justify-end">
              <button type="button" onClick={() => void onConcluido()} className={faltaConvite ? botao.secundario : botao.primario}>Fechar</button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            <GrupoDeCampos colunas={2}>
              <CampoDeFormulario rotulo="Tipo de cliente" obrigatorio largo apoio={tipo === "recurring" ? "Mensalidade" : tipo === "one_off" ? "Projeto único" : tipo === "hybrid" ? "Projeto e mensalidade" : "Escolha para continuar"}>
                <SeletorCompacto
                  opcoes={[{ valor: "recurring", rotulo: "Recorrente" }, { valor: "one_off", rotulo: "Avulso" }, { valor: "hybrid", rotulo: "Híbrido" }]}
                  valor={tipo}
                  onEscolher={(v) => setTipo(v as TipoDoCliente)}
                  rotulo="Tipo de cliente"
                />
              </CampoDeFormulario>
              {comProjeto && (
                <CampoDeFormulario rotulo="Valor total do projeto (R$)" obrigatorio largo={!comMensalidade}>
                  <input inputMode="decimal" value={valorProjeto} onChange={(e) => { setValorProjeto(e.target.value); setComoFoi((c) => ({ ...c, recebido: String(Math.round((numero(e.target.value) / (Number(c.parcelas) || 1)) * 100) / 100) })); }} className={juntar(campo, "tabular-nums")} />
                </CampoDeFormulario>
              )}
              {comMensalidade && (
                <CampoDeFormulario rotulo="Mensalidade (R$)" obrigatorio largo={!comProjeto}>
                  <input inputMode="decimal" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} className={juntar(campo, "tabular-nums")} />
                </CampoDeFormulario>
              )}
              {comMensalidade && novo && planosAtivos.length > 0 && (
                <CampoDeFormulario rotulo="Plano" largo apoio="Escolher um plano preenche o valor, que segue editável.">
                  <select
                    value={planosAtivos.find((p) => p.name === planoNome)?.id || ""}
                    onChange={(e) => {
                      const plano = planosAtivos.find((p) => p.id === e.target.value);
                      setPlanoNome(plano ? plano.name : "");
                      const versao = plano ? plano.currentVersion || plano.versions[0] : null;
                      if (versao) setValorMensal(String(versao.finalAmount || versao.amount));
                    }}
                    className={campo}
                  >
                    <option value="">Mensalidade (sem plano do catálogo)</option>
                    {planosAtivos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </CampoDeFormulario>
              )}
            </GrupoDeCampos>

            <CamposDoGanho entrada={projeto} mensalidade={mensal} mes={mes} estado={comoFoi} onMudar={setComoFoi} />

            {comProjeto && projeto > 0 && comoFoi.entrada === "parcelada" && (
              <CampoDeFormulario rotulo="Próxima parcela em" obrigatorio apoio="As outras vencem de mês em mês a partir desta data.">
                <input type="date" value={proximaParcela} onChange={(e) => setProximaParcela(e.target.value)} className={campo} />
              </CampoDeFormulario>
            )}
            {comMensalidade && mensal > 0 && (
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
                  <CampoDeFormulario rotulo="Mensalidade vence em" obrigatorio>
                    <input type="date" value={venceEm} onChange={(e) => setVencimento(e.target.value)} className={campo} />
                  </CampoDeFormulario>
                )}
              </GrupoDeCampos>
            )}

            <div className="border-t border-border pt-4">
              <CampoDeFormulario rotulo="Cadastro do cliente" apoio={novo ? "Cria a conta, lança no Financeiro e envia o convite por e-mail." : "Liga ao cliente. Se ele ainda não tem cobrança, lança estes valores no Financeiro."}>
                <SeletorCompacto
                  opcoes={[{ valor: "novo", rotulo: "Novo cliente" }, { valor: "existente", rotulo: "Já é cliente" }]}
                  valor={cadastro}
                  onEscolher={(v) => setCadastro(v as Cadastro)}
                  rotulo="Cadastro do cliente"
                />
              </CampoDeFormulario>
            </div>

            {novo ? (
              <>
                <GrupoDeCampos colunas={2}>
                  <CampoDeFormulario rotulo="Nome completo" obrigatorio><input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></CampoDeFormulario>
                  <CampoDeFormulario rotulo="Empresa" obrigatorio><input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={campo} /></CampoDeFormulario>
                  <CampoDeFormulario rotulo="E-mail" obrigatorio><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} /></CampoDeFormulario>
                  <CampoDeFormulario rotulo="WhatsApp"><input inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={campo} /></CampoDeFormulario>
                  <CampoDeFormulario rotulo="Marca" largo>
                    <SeletorCompacto
                      opcoes={[{ valor: "", rotulo: "Depois" }, { valor: "aceleriq", rotulo: "AcelerIQ" }, { valor: "sitebolt", rotulo: "SiteBolt" }]}
                      valor={marca}
                      onEscolher={setMarca}
                      rotulo="Marca"
                    />
                  </CampoDeFormulario>
                </GrupoDeCampos>
                <details className="min-w-0">
                  <summary className={juntar(texto.corpo, "cursor-pointer font-medium")}>Serviços ativos ({SERVICES.filter((s) => !!servicos[s.key]).length} de {SERVICES.length})</summary>
                  <ul className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    {SERVICES.map((s) => (
                      <li key={s.key} className="flex min-w-0 items-center justify-between border-b border-border py-2">
                        <span className={juntar(texto.corpo, "min-w-0 truncate")} id={`ganho-servico-${s.key}`}>{s.label}</span>
                        <Switch aria-labelledby={`ganho-servico-${s.key}`} checked={!!servicos[s.key]} onCheckedChange={() => setServicos((p) => ({ ...p, [s.key]: !p[s.key] }))} />
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <CampoDeFormulario rotulo="Cliente no painel" obrigatorio>
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo}>
                  <option value="">Escolha</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </CampoDeFormulario>
            )}

            <div className="flex items-center justify-end [&>*+*]:ml-2">
              <button type="button" onClick={onCancelar} disabled={salvando} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={() => void confirmar()} disabled={salvando} className={juntar(botao.primario, "bg-success hover:bg-success/90")}>
                {salvando ? "Salvando..." : novo ? "Criar cliente e marcar ganho" : "Marcar ganho"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
