import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Inbox, Mail, Wallet } from "lucide-react";
import { diaLegivel, fraseDoErro, reais, ROTULO_DO_ESTADO_DO_DOMINIO, ROTULO_DO_PROVEDOR, type EstadoDoDominio, type ProvedorDeEmail } from "@/lib/produto/api";
import {
  ROTULO_DA_SAUDE,
  carregarCentral,
  diasAteODia,
  proximoVencimento,
  resumoDaCentral,
  saudeDoCliente,
  type ClienteNaCentral,
  type DominioNaCentral,
  type Gravidade,
  type Saude,
} from "@/lib/produto/email-central";
import { salvarIntegracao } from "@/lib/produto/email-pedidos";
import { Avatar, Card, Chip, List, ListRow, ProgressBar, SearchField, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import { CampoDeFormulario, EstadoVazio, GrupoDeCampos, JanelaCentral, SeletorCompacto, botao, campo, juntar } from "@/components/sistema";
import { BotaoDeReler, ErroDaTela, EsqueletoDaTela, FichaDeDados, ListaDeAvisos, TituloDoBloco } from "./pecasDaCasa";

export const chaveDaCentral = ["produto", "casa", "email", "central"] as const;

export const TOM_DA_SAUDE: Record<Saude, Tone> = { saudavel: "success", atencao: "warning", critico: "danger", migrando: "info", aguardando: "warning" };
const ROTULO_DO_CORREIO: Record<DominioNaCentral["correio_provedor"], string> = { nenhum: "Sem correio no painel", zoho: "Zoho (pago)", migadu: "Migadu", imap: "Outro (IMAP)" };

const hojeEmSaoPaulo = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** "em 12 dias", "hoje", "há 3 dias". */
export function quando(dia: string, hoje: string): string {
  const d = diasAteODia(dia, hoje);
  if (d === null) return "";
  if (d === 0) return "hoje";
  return d > 0 ? `em ${d} ${d === 1 ? "dia" : "dias"}` : `há ${-d} ${d === -1 ? "dia" : "dias"}`;
}

type Filtro = "todos" | Saude;
const ORDEM: Record<Saude, number> = { critico: 0, atencao: 1, aguardando: 2, migrando: 3, saudavel: 4 };

/**
 * A central de e-mail da casa: todos os clientes que têm e-mail com a Aceleriq, a saúde de cada um
 * (pagamento, vencimentos, DNS, limite de caixas, pedidos parados) e o próximo vencimento. Abrir um
 * cliente mostra os avisos e deixa anotar os vencimentos e o provedor do correio.
 * 19/11/2026 (redesenho): números em StatCard, lista em cartão com estado em pílula, filtro num
 * seletor e a ficha do cliente na janela do centro.
 */
export default function CentralDeEmail() {
  const qc = useQueryClient();
  const central = useQuery({ queryKey: chaveDaCentral, queryFn: carregarCentral });
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const hoje = hojeEmSaoPaulo();

  const clientes = central.data || [];
  const comSaude = useMemo(() => clientes.map((c) => ({ c, s: saudeDoCliente(c, hoje), v: proximoVencimento(c) })), [clientes, hoje]);
  const resumo = useMemo(() => resumoDaCentral(clientes, hoje), [clientes, hoje]);

  if (central.isLoading) return <EsqueletoDaTela rotulo="Carregando a central" />;
  if (central.isError) return <ErroDaTela titulo="Não foi possível carregar a central." aoTentar={() => void central.refetch()} />;

  const termo = busca.trim().toLowerCase();
  const visiveis = comSaude
    .filter((x) => filtro === "todos" || x.s.estado === filtro)
    .filter((x) => !termo || x.c.empresa.toLowerCase().indexOf(termo) >= 0 || x.c.dominios.some((d) => d.dominio.indexOf(termo) >= 0))
    .sort((a, b) => ORDEM[a.s.estado] - ORDEM[b.s.estado] || a.c.empresa.localeCompare(b.c.empresa));
  const escolhido = comSaude.filter((x) => x.c.conta_id === aberto)[0] || null;
  const precisam = resumo.por.critico + resumo.por.atencao;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" data-central-de-email="">
      <StatGrid label="Resumo do e-mail dos clientes">
        <StatCard icon={<Mail className="h-4 w-4" />} label="Clientes" value={resumo.clientes} hint={`${resumo.caixas} ${resumo.caixas === 1 ? "caixa" : "caixas"}`} />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Precisam de você"
          value={precisam}
          hint={resumo.por.critico ? `${resumo.por.critico} ${resumo.por.critico === 1 ? "crítico" : "críticos"}` : precisam ? "só atenção" : "tudo em dia"}
          onClick={precisam ? () => setFiltro(resumo.por.critico ? "critico" : "atencao") : undefined}
        />
        <StatCard icon={<CalendarClock className="h-4 w-4" />} label="Vencem em 30 dias" value={resumo.vencendo} hint="domínio, plano ou mensalidade" />
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="Receita por mês"
          value={reais(resumo.receita)}
          hint={resumo.custo > 0 ? `margem ${reais(resumo.margem)}` : "custo do provedor não anotado"}
          help={resumo.custo > 0 ? `Custo do provedor: ${reais(resumo.custo)} por mês.` : undefined}
        />
      </StatGrid>

      <Card
        title="Clientes"
        subtitle={`${visiveis.length} de ${clientes.length}`}
        help="Uma linha por cliente com e-mail na Aceleriq, do mais urgente para o mais tranquilo. A saúde junta pagamento, vencimento do domínio e do plano de e-mail, DNS, limite de caixas e pedidos parados. Abra o cliente para ver os avisos e anotar os vencimentos."
        action={<BotaoDeReler aoReler={() => void central.refetch()} relendo={central.isFetching} />}
        data-clientes-da-central-cartao=""
      >
        <div className="mb-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <SeletorCompacto
            rotulo="Saúde"
            modo="lista"
            opcoes={[{ valor: "todos", rotulo: "Todos", contador: clientes.length }, ...(["critico", "atencao", "aguardando", "migrando", "saudavel"] as Saude[]).map((s) => ({ valor: s, rotulo: ROTULO_DA_SAUDE[s], contador: resumo.por[s] }))]}
            valor={filtro}
            onEscolher={(v) => setFiltro(v as Filtro)}
          />
          <SearchField value={busca} onChange={setBusca} placeholder="Cliente ou domínio" label="Buscar cliente ou domínio" className="sm:ml-auto sm:w-[280px]" />
        </div>
        {visiveis.length === 0 ? (
          <EstadoVazio
            icone={<Inbox className="h-5 w-5" aria-hidden="true" />}
            titulo={clientes.length ? "Nada neste filtro" : "Nenhum cliente com e-mail ainda"}
            descricao={clientes.length ? undefined : "Aparece aqui quando uma entrada é marcada como paga."}
            acao={clientes.length ? <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => { setFiltro("todos"); setBusca(""); }}>Limpar filtro</button> : <Link to="/produto/email/entradas" className={juntar(botao.secundario, "h-8")}>Ver entradas</Link>}
          />
        ) : (
          <List label="Clientes com e-mail">
            {visiveis.map(({ c, s, v }) => (
              <ListRow
                key={c.conta_id}
                leading={<Avatar name={c.empresa} tone={s.estado === "critico" ? "neutral" : "accent"} />}
                title={c.empresa}
                subtitle={s.avisos[0] ? `${s.avisos[0].texto}${s.avisos.length > 1 ? ` (+${s.avisos.length - 1})` : ""}` : [c.dominios.map((d) => d.dominio).join(", "), v ? `${v.oQue} ${quando(v.dia, hoje)}` : ""].filter(Boolean).join(" · ") || "Sem domínio ainda"}
                status={<StatusPill tone={TOM_DA_SAUDE[s.estado]}>{ROTULO_DA_SAUDE[s.estado]}</StatusPill>}
                value={`${c.caixas}${c.caixas_contratadas ? `/${c.caixas_contratadas}` : ""}`}
                valueHint={c.caixas === 1 && !c.caixas_contratadas ? "caixa" : "caixas"}
                onClick={() => setAberto(c.conta_id)}
              />
            ))}
          </List>
        )}
      </Card>

      {escolhido && (
        <FichaDoEmail
          cliente={escolhido.c}
          saude={escolhido.s}
          hoje={hoje}
          onFechar={() => setAberto(null)}
          aoSalvar={() => qc.invalidateQueries({ queryKey: ["produto", "casa", "email"] })}
        />
      )}
    </div>
  );
}

function textoDaCobranca(cliente: ClienteNaCentral): string {
  if (cliente.cobranca) return `${reais(cliente.cobranca.mensal)} por mês no extra${cliente.cobranca.proximo_vencimento ? ` · próxima ${diaLegivel(cliente.cobranca.proximo_vencimento, true)}` : ""}`;
  if (cliente.assinatura && cliente.assinatura.estado !== "sem") return `${reais(cliente.assinatura.valor_mensal)} por mês na assinatura${cliente.assinatura.proximo_vencimento ? ` · próxima ${diaLegivel(cliente.assinatura.proximo_vencimento, true)}` : ""}`;
  if (cliente.pedido && cliente.pedido.pago_em) return `Pago em ${diaLegivel(cliente.pedido.pago_em, true)}`;
  return "Sem cobrança registrada";
}

function FichaDoEmail({ cliente, saude, hoje, onFechar, aoSalvar }: { cliente: ClienteNaCentral; saude: { estado: Saude; avisos: Array<{ gravidade: Gravidade; texto: string }> }; hoje: string; onFechar: () => void; aoSalvar: () => Promise<unknown> }) {
  const v = proximoVencimento(cliente);
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={cliente.empresa}
      descricao={`${cliente.caixas} ${cliente.caixas === 1 ? "caixa" : "caixas"}${cliente.apelidos ? ` · ${cliente.apelidos} ${cliente.apelidos === 1 ? "apelido" : "apelidos"}` : ""}`}
      acoes={<StatusPill tone={TOM_DA_SAUDE[saude.estado]}>{ROTULO_DA_SAUDE[saude.estado]}</StatusPill>}
      rodape={<Link to="/produto/email/entradas" className={botao.secundario}>Abrir entradas e migração</Link>}
    >
      <div className="min-w-0 space-y-6" data-ficha-do-email="">
        <ListaDeAvisos avisos={saude.avisos} />
        <FichaDeDados
          itens={[
            ["Cobrança", textoDaCobranca(cliente)],
            ["Caixas", `${cliente.caixas}${cliente.caixas_contratadas ? ` de ${cliente.caixas_contratadas} contratadas` : ""}${cliente.caixas_sem_dono ? ` · ${cliente.caixas_sem_dono} sem pessoa` : ""}`],
            ["Próximo vencimento", v ? `${v.oQue} ${quando(v.dia, hoje)} (${diaLegivel(v.dia, true)})` : "nada anotado"],
            ["Pedido", cliente.pedido ? `${cliente.pedido.tipo === "migracao" ? "Migração" : "E-mail novo"} desde ${diaLegivel(cliente.pedido.criado_em, true)}` : ""],
          ]}
        />
        {cliente.dominios.length === 0 ? (
          <EstadoVazio compacto titulo="Ainda sem domínio." descricao="Marque a entrada como paga para a migração nascer." />
        ) : (
          cliente.dominios.map((d) => <DominioNaFicha key={d.id} dominio={d} hoje={hoje} aoSalvar={aoSalvar} />)
        )}
      </div>
    </JanelaCentral>
  );
}

function DominioNaFicha({ dominio, hoje, aoSalvar }: { dominio: DominioNaCentral; hoje: string; aoSalvar: () => Promise<unknown> }) {
  const [f, setF] = useState({
    dominio_vence_em: dominio.dominio_vence_em || "",
    provedor_vence_em: dominio.provedor_vence_em || "",
    provedor_custo_mensal: dominio.provedor_custo_mensal == null ? "" : String(dominio.provedor_custo_mensal),
    correio_provedor: dominio.correio_provedor,
    correio_ligado: dominio.correio_ligado,
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      const provedor = f.correio_provedor;
      await salvarIntegracao(dominio.id, {
        dominio_vence_em: f.dominio_vence_em,
        provedor_vence_em: f.provedor_vence_em,
        provedor_custo_mensal: f.provedor_custo_mensal.replace(",", "."),
        correio_provedor: provedor,
        correio_ligado: provedor === "nenhum" ? false : f.correio_ligado,
      });
      toast.success("Salvo.");
      await aoSalvar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };
  const dns: { tom: Tone; rotulo: string } = dominio.dns_pronto === null ? { tom: "neutral", rotulo: "DNS não conferido" } : dominio.dns_pronto ? { tom: "success", rotulo: "DNS certo" } : { tom: dominio.dns_faltas ? "danger" : "warning", rotulo: dominio.dns_faltas ? `DNS: ${dominio.dns_faltas} faltando` : "DNS com atenção" };
  return (
    <section className="min-w-0 border-t border-border/60 pt-5" data-dominio-na-ficha="">
      <TituloDoBloco aoLado={<Chip tone="neutral">{ROTULO_DO_ESTADO_DO_DOMINIO[dominio.estado as EstadoDoDominio] || dominio.estado}</Chip>}>{dominio.dominio}</TituloDoBloco>
      <div className="mb-4 flex min-w-0 flex-wrap items-center [&>*]:mb-1.5 [&>*]:mr-1.5">
        <Chip tone={dns.tom} dot>{dns.rotulo}</Chip>
        <Chip tone="neutral">{ROTULO_DO_PROVEDOR[dominio.provedor as ProvedorDeEmail] || dominio.provedor}</Chip>
        <Chip tone={dominio.correio_ligado ? "success" : "neutral"}>{dominio.correio_ligado ? `Correio ligado (${ROTULO_DO_CORREIO[dominio.correio_provedor]})` : "Correio desligado"}</Chip>
        {dominio.checado_em && <Chip tone="neutral">conferido {quando(dominio.checado_em.slice(0, 10), hoje)}</Chip>}
      </div>
      {dominio.etapas_total > 0 && (
        <div className="mb-5 min-w-0">
          <div className="mb-1.5 flex items-center text-[12px] leading-4 text-muted-foreground">
            <span className="flex-1">Migração</span>
            <span className="tabular-nums">{dominio.etapas_feitas} de {dominio.etapas_total} etapas</span>
          </div>
          <ProgressBar value={dominio.etapas_feitas} max={dominio.etapas_total} tone={1} label={`${dominio.etapas_feitas} de ${dominio.etapas_total} etapas`} />
        </div>
      )}
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Registro do domínio vence em" ajuda="A central avisa 45 dias antes.">
          <input type="date" value={f.dominio_vence_em} onChange={(e) => setF({ ...f, dominio_vence_em: e.target.value })} className={campo} data-campo="dominio-vence" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Plano de e-mail vence em" apoio="Vazio no plano gratuito">
          <input type="date" value={f.provedor_vence_em} onChange={(e) => setF({ ...f, provedor_vence_em: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Custo do provedor por mês" ajuda="Em reais, só deste domínio. Entra na margem.">
          <input value={f.provedor_custo_mensal} onChange={(e) => setF({ ...f, provedor_custo_mensal: e.target.value })} className={campo} inputMode="decimal" placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Correio no painel" ajuda="Com o Migadu, o correio lê por IMAP e envia por SMTP. Ligue depois de conectar a senha de cada caixa no /correio.">
          <select value={f.correio_provedor} onChange={(e) => setF({ ...f, correio_provedor: e.target.value as DominioNaCentral["correio_provedor"] })} className={campo} data-campo="correio-provedor">
            {(Object.keys(ROTULO_DO_CORREIO) as Array<DominioNaCentral["correio_provedor"]>).map((p) => <option key={p} value={p}>{ROTULO_DO_CORREIO[p]}</option>)}
          </select>
        </CampoDeFormulario>
        {f.correio_provedor !== "nenhum" && (
          <CampoDeFormulario rotulo="Situação do correio" largo>
            <SeletorCompacto rotulo="Correio" opcoes={[{ valor: "nao", rotulo: "Desligado" }, { valor: "sim", rotulo: "Ligado" }]} valor={f.correio_ligado ? "sim" : "nao"} onEscolher={(v) => setF({ ...f, correio_ligado: v === "sim" })} />
          </CampoDeFormulario>
        )}
      </GrupoDeCampos>
      <div className="mt-3 flex justify-end">
        <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void salvar()} disabled={salvando} data-salvar-vencimentos="">{salvando ? "Salvando..." : "Salvar"}</button>
      </div>
    </section>
  );
}
