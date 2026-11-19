import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CircleDollarSign, CreditCard, Handshake, Link2, RefreshCw, UserPlus, Users } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import { ESTAGIOS_ABERTOS, rotuloDoEstagio } from "@/lib/comercial/estagios";
import {
  casa,
  copiarLinkDeAcesso,
  diaLegivel,
  fraseDoErro,
  lerConfig,
  lerMonitorDaConta,
  listarCobrancas,
  mensalidadePrevista,
  reais,
  reenviarConvite,
  ROTULO_DO_ESTADO,
  type CobrancaDoProduto,
  type ContaNaCasa,
  type EmpresaNoMonitor,
  type EstadoDaConta,
  type PlanoDoProduto,
} from "@/lib/produto/api";
import { Avatar, Chip, EmptyState, OverflowMenu, PillTabs, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  GradeDeSecoes,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  botao,
  campo,
  campoTexto,
  juntar,
  lista,
  superficie,
  texto,
} from "@/components/sistema";
import { Barra, Foto, corDaEtapa } from "../pecas";
import { CORES_DAS_ETAPAS, comMaiuscula, pelaPlano, reaisCurto, situacaoDaConta, tomDaConta } from "./estadoDaConta";

/**
 * A janela de uma empresa do produto CRM (19/11/2026, dono: "a visão que a gente vê por cliente é
 * totalmente diferente da que aparece para o cliente; muito antigão"). Abre na Visão, com a mesma
 * linguagem do painel do cliente (números com ícone, funil na cor de cada etapa, pessoas com foto)
 * e, nas outras abas, a gestão da casa: o que foi contratado, a equipe e o convite, a cobrança e os
 * dados da empresa. O nome e o contato dos leads continuam fora: são da empresa.
 */

export type AbaDaEmpresa = "visao" | "plano" | "equipe" | "cobranca" | "dados";

const RELER_A_CADA = 15_000;
const ESTADOS_QUE_A_CASA_DEFINE: EstadoDaConta[] = ["teste", "ativa", "cortesia", "suspensa", "cancelada"];
const PAPEL: Record<string, string> = { admin: "Administra", gerente: "Gerente", usuario: "Vendedor" };
const TOM_DA_COBRANCA: Record<CobrancaDoProduto["estado"], Tone> = { aberta: "info", paga: "success", atrasada: "warning", estornada: "neutral", cancelada: "neutral" };
const ROTULO_DA_COBRANCA: Record<CobrancaDoProduto["estado"], string> = { aberta: "Aberta", paga: "Paga", atrasada: "Atrasada", estornada: "Estornada", cancelada: "Cancelada" };
const ROTULO_DA_ASSINATURA: Record<string, string> = { ativa: "Assinatura ativa", aguardando: "Esperando o primeiro pagamento", atrasada: "Assinatura atrasada", cancelada: "Assinatura cancelada", sem: "Sem assinatura" };

const etapa = (id: string | null) => (id ? rotuloDoEstagio(id) : "");

/** "agora", "há 4 min", "há 3 h", "há 2 dias" ou "nunca". */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "nunca";
  const min = Math.floor((agora - t) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export default function JanelaDaEmpresa({
  conta,
  planos,
  abaInicial = "visao",
  aoVivo,
  onFechar,
  onMudou,
}: {
  conta: ContaNaCasa;
  planos: PlanoDoProduto[];
  abaInicial?: AbaDaEmpresa;
  /** A linha do monitor, quando a janela abre da Visão geral (traz os números de hoje). */
  aoVivo?: EmpresaNoMonitor | null;
  onFechar: () => void;
  onMudou: () => Promise<unknown>;
}) {
  const [aba, setAba] = useState<AbaDaEmpresa>(abaInicial);
  const { data: clientesBrutos } = useClients();
  const config = useQuery({ queryKey: ["produto", "config"], queryFn: lerConfig, staleTime: 300_000 });
  const cobrancas = useQuery({ queryKey: ["produto", "cobrancas", conta.id], queryFn: () => listarCobrancas(conta.id, 6) });
  const original = useMemo(
    () => ({
      nome: conta.nome,
      documento: conta.documento || "",
      email_cobranca: conta.email_cobranca || "",
      telefone: conta.telefone || "",
      client_id: conta.client_id || "",
      plano_id: conta.plano_id,
      usuarios_contratados: conta.usuarios_contratados,
      crm_ativo: conta.crm_ativo,
      email_ativo: conta.email_ativo,
      email_caixas_contratadas: conta.email_caixas_contratadas,
      estado: conta.estado,
      teste_ate: conta.teste_ate ? conta.teste_ate.slice(0, 10) : "",
      observacao: conta.observacao || "",
    }),
    [conta],
  );
  const [f, setF] = useState(original);
  const [salvando, setSalvando] = useState(false);
  const [convite, setConvite] = useState({ email: "", nome: "", admin: false });
  const [convidando, setConvidando] = useState(false);
  const [cobrando, setCobrando] = useState(false);

  const clientes = useMemo(
    () => ((clientesBrutos || []) as Array<Record<string, unknown>>).map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clientesBrutos],
  );
  const plano = planos.filter((p) => p.id === f.plano_id)[0] || null;
  const previsto = plano ? mensalidadePrevista({ plano, usuarios: f.usuarios_contratados, crm: f.crm_ativo, email: f.email_ativo, caixas: f.email_caixas_contratadas, config: config.data || null }) : null;
  const mexeNoValor = f.plano_id !== conta.plano_id || f.usuarios_contratados !== conta.usuarios_contratados || f.crm_ativo !== conta.crm_ativo || f.email_ativo !== conta.email_ativo || f.email_caixas_contratadas !== conta.email_caixas_contratadas;
  const temAssinatura = !!conta.assinatura && !!conta.assinatura.asaas_assinatura_id;
  const mudou = (Object.keys(original) as Array<keyof typeof original>).some((k) => original[k] !== f[k]);
  const doPlano = pelaPlano(conta);

  const salvar = async () => {
    if (f.nome.trim().length < 2) return void toast.error("Diga o nome da empresa.");
    if (f.usuarios_contratados < conta.usuarios_ativos + conta.convites) return void toast.error("Há mais pessoas na equipe do que usuários contratados.");
    setSalvando(true);
    try {
      await casa.salvarConta(conta.id, {
        nome: f.nome.trim(),
        documento: f.documento.replace(/\D/g, "") || null,
        email_cobranca: f.email_cobranca.trim().toLowerCase() || null,
        telefone: f.telefone.trim() || null,
        client_id: f.client_id || null,
        plano_id: f.plano_id,
        usuarios_contratados: f.usuarios_contratados,
        crm_ativo: f.crm_ativo,
        email_ativo: f.email_ativo,
        email_caixas_contratadas: f.email_caixas_contratadas,
        estado: f.estado,
        teste_ate: f.estado === "teste" && f.teste_ate ? `${f.teste_ate}T23:59:59-03:00` : conta.teste_ate,
        ...(f.estado !== conta.estado && f.estado !== "atrasada" ? { atrasada_desde: null } : {}),
        ...(f.estado !== conta.estado && f.estado !== "cancelada" ? { acesso_ate: null } : {}),
        observacao: f.observacao.trim() || null,
      });
      // O valor novo precisa chegar ao Asaas, senão a empresa continua pagando o antigo.
      if (mexeNoValor && temAssinatura) {
        await casa.sincronizar(conta.id);
        toast.success("Salvo, e a assinatura no Asaas já está com o valor novo.");
      } else toast.success("Salvo.");
      await onMudou();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
      await onMudou();
    } finally {
      setSalvando(false);
    }
  };

  const convidar = async () => {
    setConvidando(true);
    try {
      const r = await casa.convidar({ conta_id: conta.id, email: convite.email.trim(), nome: convite.nome.trim(), papel: convite.admin ? "admin" : "usuario" });
      setConvite({ email: "", nome: "", admin: false });
      await onMudou();
      toast.success(r.enviado ? "Convite enviado." : "Pessoa adicionada. O e-mail não saiu: reenvie o convite.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível convidar."));
    } finally {
      setConvidando(false);
    }
  };

  const gerarCheckout = async () => {
    setCobrando(true);
    try {
      const r = await casa.gerarCheckout(conta.id);
      if (r.link) {
        try {
          await navigator.clipboard.writeText(r.link);
          toast.success(`Link de pagamento de ${reais(r.valor || 0)} por mês copiado. Vale por 24 horas.`);
        } catch {
          window.prompt("Copie o link de pagamento:", r.link);
        }
      } else toast.success(r.agendado ? "A redução entra na próxima cobrança." : "Assinatura atualizada no Asaas.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível gerar o link."));
    } finally {
      setCobrando(false);
    }
  };

  const cobrarMigracao = async () => {
    setCobrando(true);
    try {
      const r = await casa.cobrarMigracao(conta.id);
      await cobrancas.refetch();
      if (r.link) {
        try {
          await navigator.clipboard.writeText(r.link);
          toast.success(`Cobrança de ${reais(r.valor)} criada. O link foi copiado.`);
        } catch {
          toast.success(`Cobrança de ${reais(r.valor)} criada. O link está em Cobranças.`);
        }
      } else toast.success("Cobrança criada.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cobrar."));
    } finally {
      setCobrando(false);
    }
  };

  const convidados = conta.equipe.filter((m) => m.estado === "convidado").length;
  const abas = [
    { value: "visao" as const, label: "Visão" },
    { value: "plano" as const, label: "Plano" },
    { value: "equipe" as const, label: "Equipe", count: conta.equipe.length },
    { value: "cobranca" as const, label: "Cobrança" },
    { value: "dados" as const, label: "Dados" },
  ];
  const mostraSalvar = aba === "plano" || aba === "dados" || mudou;

  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="xl"
      titulo={conta.nome}
      icone={<Avatar name={conta.nome} size="sm" tone="accent" square />}
      descricao={`${comMaiuscula(situacaoDaConta(conta))} · ${reais(conta.valor_mensal)} por mês`}
      ajuda="A Visão mostra o CRM da empresa como ela vê: números, funil e pessoas. Mudar plano, usuários ou e-mail muda a mensalidade; se a empresa já assina, o valor novo vai para o Asaas ao salvar e vale da próxima cobrança. O nome e o contato dos leads são da empresa e não aparecem."
      abaixoDoTitulo={<PillTabs<AbaDaEmpresa> label="Partes da empresa" tabs={abas} value={aba} onChange={setAba} size="sm" />}
      rodape={
        mostraSalvar ? (
          <>
            {mudou && <span className={juntar(texto.auxiliar, "mr-auto")} data-alteracao-pendente="">Alterações por salvar</span>}
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-conta="">
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </>
        ) : undefined
      }
      data-janela-da-empresa={conta.id}
    >
      <div className="min-w-0" style={CORES_DAS_ETAPAS as CSSProperties} data-aba-da-empresa={aba}>
        {aba === "visao" && <VisaoDaEmpresa conta={conta} aoVivo={aoVivo || null} />}

        {aba === "plano" && (
          <div className="min-w-0 space-y-6">
            {previsto && (
              <div className={juntar(superficie.poco, "flex min-w-0 flex-wrap items-center px-4 py-4 sm:px-5")} data-mensalidade-da-conta="">
                <span className="mr-6 min-w-0">
                  <span className={juntar(texto.rotulo, "block")}>Mensalidade</span>
                  <span className={juntar(texto.numero, "block")}>{reais(previsto.total)}</span>
                </span>
                <span className="mt-2 flex min-w-0 flex-1 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-1.5">
                  {previsto.itens.length === 0 ? <Chip>nada a cobrar</Chip> : previsto.itens.map((i) => <Chip key={i.chave} outline>{i.quantidade > 1 ? `${i.nome} x ${i.quantidade}` : i.nome}</Chip>)}
                </span>
                {conta.assinatura && conta.assinatura.estado !== "sem" && (
                  <span className={juntar(texto.auxiliar, "mt-2 w-full")}>
                    {ROTULO_DA_ASSINATURA[conta.assinatura.estado] || `Assinatura ${conta.assinatura.estado}`}
                    {conta.assinatura.proximo_vencimento ? ` · próxima em ${diaLegivel(conta.assinatura.proximo_vencimento)}` : ""}
                    {conta.assinatura.cartao_final ? ` · cartão final ${conta.assinatura.cartao_final}` : ""}
                  </span>
                )}
              </div>
            )}
            <GrupoDeCampos titulo="Contratado">
              <CampoDeFormulario rotulo="Plano">
                <select value={f.plano_id} onChange={(e) => setF({ ...f, plano_id: e.target.value })} className={campo}>
                  {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {reais(p.preco_usuario)} por usuário{p.ativo ? "" : " (fora de venda)"}</option>)}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Usuários" apoio={`${conta.usuarios_ativos} ativos, ${conta.convites} convidados`}>
                <input type="number" min={1} max={500} value={f.usuarios_contratados} onChange={(e) => setF({ ...f, usuarios_contratados: Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))) })} className={campo} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Ferramentas">
                <div className="flex h-9 items-center">
                  <label className={juntar(texto.corpo, "mr-4 inline-flex items-center")}>
                    <input type="checkbox" className="mr-1.5" checked={f.crm_ativo} onChange={(e) => setF({ ...f, crm_ativo: e.target.checked })} />
                    CRM
                  </label>
                  <label className={juntar(texto.corpo, "inline-flex items-center")}>
                    <input type="checkbox" className="mr-1.5" checked={f.email_ativo} onChange={(e) => setF({ ...f, email_ativo: e.target.checked })} />
                    E-mail profissional
                  </label>
                </div>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Caixas de e-mail">
                <input type="number" min={0} max={500} value={f.email_caixas_contratadas} disabled={!f.email_ativo} onChange={(e) => setF({ ...f, email_caixas_contratadas: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} className={campo} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Situação" ajuda="Cortesia libera sem cobrar. Suspensa bloqueia na hora e guarda os dados. Ativa e atrasada costumam vir sozinhas do Asaas.">
                <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value as EstadoDaConta })} className={campo}>
                  {(conta.estado === "atrasada" ? (["atrasada"] as EstadoDaConta[]).concat(ESTADOS_QUE_A_CASA_DEFINE) : ESTADOS_QUE_A_CASA_DEFINE).map((e) => <option key={e} value={e}>{ROTULO_DO_ESTADO[e]}</option>)}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Teste até">
                <input type="date" value={f.teste_ate} disabled={f.estado !== "teste"} onChange={(e) => setF({ ...f, teste_ate: e.target.value })} className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>
          </div>
        )}

        {aba === "equipe" && (
          <div className="min-w-0 space-y-5">
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]" data-convidar-pessoa="">
              <input type="email" value={convite.email} onChange={(e) => setConvite({ ...convite, email: e.target.value })} className={campo} placeholder="E-mail da pessoa" aria-label="E-mail da pessoa" />
              <input value={convite.nome} onChange={(e) => setConvite({ ...convite, nome: e.target.value })} className={campo} placeholder="Nome" aria-label="Nome da pessoa" />
              <label className={juntar(texto.corpo, "inline-flex h-9 items-center")}>
                <input type="checkbox" className="mr-1.5" checked={convite.admin} onChange={(e) => setConvite({ ...convite, admin: e.target.checked })} />
                Administra
              </label>
              <button type="button" className={botao.primario} onClick={() => void convidar()} disabled={convidando || convite.email.trim().length < 5}>
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {convidando ? "Enviando..." : "Convidar"}
              </button>
            </div>
            <Secao titulo="Pessoas" descricao={`${conta.usuarios_ativos} de ${conta.usuarios_contratados} lugares${convidados ? ` · ${convidados} sem entrar` : ""}`} recolher={false}>
              {conta.equipe.length === 0 ? (
                <EmptyState compact title="Ninguém na equipe ainda." />
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} data-equipe-da-empresa="">
                  {conta.equipe.map((m) => (
                    <li key={m.id} className={lista.linha}>
                      <Foto nome={m.nome || m.email} apagada={m.estado === "convidado"} />
                      <span className="ml-3 min-w-0 flex-1">
                        <span className={juntar(texto.corpo, "block truncate font-medium")}>{m.nome || m.email}</span>
                        <span className={juntar(texto.auxiliar, "block truncate")}>{m.email}{m.entrou_em ? ` · entrou em ${diaLegivel(m.entrou_em)}` : ""}</span>
                      </span>
                      <span className="ml-2 hidden shrink-0 sm:inline-flex">
                        {m.estado === "convidado" ? <StatusPill tone="warning">Convidado</StatusPill> : <Chip tone={m.papel === "admin" ? "accent" : "neutral"}>{PAPEL[m.papel] || m.papel}</Chip>}
                      </span>
                      <button
                        type="button"
                        className={juntar(botao.icone, "ml-1")}
                        aria-label={`Copiar o link de acesso de ${m.email}`}
                        title="Copiar link de acesso (para mandar por WhatsApp)"
                        onClick={() => void copiarLinkDeAcesso(m.id).then((e) => toast.success(`Link de acesso de ${e} copiado. Vale uma vez.`)).catch((e) => toast.error(fraseDoErro(e)))}
                        data-copiar-link-de-acesso=""
                      >
                        <Link2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {m.estado === "convidado" && (
                        <button
                          type="button"
                          className={juntar(botao.icone, "ml-1")}
                          aria-label={`Reenviar o convite de ${m.email}`}
                          title="Reenviar convite"
                          onClick={() => void reenviarConvite(m.id).then((r) => (r.enviado ? toast.success("Convite reenviado.") : toast.error("O e-mail não saiu agora."))).catch((e) => toast.error(fraseDoErro(e)))}
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </div>
        )}

        {aba === "cobranca" && (
          <div className="min-w-0 space-y-5">
            <div className={juntar(superficie.poco, "flex min-w-0 flex-wrap items-center px-4 py-4 sm:px-5")} data-estado-da-cobranca="">
              <span className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-foreground" aria-hidden="true">
                <CreditCard className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>
                  {doPlano ? "Cobrado no plano do cliente" : conta.assinatura && conta.assinatura.estado !== "sem" ? ROTULO_DA_ASSINATURA[conta.assinatura.estado] || `Assinatura ${conta.assinatura.estado}` : "Sem assinatura no cartão"}
                </span>
                <span className={juntar(texto.auxiliar, "block truncate")} data-cobrado-no-plano={doPlano ? "" : undefined}>
                  {doPlano
                    ? "O acesso segue o extra de CRM da ficha do cliente"
                    : conta.assinatura && conta.assinatura.proximo_vencimento
                      ? `${reais(conta.assinatura.valor_mensal || conta.valor_mensal)} · próxima em ${diaLegivel(conta.assinatura.proximo_vencimento)}${conta.assinatura.cartao_final ? ` · cartão final ${conta.assinatura.cartao_final}` : ""}`
                      : `${reais(conta.valor_mensal)} por mês`}
                </span>
              </span>
              <span className="mt-3 flex w-full shrink-0 items-center justify-end sm:ml-4 sm:mt-0 sm:w-auto [&>*+*]:ml-1">
                {!doPlano && (
                  <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void gerarCheckout()} disabled={cobrando} title="Cria o checkout da assinatura no cartão com o plano e os usuários desta empresa e copia o link" data-gerar-checkout="">
                    Link de pagamento
                  </button>
                )}
                <OverflowMenu
                  label="Mais cobranças"
                  items={[{ label: `Cobrar a migração do e-mail${config.data ? ` (${reais(config.data.email_migracao)})` : ""}`, onSelect: () => void cobrarMigracao(), disabled: cobrando }]}
                />
              </span>
            </div>
            <Secao titulo="Cobranças" descricao={cobrancas.data ? `as ${cobrancas.data.length} mais recentes` : undefined} recolher={false}>
              {cobrancas.isLoading ? (
                <Carregando linhas={3} rotulo="Carregando as cobranças" />
              ) : (cobrancas.data || []).length === 0 ? (
                <EmptyState compact title="Nenhuma cobrança ainda." />
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} data-cobrancas-da-empresa="">
                  {(cobrancas.data || []).map((c) => (
                    <li key={c.id} className={lista.linha}>
                      <span className="min-w-0 flex-1">
                        <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.descricao || c.tipo}</span>
                        <span className={juntar(texto.auxiliar, "block truncate")}>{c.vencimento ? `vence ${diaLegivel(c.vencimento)}` : c.tipo}{c.pago_em ? ` · paga em ${diaLegivel(c.pago_em)}` : ""}</span>
                      </span>
                      <StatusPill tone={TOM_DA_COBRANCA[c.estado] || "neutral"} plain className="ml-2 hidden sm:inline-flex">{ROTULO_DA_COBRANCA[c.estado] || c.estado}</StatusPill>
                      <span className={juntar(texto.corpo, "ml-3 w-[88px] shrink-0 text-right font-medium tabular-nums")}>{reais(c.valor)}</span>
                      {c.link && <a href={c.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "ml-1 h-8")}>Abrir</a>}
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </div>
        )}

        {aba === "dados" && (
          <GrupoDeCampos titulo="Empresa">
            <CampoDeFormulario rotulo="Nome" obrigatorio>
              <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} maxLength={120} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="CPF ou CNPJ" apoio="Obrigatório para cobrar">
              <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} className={campo} inputMode="numeric" maxLength={20} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="E-mail da cobrança">
              <input type="email" value={f.email_cobranca} onChange={(e) => setF({ ...f, email_cobranca: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="WhatsApp">
              <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} className={campo} maxLength={20} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Cliente no painel" apoio="Quando a empresa também é cliente da agência">
              <select value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} className={campo}>
                <option value="">Não é cliente do painel</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Desde">
              <input value={diaLegivel(conta.criado_em, true)} readOnly className={juntar(campo, "text-muted-foreground")} aria-label="Cliente desde" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Anotação da casa" largo>
              <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={campoTexto} maxLength={600} />
            </CampoDeFormulario>
          </GrupoDeCampos>
        )}
      </div>
    </JanelaCentral>
  );
}

// ------------------------------------------------------------------ visão (como o cliente vê)

function VisaoDaEmpresa({ conta, aoVivo }: { conta: ContaNaCasa; aoVivo: EmpresaNoMonitor | null }) {
  const d = useQuery({ queryKey: ["produto", "casa", "monitor", conta.id], queryFn: () => lerMonitorDaConta(conta.id), refetchInterval: RELER_A_CADA });
  const [todos, setTodos] = useState(false);
  const agora = Date.now();
  const funil = d.data ? d.data.funil : [];
  const daEtapa = (id: string) => funil.filter((x) => x.etapa === id)[0] || { etapa: id, negocios: 0, valor: 0 };
  const abertas = ESTAGIOS_ABERTOS.map((id) => ({ id, rotulo: rotuloDoEstagio(id), ...daEtapa(id) }));
  const abertos = aoVivo ? aoVivo.abertos : abertas.reduce((s, e) => s + e.negocios, 0);
  const valorAberto = aoVivo ? aoVivo.valor_aberto : abertas.reduce((s, e) => s + e.valor, 0);
  const ganho = daEtapa("ganho");
  const ganhos = aoVivo ? aoVivo.ganhos_mes : ganho.negocios;
  const valorGanho = aoVivo ? aoVivo.valor_ganho_mes : ganho.valor;
  const pessoas = d.data ? d.data.pessoas : [];
  const atrasadas = aoVivo ? aoVivo.tarefas_atrasadas : pessoas.reduce((s, p) => s + p.tarefas_atrasadas, 0);
  const maiorEtapa = Math.max(1, ...abertas.map((e) => e.negocios));
  const maiorPessoa = Math.max(1, ...pessoas.map((p) => p.abertos));
  const movimentos = d.data ? d.data.movimentos : [];
  const carregando = d.isLoading && !aoVivo;

  if (d.isError && !d.data) {
    return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void d.refetch()}>Tentar de novo</button>} />;
  }

  return (
    <div className="min-w-0 space-y-6" data-empresa-ao-vivo={conta.id}>
      <StatGrid label="Números da empresa">
        <StatCard size="md" icon={<Handshake className="h-4 w-4" />} label="Em negociação" value={carregando ? "…" : reaisCurto(valorAberto, reais)} hint={carregando ? " " : `${abertos} ${abertos === 1 ? "negócio aberto" : "negócios abertos"}`} />
        <StatCard size="md" icon={<CircleDollarSign className="h-4 w-4" />} label="Ganho no mês" value={carregando ? "…" : reaisCurto(valorGanho, reais)} hint={carregando ? " " : `${ganhos} ${ganhos === 1 ? "venda" : "vendas"}`} />
        <StatCard
          size="md"
          icon={<Users className="h-4 w-4" />}
          progress={{ value: conta.usuarios_ativos, max: Math.max(1, conta.usuarios_contratados) }}
          label="Equipe"
          value={String(conta.usuarios_ativos)}
          hint={`de ${conta.usuarios_contratados} contratados${conta.convites ? ` · ${conta.convites} sem entrar` : ""}`}
        />
        <StatCard size="md" icon={<CalendarClock className="h-4 w-4" />} label="Tarefas atrasadas" value={carregando ? "…" : String(atrasadas)} hint={aoVivo ? `${aoVivo.novos_hoje} leads hoje · ${aoVivo.novos_7d} em 7 dias` : `mexeram ${haQuanto(conta.ultimo_uso, agora)}`} />
      </StatGrid>

      <GradeDeSecoes>
        <Secao titulo="Funil agora" descricao={carregando ? undefined : `${abertos} ${abertos === 1 ? "negócio" : "negócios"} · ${reais(valorAberto)}`} recolher={false}>
          {d.isLoading ? (
            <Carregando linhas={5} rotulo="Carregando o funil" />
          ) : abertos === 0 ? (
            <EmptyState compact title="Nenhum negócio aberto." />
          ) : (
            <ol className="min-w-0 space-y-2" data-funil-ao-vivo="">
              {abertas.map((e, i) => {
                const largura = e.negocios ? Math.max(14, Math.round((e.negocios / maiorEtapa) * 100)) : 6;
                return (
                  <li key={e.id} className="grid min-w-0 grid-cols-[minmax(0,112px)_minmax(0,1fr)_auto] items-center gap-x-3 py-0.5">
                    <span className="flex min-w-0 items-center">
                      <span className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDaEtapa(e.id) }} aria-hidden="true" />
                      <span className={juntar(texto.corpo, "min-w-0 truncate")}>{e.rotulo}</span>
                    </span>
                    <span className="flex min-w-0 justify-center" aria-hidden="true">
                      <span className="flex h-7 items-center justify-center rounded-md text-[12px] font-semibold text-white" style={{ width: `${largura}%`, backgroundColor: corDaEtapa(e.id), opacity: e.negocios ? 1 : 0.28, transitionDelay: `${i * 40}ms` }}>
                        {e.negocios > 0 ? e.negocios : ""}
                      </span>
                    </span>
                    <span className={juntar(texto.corpo, "w-[84px] shrink-0 text-right font-medium tabular-nums")}>{reaisCurto(e.valor, reais)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Secao>

        <Secao titulo="Pessoas" descricao={d.data ? `${pessoas.length}` : undefined} recolher={false}>
          {d.isLoading ? (
            <Carregando linhas={4} rotulo="Carregando as pessoas" />
          ) : pessoas.length === 0 ? (
            <EmptyState compact title="Ninguém entrou ainda." />
          ) : (
            <ul className="min-w-0 space-y-3" data-pessoas-ao-vivo="">
              {pessoas.map((p) => (
                <li key={p.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
                  <Foto nome={p.nome} tamanho="p" apagada={p.estado === "convidado"} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-baseline">
                      <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{p.nome}</span>
                      <span className={juntar(texto.auxiliar, "ml-2 shrink-0 truncate")}>
                        {p.estado === "convidado" ? "convidado" : `${p.cargo || PAPEL[p.papel] || p.papel} · ${haQuanto(p.ultimo_movimento || p.ultimo_acesso, agora)}`}
                      </span>
                    </span>
                    <Barra parte={p.abertos / maiorPessoa} className="mt-1" altura={4} />
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={juntar(texto.corpo, "block font-medium tabular-nums")}>{p.abertos} abertos</span>
                    <span className={juntar(texto.auxiliar, "block tabular-nums", p.tarefas_atrasadas ? "text-warning" : "")}>
                      {p.tarefas_atrasadas ? `${p.tarefas_atrasadas} atrasadas` : `${p.ganhos_mes} ${p.ganhos_mes === 1 ? "ganho" : "ganhos"}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </GradeDeSecoes>

      <Secao
        titulo="Últimos movimentos"
        descricao={d.data ? (movimentos.length ? `o mais novo ${haQuanto(movimentos[0].quando, agora)}` : "nenhum ainda") : undefined}
        acao={movimentos.length > 6 ? <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setTodos(!todos)}>{todos ? "Ver menos" : `Ver ${movimentos.length}`}</button> : undefined}
        recolher={false}
      >
        {d.isLoading ? (
          <Carregando linhas={3} rotulo="Carregando os movimentos" />
        ) : movimentos.length === 0 ? (
          <EmptyState compact title="Nenhum movimento ainda." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-movimentos-ao-vivo="">
            {(todos ? movimentos : movimentos.slice(0, 6)).map((m) => (
              <li key={m.id} className={juntar(lista.linha, "py-2.5")}>
                <span className="mr-3 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.para ? corDaEtapa(m.para) : "hsl(var(--muted-foreground))" }} aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  <span className="font-medium">{m.quem || "Automático"}</span>{" "}
                  {m.de && m.para ? `moveu de ${etapa(m.de)} para ${etapa(m.para)}` : m.para ? `colocou em ${etapa(m.para)}` : `registrou ${m.tipo.replace(/_/g, " ")}`}
                </span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{haQuanto(m.quando, agora)}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}
