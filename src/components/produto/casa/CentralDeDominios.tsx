import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Archive, CalendarClock, Cloud, ExternalLink, Globe, MonitorSmartphone, Plus, RefreshCw, Wallet, WifiOff } from "lucide-react";
import { diaLegivel, fraseDoErro, reais, ROTULO_DO_ESTADO_DO_DOMINIO, ROTULO_DO_PROVEDOR, type EstadoDoDominio, type ProvedorDeEmail } from "@/lib/produto/api";
import {
  ROTULO_DA_SAUDE,
  arquivar,
  avisosDoDominio,
  avisosDoSite,
  carregarCentralDeDominios,
  conferirAgora,
  dominioNoFiltro,
  estadoDaLeitura,
  faltasNoDns,
  lerCloudflare,
  ondeEstaODns,
  porMes,
  resumoDaCentralDeDominios,
  salvarDominio,
  salvarSite,
  saudeDosAvisos,
  siteNoFiltro,
  temEmail,
  type Aviso,
  type CentralDeDominios as Central,
  type DominioDaCasa,
  type Filtro,
  type Periodo,
  type Saude,
  type SiteDaCasa,
} from "@/lib/produto/dominios-sites";
import { quando } from "./CentralDeEmail";
import { Card, Chip, HelpTooltip, List, ListRow, OverflowMenu, SearchField, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import { CampoDeFormulario, EstadoVazio, GrupoDeCampos, JanelaCentral, SeletorCompacto, botao, campo, juntar, texto } from "@/components/sistema";
import { ErroDaTela, EsqueletoDaTela, FichaDeDados, ListaDeAvisos, TituloDoBloco } from "./pecasDaCasa";

export const chaveDosDominios = ["produto", "casa", "dominios"] as const;

const TOM_DA_SAUDE: Record<Saude, Tone> = { ok: "success", atencao: "warning", critico: "danger" };
const ROTULO_DA_ORIGEM: Record<string, string> = { manual: "Cadastro manual", cloudflare: "Cloudflare", email: "E-mail" };
const ordemDaSaude: Record<Saude, number> = { critico: 0, atencao: 1, ok: 2 };

const hojeEmSaoPaulo = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const porPeriodo = (v: number | null, p: Periodo) => (v === null ? "" : `${reais(v)}${p === "anual" ? " por ano" : " por mês"}`);

type Parte = "dominios" | "sites";
const VAZIA: Central = { dominios: [], sites: [], clientes: [], leitura: { dominios_em: null, cloudflare_em: null, sites_em: null } };

/**
 * Central de domínios e sites da casa: os domínios dos clientes (registrador, DNS, vencimento, e-mail)
 * e os sites publicados (resposta, SSL, publicação), com quanto custam e quanto a casa cobra.
 * A Cloudflare é lida só por GET pela função casa-dominios; sem o token, a tela usa o que está no banco.
 * 19/11/2026 (redesenho): números em StatCard, a lista em cartão com estado em pílula, filtros num
 * seletor, um botão principal (Cadastrar) com o resto no "..." e a ficha na janela do centro.
 */
export default function CentralDeDominios({ parte }: { parte: Parte }) {
  const qc = useQueryClient();
  const central = useQuery({ queryKey: chaveDosDominios, queryFn: carregarCentralDeDominios });
  const leitura = useQuery({ queryKey: [...chaveDosDominios, "leitura"], queryFn: estadoDaLeitura, staleTime: 60000 });
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [cliente, setCliente] = useState("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [verArquivados, setVerArquivados] = useState(false);
  const hoje = hojeEmSaoPaulo();
  const recarregar = () => qc.invalidateQueries({ queryKey: chaveDosDominios });

  const conferir = useMutation({
    mutationFn: () => conferirAgora(parte),
    onSuccess: (r) => {
      toast.success(parte === "dominios" ? `${r.dominios} ${r.dominios === 1 ? "domínio conferido" : "domínios conferidos"}.` : `${r.saude_sites} ${r.saude_sites === 1 ? "site conferido" : "sites conferidos"}.`);
      void recarregar();
    },
    onError: (e) => toast.error(fraseDoErro(e, "Não foi possível conferir agora.")),
  });
  const cloudflare = useMutation({
    mutationFn: lerCloudflare,
    onSuccess: (r) => {
      toast.success(`Cloudflare lida: ${r.dominios} ${r.dominios === 1 ? "zona" : "zonas"} e ${r.sites} ${r.sites === 1 ? "site" : "sites"}.`);
      if (r.avisos && r.avisos.length) toast.warning(r.avisos[0]);
      void recarregar();
    },
    onError: (e) => toast.error(fraseDoErro(e, "Não foi possível ler a Cloudflare.")),
  });

  const dados: Central = central.data || VAZIA;
  const resumo = useMemo(() => resumoDaCentralDeDominios(dados, hoje), [dados, hoje]);

  if (central.isLoading) return <EsqueletoDaTela rotulo="Carregando a central" />;
  if (central.isError) return <ErroDaTela titulo="Não foi possível carregar a central." aoTentar={() => void central.refetch()} />;

  const termo = busca.trim().toLowerCase();
  const doCliente = (c: string | null) => cliente === "todos" || (cliente === "sem" ? !c : c === cliente);
  const dominios = dados.dominios
    .filter((d) => d.arquivado === verArquivados && doCliente(d.cliente) && dominioNoFiltro(d, filtro, hoje))
    .filter((d) => !termo || d.dominio.indexOf(termo) >= 0 || (d.cliente_nome || "").toLowerCase().indexOf(termo) >= 0)
    .map((d) => ({ d, avisos: avisosDoDominio(d, hoje) }))
    .sort((a, b) => ordemDaSaude[saudeDosAvisos(a.avisos)] - ordemDaSaude[saudeDosAvisos(b.avisos)] || a.d.dominio.localeCompare(b.d.dominio));
  const sites = dados.sites
    .filter((s) => s.arquivado === verArquivados && doCliente(s.cliente) && siteNoFiltro(s, filtro))
    .filter((s) => !termo || s.nome.toLowerCase().indexOf(termo) >= 0 || (s.endereco || "").indexOf(termo) >= 0 || (s.cliente_nome || "").toLowerCase().indexOf(termo) >= 0)
    .map((s) => ({ s, avisos: avisosDoSite(s) }))
    .sort((a, b) => ordemDaSaude[saudeDosAvisos(a.avisos)] - ordemDaSaude[saudeDosAvisos(b.avisos)] || a.s.nome.localeCompare(b.s.nome));

  const filtros: Array<{ valor: Filtro; rotulo: string; contador?: number }> = parte === "dominios"
    ? [{ valor: "todos", rotulo: "Todos" }, { valor: "problema", rotulo: "Com aviso" }, { valor: "vence30", rotulo: "Vence em 30 dias", contador: resumo.vencendo }, { valor: "dns", rotulo: "DNS com falta", contador: resumo.dnsComFalta }, { valor: "sem_cliente", rotulo: "Sem cliente" }]
    : [{ valor: "todos", rotulo: "Todos" }, { valor: "problema", rotulo: "Com aviso" }, { valor: "fora", rotulo: "Fora do ar", contador: resumo.foraDoAr }, { valor: "sem_cliente", rotulo: "Sem cliente" }];
  const filtroValido = filtros.some((f) => f.valor === filtro) ? filtro : "todos";
  const ligado = leitura.data ? leitura.data.cloudflare : false;
  const publicada = !!(leitura.data && leitura.data.publicada);
  const ultima = parte === "dominios" ? dados.leitura.dominios_em : dados.leitura.sites_em;
  const total = parte === "dominios" ? dados.dominios.filter((d) => !d.arquivado).length : dados.sites.filter((s) => !s.arquivado).length;
  const visiveis = parte === "dominios" ? dominios.length : sites.length;
  const dominioAberto = parte === "dominios" ? dados.dominios.filter((d) => (d.id || `email:${d.dominio}`) === aberto)[0] || null : null;
  const siteAberto = parte === "sites" ? dados.sites.filter((s) => s.id === aberto)[0] || null : null;
  const comFiltro = filtroValido !== "todos" || cliente !== "todos" || !!termo;
  const limpar = () => {
    setFiltro("todos");
    setCliente("todos");
    setBusca("");
  };

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" data-central-de-dominios={parte}>
      <StatGrid label="Resumo dos domínios e sites">
        {parte === "dominios" ? (
          <StatCard icon={<Globe className="h-4 w-4" />} label="Domínios" value={resumo.dominios} hint={`${resumo.naCasa} na Cloudflare da casa`} />
        ) : (
          <StatCard icon={<MonitorSmartphone className="h-4 w-4" />} label="Sites" value={resumo.sites} hint={`${resumo.dominios} ${resumo.dominios === 1 ? "domínio" : "domínios"}`} />
        )}
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Precisam de você" value={resumo.precisam} hint={resumo.precisam ? "com aviso" : "tudo em dia"} onClick={resumo.precisam ? () => setFiltro("problema") : undefined} />
        {parte === "dominios" ? (
          <StatCard icon={<CalendarClock className="h-4 w-4" />} label="Vencem em 30 dias" value={resumo.vencendo} hint={resumo.dnsComFalta ? `${resumo.dnsComFalta} com DNS faltando` : "DNS em ordem"} onClick={resumo.vencendo ? () => setFiltro("vence30") : undefined} />
        ) : (
          <StatCard icon={<WifiOff className="h-4 w-4" />} label="Fora do ar" value={resumo.foraDoAr} hint={resumo.foraDoAr ? "não abriram" : "todos no ar"} onClick={resumo.foraDoAr ? () => setFiltro("fora") : undefined} />
        )}
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Receita por mês" value={reais(resumo.receita)} hint={`margem ${reais(resumo.margem)}`} help={`Custo para a casa: ${reais(resumo.custo)} por mês.`} />
      </StatGrid>

      <Card
        title={parte === "dominios" ? "Domínios" : "Sites"}
        subtitle={`${visiveis} de ${total}${ultima ? ` · conferido ${quando(ultima.slice(0, 10), hoje)}` : " · nunca conferido"}${verArquivados ? " · arquivados" : ""}`}
        help={parte === "dominios"
          ? "Todos os domínios dos clientes: o cadastrado à mão, o que está na Cloudflare da casa e o do e-mail. Conferir agora lê o vencimento no RDAP (Registro.br para .br) e o DNS do e-mail (MX, SPF, DKIM, DMARC). Abra o domínio para ligar a um cliente e anotar custo e preço."
          : "Os sites publicados na Cloudflare da casa (Workers e Pages) e os cadastrados à mão. Conferir agora abre cada endereço por HTTPS: código da resposta, tempo e certificado. Abra o site para ligar a um cliente e anotar custo e preço."}
        action={
          <span className="flex items-center [&>*+*]:ml-1">
            <button type="button" className={botao.icone} onClick={() => conferir.mutate()} disabled={conferir.isPending || !publicada} aria-label="Conferir agora" title="Conferir agora" data-conferir-agora="">
              <RefreshCw className={juntar("h-4 w-4", conferir.isPending && "animate-spin")} aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setNovo(true)} aria-label="Cadastrar" data-cadastrar="">
              <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Cadastrar</span>
            </button>
          </span>
        }
        menu={[
          { label: ligado ? "Ler zonas e sites da Cloudflare" : "Ler a Cloudflare (desligada)", icon: <Cloud className="h-4 w-4" />, onSelect: () => cloudflare.mutate(), disabled: !ligado || cloudflare.isPending },
          { label: verArquivados ? "Voltar aos ativos" : "Ver arquivados", icon: <Archive className="h-4 w-4" />, onSelect: () => setVerArquivados(!verArquivados), separatorBefore: true },
        ]}
        menuLabel="Mais ações da central"
        data-lista-da-central=""
      >
        {!ligado && !leitura.isLoading && (
          <div className="mb-3 flex min-w-0 items-center" data-ligar-cloudflare="">
            <Chip tone="warning" dot icon={<Cloud className="h-3 w-3" />}>{publicada ? "Cloudflare não ligada" : "Função casa-dominios fora do ar"}</Chip>
            <HelpTooltip className="ml-1" label="Como ligar a Cloudflare">
              {publicada
                ? "Cole um token só de leitura da conta da Aceleriq no segredo CLOUDFLARE_API_TOKEN da função casa-dominios. Sem ele, a conferência de vencimento, DNS e sites funciona igual; só a lista de zonas e sites da Cloudflare não é lida."
                : "A função casa-dominios ainda não foi publicada. Até lá a tela mostra o que está no banco e o que foi cadastrado à mão."}
            </HelpTooltip>
          </div>
        )}
        <div className="mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-center">
          <SeletorCompacto rotulo="Mostrar" modo="lista" opcoes={filtros} valor={filtroValido} onEscolher={(v) => setFiltro(v as Filtro)} />
          <select value={cliente} onChange={(e) => setCliente(e.target.value)} className={juntar(campo, "h-9 w-full rounded-full sm:w-auto sm:max-w-[14rem]")} aria-label="Cliente" data-filtro-cliente="">
            <option value="todos">Todos os clientes</option>
            <option value="sem">Sem cliente</option>
            {dados.clientes.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
          </select>
          <SearchField value={busca} onChange={setBusca} placeholder={parte === "dominios" ? "Domínio ou cliente" : "Site ou cliente"} label="Buscar" className="col-span-2 sm:col-span-1 sm:ml-auto sm:w-full sm:max-w-[280px]" />
        </div>

        {visiveis === 0 ? (
          <EstadoVazio
            icone={parte === "dominios" ? <Globe className="h-5 w-5" aria-hidden="true" /> : <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />}
            titulo={total && comFiltro ? "Nada neste filtro" : verArquivados ? "Nada arquivado" : parte === "dominios" ? "Nenhum domínio ainda" : "Nenhum site ainda"}
            descricao={total ? undefined : ligado ? "Leia a Cloudflare ou cadastre à mão." : "Cadastre à mão ou ligue a Cloudflare."}
            acao={total && comFiltro ? <button type="button" className={juntar(botao.secundario, "h-8")} onClick={limpar}>Limpar filtros</button> : !verArquivados ? <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setNovo(true)}>Cadastrar</button> : undefined}
          />
        ) : parte === "dominios" ? (
          <List label="Domínios">
            {dominios.map(({ d, avisos }) => <LinhaDoDominio key={d.id || d.dominio} d={d} avisos={avisos} hoje={hoje} onAbrir={() => setAberto(d.id || `email:${d.dominio}`)} />)}
          </List>
        ) : (
          <List label="Sites">
            {sites.map(({ s, avisos }) => <LinhaDoSite key={s.id} s={s} avisos={avisos} hoje={hoje} onAbrir={() => setAberto(s.id)} />)}
          </List>
        )}
      </Card>

      {dominioAberto && <FichaDoDominio d={dominioAberto} central={dados} hoje={hoje} onFechar={() => setAberto(null)} aoSalvar={recarregar} />}
      {siteAberto && <FichaDoSite s={siteAberto} central={dados} hoje={hoje} onFechar={() => setAberto(null)} aoSalvar={recarregar} />}
      {novo && <Cadastro parte={parte} central={dados} onFechar={() => setNovo(false)} aoSalvar={recarregar} />}
    </div>
  );
}

const Icone = ({ tom, children }: { tom: Tone; children: ReactNode }) => (
  <span aria-hidden="true" className={juntar("inline-flex h-10 w-10 items-center justify-center rounded-full", tom === "danger" ? "bg-danger-soft text-destructive" : tom === "warning" ? "bg-warning-soft text-warning" : "bg-muted text-foreground")}>{children}</span>
);

function LinhaDoDominio({ d, avisos, hoje, onAbrir }: { d: DominioDaCasa; avisos: Aviso[]; hoje: string; onAbrir: () => void }) {
  const saude = saudeDosAvisos(avisos);
  const dns = ondeEstaODns(d.nameservers);
  const faltas = faltasNoDns(d);
  const detalhe = [
    d.cliente_nome || "sem cliente",
    d.na_cloudflare_da_casa ? "Cloudflare da casa" : dns ? `DNS em ${dns}` : "",
    temEmail(d) ? (faltas === null ? "e-mail sem conferência" : faltas ? `e-mail com ${faltas} ${faltas === 1 ? "falta" : "faltas"}` : "e-mail certo") : "",
  ].filter(Boolean).join(" · ");
  return (
    <ListRow
      leading={<Icone tom={TOM_DA_SAUDE[saude]}><Globe className="h-4 w-4" /></Icone>}
      title={d.dominio}
      subtitle={avisos[0] ? `${avisos[0].texto}${avisos.length > 1 ? ` (+${avisos.length - 1})` : ""}` : detalhe}
      status={<StatusPill tone={TOM_DA_SAUDE[saude]}>{ROTULO_DA_SAUDE[saude]}</StatusPill>}
      value={d.vence_em ? quando(d.vence_em, hoje) : "sem data"}
      valueHint={d.vence_em ? "vence" : d.registrador || undefined}
      onClick={onAbrir}
    />
  );
}

function LinhaDoSite({ s, avisos, hoje, onAbrir }: { s: SiteDaCasa; avisos: Aviso[]; hoje: string; onAbrir: () => void }) {
  const saude = saudeDosAvisos(avisos);
  const detalhe = [
    s.cliente_nome || "sem cliente",
    s.hospedagem || ROTULO_DA_ORIGEM[s.origem],
    s.ssl_ok === true ? "SSL certo" : s.ssl_ok === false ? "SSL com problema" : "",
    s.ultima_publicacao ? `publicado ${quando(s.ultima_publicacao.slice(0, 10), hoje)}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <ListRow
      leading={<Icone tom={TOM_DA_SAUDE[saude]}><MonitorSmartphone className="h-4 w-4" /></Icone>}
      title={s.endereco || s.nome}
      subtitle={avisos[0] ? `${avisos[0].texto}${avisos.length > 1 ? ` (+${avisos.length - 1})` : ""}` : detalhe}
      status={<StatusPill tone={TOM_DA_SAUDE[saude]}>{ROTULO_DA_SAUDE[saude]}</StatusPill>}
      value={s.conferido_em ? (s.http_status ? String(s.http_status) : "não abriu") : "..."}
      valueHint={s.conferido_em && s.http_status && s.resposta_ms !== null ? `${s.resposta_ms} ms` : s.conferido_em ? undefined : "sem conferência"}
      onClick={onAbrir}
    />
  );
}

function CamposDeDinheiro({ f, setF, custoPadrao }: { f: Record<string, string>; setF: (f: Record<string, string>) => void; custoPadrao: Periodo }) {
  const seletor = (chave: string) => (
    <select value={f[chave] || custoPadrao} onChange={(e) => setF({ ...f, [chave]: e.target.value })} className={juntar(campo, "ml-2 w-28 shrink-0")}>
      <option value="mensal">por mês</option>
      <option value="anual">por ano</option>
    </select>
  );
  return (
    <>
      <CampoDeFormulario rotulo="Custo para a casa" apoio="Registro, hospedagem ou plano">
        <span className="flex min-w-0 items-center">
          <input value={f.custo_valor} onChange={(e) => setF({ ...f, custo_valor: e.target.value })} className={juntar(campo, "min-w-0 flex-1")} inputMode="decimal" placeholder="0,00" data-campo="custo" />
          {seletor("custo_periodo")}
        </span>
      </CampoDeFormulario>
      <CampoDeFormulario rotulo="Preço cobrado do cliente">
        <span className="flex min-w-0 items-center">
          <input value={f.preco_valor} onChange={(e) => setF({ ...f, preco_valor: e.target.value })} className={juntar(campo, "min-w-0 flex-1")} inputMode="decimal" placeholder="0,00" data-campo="preco" />
          {seletor("preco_periodo")}
        </span>
      </CampoDeFormulario>
    </>
  );
}

const paraCampo = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

/** Receita, custo e sobra por mês, em pílulas (só quando há valor). */
function Margem({ f }: { f: Record<string, string> }) {
  const n = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
  const receita = porMes(n(f.preco_valor), f.preco_periodo as Periodo);
  const custo = porMes(n(f.custo_valor), f.custo_periodo as Periodo);
  if (!receita && !custo) return null;
  const sobra = receita - custo;
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-1.5 [&>*]:mr-1.5" data-margem="">
      <span className={juntar(texto.rotulo, "mr-1")}>Por mês</span>
      <Chip tone="neutral">recebe {reais(receita)}</Chip>
      <Chip tone="neutral">custa {reais(custo)}</Chip>
      <Chip tone={sobra > 0 ? "success" : sobra < 0 ? "danger" : "neutral"}>sobra {reais(sobra)}</Chip>
    </div>
  );
}

function FichaDoDominio({ d, central, hoje, onFechar, aoSalvar }: { d: DominioDaCasa; central: Central; hoje: string; onFechar: () => void; aoSalvar: () => Promise<unknown> }) {
  const [f, setF] = useState<Record<string, string>>({
    cliente: d.cliente || "",
    registrador: d.registrador || "",
    titular: d.titular || "",
    vence_em: d.vencimento_fonte === "manual" && d.vence_em ? d.vence_em : "",
    custo_valor: paraCampo(d.custo_valor),
    custo_periodo: d.custo_periodo,
    preco_valor: paraCampo(d.preco_valor),
    preco_periodo: d.preco_periodo,
    observacao: d.observacao || "",
  });
  const [salvando, setSalvando] = useState(false);
  const avisos = avisosDoDominio(d, hoje);
  const saude = saudeDosAvisos(avisos);
  const sitesDoDominio = central.sites.filter((s) => s.dominio_id && s.dominio_id === d.id);
  const salvar = async () => {
    setSalvando(true);
    try {
      const dados: Record<string, string> = { ...f };
      if (d.vencimento_fonte === "rdap" && !f.vence_em) delete dados.vence_em;
      if (!d.id) {
        dados.dominio = d.dominio;
        if (d.email) dados.email_dominio_id = d.email.dominio_id;
      }
      await salvarDominio(d.id, dados);
      toast.success("Salvo.");
      await aoSalvar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };
  const tirar = async () => {
    if (!d.id) return;
    try {
      await arquivar("dominio", d.id, !d.arquivado);
      toast.success(d.arquivado ? "Voltou para a central." : "Arquivado.");
      await aoSalvar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };
  const dnsItens = d.dns_email && d.dns_email.itens ? d.dns_email.itens : [];
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      icone={<Globe className="h-4 w-4" />}
      titulo={d.dominio}
      descricao={`${d.cliente_nome || "Sem cliente"} · ${ROTULO_DA_ORIGEM[d.origem] || d.origem}`}
      acoes={
        <>
          <StatusPill tone={TOM_DA_SAUDE[saude]}>{ROTULO_DA_SAUDE[saude]}</StatusPill>
          {d.id && <OverflowMenu label="Mais ações do domínio" items={[{ label: d.arquivado ? "Desarquivar" : "Arquivar", icon: <Archive className="h-4 w-4" />, onSelect: () => void tirar() }]} />}
        </>
      }
      rodape={
        <>
          {d.email && <Link to="/produto/email/entradas" className={juntar(botao.secundario, "mr-auto h-9")}>Abrir o e-mail</Link>}
          <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando} data-salvar-dominio="">{salvando ? "Salvando..." : "Salvar"}</button>
        </>
      }
    >
      <div className="min-w-0 space-y-6" data-ficha-do-dominio="">
        <ListaDeAvisos avisos={avisos} />
        <FichaDeDados
          itens={[
            ["Registrador", d.registrador || "não lido"],
            ["Titular", d.titular || ""],
            ["Vencimento", d.vence_em ? `${diaLegivel(d.vence_em, true)} (${quando(d.vence_em, hoje)})${d.vencimento_fonte === "rdap" ? " · RDAP" : " · anotado"}` : "não lido"],
            ["DNS", d.na_cloudflare_da_casa ? `Cloudflare da casa${d.cloudflare_status ? ` (${d.cloudflare_status === "active" ? "ativa" : d.cloudflare_status})` : ""}` : ondeEstaODns(d.nameservers) || ""],
            ["Nameservers", d.nameservers.join(", ") || "não lidos"],
            ["E-mail", d.email ? `${ROTULO_DO_PROVEDOR[d.email.provedor as ProvedorDeEmail] || d.email.provedor} · ${ROTULO_DO_ESTADO_DO_DOMINIO[d.email.estado as EstadoDoDominio] || d.email.estado}` : temEmail(d) ? "MX de outro provedor" : "sem e-mail"],
            ["Sites", sitesDoDominio.map((s) => s.endereco || s.nome).join(", ")],
          ]}
        />
        {dnsItens.length > 0 && (
          <div className="flex min-w-0 flex-wrap [&>*]:mb-1.5 [&>*]:mr-1.5" data-dns-do-email="">
            {dnsItens.map((i) => {
              const s = i.estado || (i.situacao === "ok" ? "certo" : i.situacao === "alerta" ? "atencao" : "falta");
              return <Chip key={i.chave} dot tone={s === "certo" ? "success" : s === "atencao" ? "warning" : "danger"}>{i.chave.toUpperCase()} {s === "certo" ? "certo" : s === "atencao" ? "atenção" : "falta"}</Chip>;
            })}
          </div>
        )}
        <section className="min-w-0 border-t border-border/60 pt-5">
          <TituloDoBloco aoLado={<HelpTooltip label="Sobre os dados da casa">Quem é o cliente, quanto custa e quanto a casa cobra. A leitura da Cloudflare e do RDAP nunca muda estes campos. O vencimento anotado vale até o RDAP responder.</HelpTooltip>}>Da casa</TituloDoBloco>
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Cliente" largo>
              <select value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} className={campo} data-campo="cliente">
                <option value="">Sem cliente</option>
                {central.clientes.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Registrador">
              <input value={f.registrador} onChange={(e) => setF({ ...f, registrador: e.target.value })} className={campo} placeholder="Registro.br" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Vence em" apoio={d.vencimento_fonte === "rdap" ? "Lido no RDAP" : "Anote se o RDAP não ler"}>
              <input type="date" value={f.vence_em} onChange={(e) => setF({ ...f, vence_em: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CamposDeDinheiro f={f} setF={setF} custoPadrao="anual" />
            <CampoDeFormulario rotulo="Observação" largo>
              <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={juntar(campo, "min-h-[4.5rem]")} placeholder="Titular no Registro.br, contato técnico, combinados" />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <Margem f={f} />
        </section>
      </div>
    </JanelaCentral>
  );
}

function FichaDoSite({ s, central, hoje, onFechar, aoSalvar }: { s: SiteDaCasa; central: Central; hoje: string; onFechar: () => void; aoSalvar: () => Promise<unknown> }) {
  const [f, setF] = useState<Record<string, string>>({
    nome: s.nome,
    endereco: s.endereco || "",
    cliente: s.cliente_herdado ? "" : s.cliente || "",
    dominio_id: s.dominio_id || "",
    hospedagem: s.hospedagem || "",
    custo_valor: paraCampo(s.custo_valor),
    custo_periodo: s.custo_periodo,
    preco_valor: paraCampo(s.preco_valor),
    preco_periodo: s.preco_periodo,
    observacao: s.observacao || "",
  });
  const [salvando, setSalvando] = useState(false);
  const avisos = avisosDoSite(s);
  const saude = saudeDosAvisos(avisos);
  const daCloudflare = s.origem === "cloudflare";
  const salvar = async () => {
    setSalvando(true);
    try {
      const dados: Record<string, string> = { ...f };
      if (daCloudflare) delete dados.endereco;
      await salvarSite(s.id, dados);
      toast.success("Salvo.");
      await aoSalvar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };
  const tirar = async () => {
    try {
      await arquivar("site", s.id, !s.arquivado);
      toast.success(s.arquivado ? "Voltou para a central." : "Arquivado.");
      await aoSalvar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      icone={<MonitorSmartphone className="h-4 w-4" />}
      titulo={s.endereco || s.nome}
      descricao={`${s.cliente_nome || "Sem cliente"} · ${s.hospedagem || ROTULO_DA_ORIGEM[s.origem]}`}
      acoes={
        <>
          <StatusPill tone={TOM_DA_SAUDE[saude]}>{ROTULO_DA_SAUDE[saude]}</StatusPill>
          <OverflowMenu
            label="Mais ações do site"
            items={[
              s.endereco ? { label: "Abrir o site", icon: <ExternalLink className="h-4 w-4" />, onSelect: () => window.open(`https://${s.endereco}`, "_blank", "noopener") } : null,
              { label: s.arquivado ? "Desarquivar" : "Arquivar", icon: <Archive className="h-4 w-4" />, onSelect: () => void tirar(), separatorBefore: !!s.endereco },
            ]}
          />
        </>
      }
      rodape={<button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando} data-salvar-site="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <div className="min-w-0 space-y-6" data-ficha-do-site="">
        <ListaDeAvisos avisos={avisos} />
        <FichaDeDados
          itens={[
            ["Resposta", s.conferido_em ? (s.http_status ? `${s.http_status}${s.resposta_ms !== null ? ` em ${s.resposta_ms} ms` : ""}` : s.erro || "não abriu") : "ainda não conferido"],
            ["SSL", s.ssl_ok === true ? "certo" : s.ssl_ok === false ? "com problema" : ""],
            ["Na Cloudflare", s.cf_tipo ? `${s.cf_tipo === "pages" ? "Pages" : "Worker"} ${s.cf_nome}` : "não"],
            ["Domínios próprios", s.dominios_personalizados.join(", ")],
            ["Última publicação", s.ultima_publicacao ? `${diaLegivel(s.ultima_publicacao, true)} (${quando(s.ultima_publicacao.slice(0, 10), hoje)})` : ""],
            ["Conferido", s.conferido_em ? quando(s.conferido_em.slice(0, 10), hoje) : ""],
            ["Cliente pelo domínio", s.cliente_herdado ? s.cliente_nome || "" : ""],
          ]}
        />
        <section className="min-w-0 border-t border-border/60 pt-5">
          <TituloDoBloco aoLado={<HelpTooltip label="Sobre os dados da casa">Quem é o cliente, o domínio ligado, quanto custa e quanto a casa cobra. Sem cliente escolhido, o site herda o cliente do domínio. A leitura da Cloudflare nunca muda estes campos.</HelpTooltip>}>Da casa</TituloDoBloco>
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Nome">
              <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Endereço" apoio={daCloudflare ? "Lido da Cloudflare" : "Sem https://"}>
              <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} className={campo} disabled={daCloudflare} placeholder="www.empresa.com.br" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Cliente">
              <select value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} className={campo} data-campo="cliente">
                <option value="">{s.cliente_herdado ? `Pelo domínio (${s.cliente_nome})` : "Sem cliente"}</option>
                {central.clientes.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Domínio ligado">
              <select value={f.dominio_id} onChange={(e) => setF({ ...f, dominio_id: e.target.value })} className={campo}>
                <option value="">Nenhum</option>
                {central.dominios.filter((d) => d.id && !d.arquivado).map((d) => <option key={d.id as string} value={d.id as string}>{d.dominio}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Hospedagem">
              <input value={f.hospedagem} onChange={(e) => setF({ ...f, hospedagem: e.target.value })} className={campo} placeholder="Cloudflare Workers" />
            </CampoDeFormulario>
            <CamposDeDinheiro f={f} setF={setF} custoPadrao="mensal" />
            <CampoDeFormulario rotulo="Observação" largo>
              <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={juntar(campo, "min-h-[4.5rem]")} placeholder="Repositório, o que está incluso no cuidado do site" />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <Margem f={f} />
        </section>
      </div>
    </JanelaCentral>
  );
}

function Cadastro({ parte, central, onFechar, aoSalvar }: { parte: Parte; central: Central; onFechar: () => void; aoSalvar: () => Promise<unknown> }) {
  const [f, setF] = useState<Record<string, string>>({ dominio: "", nome: "", endereco: "", cliente: "", registrador: "", hospedagem: "", custo_valor: "", custo_periodo: parte === "dominios" ? "anual" : "mensal", preco_valor: "", preco_periodo: "mensal" });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      if (parte === "dominios") {
        await salvarDominio(null, { dominio: f.dominio, cliente: f.cliente, registrador: f.registrador, custo_valor: f.custo_valor, custo_periodo: f.custo_periodo as Periodo, preco_valor: f.preco_valor, preco_periodo: f.preco_periodo as Periodo });
      } else {
        await salvarSite(null, { nome: f.nome, endereco: f.endereco, cliente: f.cliente, hospedagem: f.hospedagem, custo_valor: f.custo_valor, custo_periodo: f.custo_periodo as Periodo, preco_valor: f.preco_valor, preco_periodo: f.preco_periodo as Periodo });
      }
      toast.success("Cadastrado. Use Conferir agora para ler o vencimento e a resposta.");
      await aoSalvar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cadastrar."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo={parte === "dominios" ? "Cadastrar domínio" : "Cadastrar site"}
      ajuda={parte === "dominios" ? "Para o domínio que não está na Cloudflare da casa." : "Para o site hospedado fora da Cloudflare da casa."}
      rodape={<button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando} data-confirmar-cadastro="">{salvando ? "Salvando..." : "Cadastrar"}</button>}
    >
      <GrupoDeCampos>
        {parte === "dominios" ? (
          <>
            <CampoDeFormulario rotulo="Domínio" largo>
              <input value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })} className={campo} placeholder="empresa.com.br" autoFocus data-campo="dominio" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Registrador">
              <input value={f.registrador} onChange={(e) => setF({ ...f, registrador: e.target.value })} className={campo} placeholder="Registro.br, Hostinger..." />
            </CampoDeFormulario>
          </>
        ) : (
          <>
            <CampoDeFormulario rotulo="Endereço">
              <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} className={campo} placeholder="www.empresa.com.br" autoFocus data-campo="endereco" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Nome" apoio="Opcional">
              <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Hospedagem">
              <input value={f.hospedagem} onChange={(e) => setF({ ...f, hospedagem: e.target.value })} className={campo} placeholder="Hostinger, Vercel..." />
            </CampoDeFormulario>
          </>
        )}
        <CampoDeFormulario rotulo="Cliente">
          <select value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} className={campo}>
            <option value="">Sem cliente</option>
            {central.clientes.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
        <CamposDeDinheiro f={f} setF={setF} custoPadrao={parte === "dominios" ? "anual" : "mensal"} />
      </GrupoDeCampos>
      <Margem f={f} />
    </JanelaCentral>
  );
}
