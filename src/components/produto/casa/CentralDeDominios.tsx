import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cloud, Plus, RefreshCw } from "lucide-react";
import { diaLegivel, fraseDoErro, reais } from "@/lib/produto/api";
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
  type Gravidade,
  type Periodo,
  type Saude,
  type SiteDaCasa,
} from "@/lib/produto/dominios-sites";
import { quando } from "./CentralDeEmail";
import {
  BotaoComIcone,
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";

export const chaveDosDominios = ["produto", "casa", "dominios"] as const;

const COR_DA_SAUDE: Record<Saude, string> = { ok: "bg-accent-soft text-primary", atencao: "bg-warning-soft text-warning", critico: "bg-destructive/10 text-destructive" };
const COR_DO_AVISO: Record<Gravidade, string> = { critico: "bg-destructive", atencao: "bg-warning", info: "bg-muted-foreground" };
const ROTULO_DA_ORIGEM: Record<string, string> = { manual: "Cadastro manual", cloudflare: "Cloudflare", email: "E-mail" };
const ordemDaSaude: Record<Saude, number> = { critico: 0, atencao: 1, ok: 2 };

const hojeEmSaoPaulo = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const porPeriodo = (v: number | null, p: Periodo) => (v === null ? "" : `${reais(v)}${p === "anual" ? " por ano" : " por mês"}`);

type Parte = "dominios" | "sites";

/**
 * Central de domínios e sites da casa: os domínios dos clientes (registrador, DNS, vencimento, e-mail)
 * e os sites publicados (resposta, SSL, publicação), com quanto custam e quanto a casa cobra.
 * A Cloudflare é lida só por GET pela função casa-dominios; sem o token, a tela usa o que está no banco.
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

  const dados: Central = central.data || { dominios: [], sites: [], clientes: [], leitura: { dominios_em: null, cloudflare_em: null, sites_em: null } };
  const resumo = useMemo(() => resumoDaCentralDeDominios(dados, hoje), [dados, hoje]);

  if (central.isLoading) return <Carregando linhas={6} rotulo="Carregando a central" />;
  if (central.isError) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void central.refetch()}>Tentar de novo</button>} />;

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

  const filtros: Array<{ valor: Filtro; rotulo: string }> = parte === "dominios"
    ? [{ valor: "todos", rotulo: "Todos" }, { valor: "problema", rotulo: "Com aviso" }, { valor: "vence30", rotulo: `Vence em 30 dias ${resumo.vencendo}` }, { valor: "dns", rotulo: `DNS com falta ${resumo.dnsComFalta}` }, { valor: "sem_cliente", rotulo: "Sem cliente" }]
    : [{ valor: "todos", rotulo: "Todos" }, { valor: "problema", rotulo: "Com aviso" }, { valor: "fora", rotulo: `Fora do ar ${resumo.foraDoAr}` }, { valor: "sem_cliente", rotulo: "Sem cliente" }];
  const filtroValido = filtros.some((f) => f.valor === filtro) ? filtro : "todos";
  const ligado = leitura.data ? leitura.data.cloudflare : false;
  const ultima = parte === "dominios" ? dados.leitura.dominios_em : dados.leitura.sites_em;
  const total = parte === "dominios" ? dados.dominios.filter((d) => !d.arquivado).length : dados.sites.filter((s) => !s.arquivado).length;
  const visiveis = parte === "dominios" ? dominios.length : sites.length;
  const dominioAberto = parte === "dominios" ? dados.dominios.filter((d) => (d.id || `email:${d.dominio}`) === aberto)[0] || null : null;
  const siteAberto = parte === "sites" ? dados.sites.filter((s) => s.id === aberto)[0] || null : null;

  return (
    <div className="min-w-0 space-y-6" data-central-de-dominios={parte}>
      <FaixaDeNumeros
        rotulo="Resumo dos domínios e sites"
        colunas={4}
        itens={[
          { rotulo: "Domínios", valor: resumo.dominios, apoio: `${resumo.naCasa} na Cloudflare da casa` },
          { rotulo: "Sites", valor: resumo.sites, apoio: resumo.foraDoAr ? `${resumo.foraDoAr} fora do ar` : "todos no ar", ponto: resumo.foraDoAr ? "perigo" : "neutro" },
          { rotulo: "Precisam de você", valor: resumo.precisam, apoio: `${resumo.vencendo} vencem em 30 dias`, ponto: resumo.precisam ? "alerta" : "verde", aoClicar: () => setFiltro("problema") },
          { rotulo: "Receita por mês", valor: reais(resumo.receita), apoio: `custo ${reais(resumo.custo)} · margem ${reais(resumo.margem)}` },
        ]}
      />

      {!ligado && !leitura.isLoading && (
        <div className="flex min-w-0 flex-wrap items-start rounded-lg border border-border bg-muted/40 p-3" data-ligar-cloudflare="">
          <Cloud className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className={juntar(texto.auxiliar, "min-w-0 flex-1")}>
            <span className="font-medium text-foreground">Ligar Cloudflare. </span>
            {leitura.data && !leitura.data.publicada
              ? "A função casa-dominios ainda não foi publicada. Até lá a tela mostra o que está no banco e o que foi cadastrado à mão."
              : "Cole um token só de leitura da conta da Aceleriq no segredo CLOUDFLARE_API_TOKEN da função casa-dominios. Sem ele, a conferência de vencimento, DNS e sites funciona igual; só a lista de zonas e sites da Cloudflare não é lida."}
          </p>
        </div>
      )}

      <Secao
        titulo={parte === "dominios" ? "Domínios" : "Sites"}
        descricao={`${visiveis} de ${total}${ultima ? ` · conferido ${quando(ultima.slice(0, 10), hoje)}` : " · nunca conferido"}`}
        ajuda={parte === "dominios"
          ? "Todos os domínios dos clientes: o cadastrado à mão, o que está na Cloudflare da casa e o do e-mail. Conferir agora lê o vencimento no RDAP (Registro.br para .br) e o DNS do e-mail (MX, SPF, DKIM, DMARC). Clique no domínio para ligar a um cliente e anotar custo e preço."
          : "Os sites publicados na Cloudflare da casa (Workers e Pages) e os cadastrados à mão. Conferir agora abre cada endereço por HTTPS: código da resposta, tempo e certificado. Clique no site para ligar a um cliente e anotar custo e preço."}
        acao={
          <span className="-m-1 flex items-center">
            <button type="button" className={juntar(botao.icone, "m-1")} onClick={() => cloudflare.mutate()} disabled={!ligado || cloudflare.isPending} aria-label="Ler a Cloudflare" title={ligado ? "Ler zonas e sites da Cloudflare" : "Ligue a Cloudflare para ler"} data-ler-cloudflare="">
              <Cloud className={juntar("h-4 w-4", cloudflare.isPending && "animate-pulse")} aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.icone, "m-1")} onClick={() => conferir.mutate()} disabled={conferir.isPending || !(leitura.data && leitura.data.publicada)} aria-label="Conferir agora" title="Conferir agora" data-conferir-agora="">
              <RefreshCw className={juntar("h-4 w-4", conferir.isPending && "animate-spin")} aria-hidden="true" />
            </button>
            <BotaoComIcone className="m-1 h-8" icone={<Plus className="h-4 w-4" aria-hidden="true" />} rotulo="Cadastrar" onClick={() => setNovo(true)} data-cadastrar="" />
          </span>
        }
      >
        <div className="-m-1 mb-2 flex min-w-0 flex-wrap items-center">
          <span className="m-1 min-w-0">
            <SeletorCompacto rotulo="Saúde" opcoes={filtros} valor={filtroValido} onEscolher={(v) => setFiltro(v as Filtro)} listaQuandoNaoCabe />
          </span>
          <select value={cliente} onChange={(e) => setCliente(e.target.value)} className={juntar(campo, "m-1 h-8 w-auto max-w-[14rem]")} aria-label="Cliente" data-filtro-cliente="">
            <option value="todos">Todos os clientes</option>
            <option value="sem">Sem cliente</option>
            {dados.clientes.map((c) => <option key={c.valor} value={c.valor}>{c.nome}</option>)}
          </select>
          <span className="m-1 ml-auto min-w-0">
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder={parte === "dominios" ? "Domínio ou cliente" : "Site ou cliente"} rotulo="Buscar" />
          </span>
        </div>

        {visiveis === 0 ? (
          <EstadoVazio compacto titulo={total ? "Nada neste filtro." : parte === "dominios" ? "Nenhum domínio ainda." : "Nenhum site ainda."} descricao={total ? undefined : ligado ? "Leia a Cloudflare ou cadastre à mão." : "Cadastre à mão ou ligue a Cloudflare."} />
        ) : parte === "dominios" ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-de-dominios="">
            {dominios.map(({ d, avisos }) => <LinhaDoDominio key={d.id || d.dominio} d={d} avisos={avisos} hoje={hoje} onAbrir={() => setAberto(d.id || `email:${d.dominio}`)} />)}
          </ul>
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-de-sites="">
            {sites.map(({ s, avisos }) => <LinhaDoSite key={s.id} s={s} avisos={avisos} hoje={hoje} onAbrir={() => setAberto(s.id)} />)}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <button type="button" className={juntar(texto.auxiliar, "underline-offset-2 hover:underline")} onClick={() => setVerArquivados(!verArquivados)}>{verArquivados ? "Voltar aos ativos" : "Ver arquivados"}</button>
        </div>
      </Secao>

      {dominioAberto && <FichaDoDominio d={dominioAberto} central={dados} hoje={hoje} onFechar={() => setAberto(null)} aoSalvar={recarregar} />}
      {siteAberto && <FichaDoSite s={siteAberto} central={dados} hoje={hoje} onFechar={() => setAberto(null)} aoSalvar={recarregar} />}
      {novo && <Cadastro parte={parte} central={dados} onFechar={() => setNovo(false)} aoSalvar={recarregar} />}
    </div>
  );
}

function PrimeiroAviso({ avisos }: { avisos: Aviso[] }) {
  if (!avisos[0]) return null;
  return (
    <span className={juntar(texto.auxiliar, "mt-0.5 flex min-w-0 items-center")}>
      <i className={juntar("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", COR_DO_AVISO[avisos[0].gravidade])} aria-hidden="true" />
      <span className="truncate">{avisos[0].texto}{avisos.length > 1 ? ` (+${avisos.length - 1})` : ""}</span>
    </span>
  );
}

function LinhaDoDominio({ d, avisos, hoje, onAbrir }: { d: DominioDaCasa; avisos: Aviso[]; hoje: string; onAbrir: () => void }) {
  const saude = saudeDosAvisos(avisos);
  const dns = ondeEstaODns(d.nameservers);
  const faltas = faltasNoDns(d);
  return (
    <li>
      <button type="button" className={juntar(lista.linha, "w-full flex-wrap items-start text-left")} onClick={onAbrir} data-dominio={saude}>
        <span className="min-w-0 flex-1 basis-full sm:basis-0">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>
            {d.dominio}
            <span className="font-normal text-muted-foreground"> · {d.cliente_nome || "sem cliente"}</span>
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {[
              d.registrador || "registrador não lido",
              dns ? `DNS ${d.na_cloudflare_da_casa ? "na Cloudflare da casa" : `em ${dns}`}` : "",
              d.vence_em ? `vence ${quando(d.vence_em, hoje)}` : "",
              temEmail(d) ? (faltas === null ? "e-mail sem conferência" : faltas ? `e-mail com ${faltas} ${faltas === 1 ? "falta" : "faltas"}` : "e-mail certo") : "",
              d.preco_valor !== null ? porPeriodo(d.preco_valor, d.preco_periodo) : "",
            ].filter(Boolean).join(" · ")}
          </span>
          <PrimeiroAviso avisos={avisos} />
        </span>
        <span className={juntar(etiqueta, "mt-1.5 sm:ml-2 sm:mt-0", COR_DA_SAUDE[saude])}>{ROTULO_DA_SAUDE[saude]}</span>
      </button>
    </li>
  );
}

function LinhaDoSite({ s, avisos, hoje, onAbrir }: { s: SiteDaCasa; avisos: Aviso[]; hoje: string; onAbrir: () => void }) {
  const saude = saudeDosAvisos(avisos);
  return (
    <li>
      <button type="button" className={juntar(lista.linha, "w-full flex-wrap items-start text-left")} onClick={onAbrir} data-site={saude}>
        <span className="min-w-0 flex-1 basis-full sm:basis-0">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>
            {s.endereco || s.nome}
            <span className="font-normal text-muted-foreground"> · {s.cliente_nome || "sem cliente"}</span>
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {[
              s.hospedagem || ROTULO_DA_ORIGEM[s.origem],
              s.conferido_em ? (s.http_status ? `respondeu ${s.http_status}${s.resposta_ms !== null ? ` em ${s.resposta_ms} ms` : ""}` : "não abriu") : "",
              s.ssl_ok === true ? "SSL certo" : s.ssl_ok === false ? "SSL com problema" : "",
              s.ultima_publicacao ? `publicado ${quando(s.ultima_publicacao.slice(0, 10), hoje)}` : "",
              s.preco_valor !== null ? porPeriodo(s.preco_valor, s.preco_periodo) : "",
            ].filter(Boolean).join(" · ")}
          </span>
          <PrimeiroAviso avisos={avisos} />
        </span>
        <span className={juntar(etiqueta, "mt-1.5 sm:ml-2 sm:mt-0", COR_DA_SAUDE[saude])}>{ROTULO_DA_SAUDE[saude]}</span>
      </button>
    </li>
  );
}

function ListaDeAvisos({ avisos }: { avisos: Aviso[] }) {
  if (!avisos.length) return <p className={texto.corpo}>Tudo em dia.</p>;
  return (
    <ul className="space-y-1.5" data-avisos="">
      {avisos.map((a) => (
        <li key={a.texto} className="flex min-w-0 items-start">
          <i className={juntar("mr-2 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", COR_DO_AVISO[a.gravidade])} aria-hidden="true" />
          <span className={juntar(texto.corpo, "min-w-0")}>{a.texto}</span>
        </li>
      ))}
    </ul>
  );
}

function Linhas({ itens }: { itens: Array<[string, string]> }) {
  return (
    <ul className={juntar(lista.aberta, lista.divisoria)}>
      {itens.filter((i) => i[1]).map(([rotulo, valor]) => (
        <li key={rotulo} className={lista.linha}>
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>{rotulo}</span>
          <span className={juntar(texto.corpo, "ml-3 min-w-0 break-words text-right")}>{valor}</span>
        </li>
      ))}
    </ul>
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

function Margem({ f }: { f: Record<string, string> }) {
  const n = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);
  const receita = porMes(n(f.preco_valor), f.preco_periodo as Periodo);
  const custo = porMes(n(f.custo_valor), f.custo_periodo as Periodo);
  if (!receita && !custo) return null;
  return <p className={juntar(texto.auxiliar, "mt-2")} data-margem="">Por mês: recebe {reais(receita)}, custa {reais(custo)}, sobra {reais(receita - custo)}.</p>;
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
      titulo={d.dominio}
      descricao={`${ROTULO_DA_SAUDE[saudeDosAvisos(avisos)]} · ${ROTULO_DA_ORIGEM[d.origem] || d.origem}`}
      rodape={
        <>
          {d.id && <button type="button" className={juntar(botao.secundario, "mr-auto h-9")} onClick={() => void tirar()}>{d.arquivado ? "Desarquivar" : "Arquivar"}</button>}
          {d.email && <Link to="/produto/email/entradas" className={juntar(botao.secundario, "mr-2 h-9")}>Abrir o e-mail</Link>}
          <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando} data-salvar-dominio="">{salvando ? "Salvando..." : "Salvar"}</button>
        </>
      }
    >
      <div className="min-w-0 space-y-5" data-ficha-do-dominio="">
        <ListaDeAvisos avisos={avisos} />
        <Linhas
          itens={[
            ["Registrador", d.registrador || "não lido"],
            ["Titular", d.titular || ""],
            ["Nameservers", d.nameservers.join(", ") || "não lidos"],
            ["DNS", d.na_cloudflare_da_casa ? `Cloudflare da casa${d.cloudflare_status ? ` (${d.cloudflare_status === "active" ? "ativa" : d.cloudflare_status})` : ""}` : ondeEstaODns(d.nameservers) || ""],
            ["Vencimento", d.vence_em ? `${diaLegivel(d.vence_em, true)} (${quando(d.vence_em, hoje)})${d.vencimento_fonte === "rdap" ? " · lido no RDAP" : " · anotado"}` : "não lido"],
            ["E-mail", d.email ? `${d.email.provedor} · ${d.email.estado}` : temEmail(d) ? "MX de outro provedor" : "sem e-mail"],
            ["Sites", sitesDoDominio.map((s) => s.endereco || s.nome).join(", ")],
          ]}
        />
        {dnsItens.length > 0 && (
          <div className="-m-1 flex flex-wrap" data-dns-do-email="">
            {dnsItens.map((i) => {
              const s = i.estado || (i.situacao === "ok" ? "certo" : i.situacao === "alerta" ? "atencao" : "falta");
              return <span key={i.chave} className={juntar(etiqueta, "m-1", s === "certo" ? COR_DA_SAUDE.ok : s === "atencao" ? COR_DA_SAUDE.atencao : COR_DA_SAUDE.critico)}>{i.chave.toUpperCase()} {s === "certo" ? "certo" : s === "atencao" ? "atenção" : "falta"}</span>;
            })}
          </div>
        )}
        <Secao titulo="Da casa" ajuda="Quem é o cliente, quanto custa e quanto a casa cobra. A leitura da Cloudflare e do RDAP nunca muda estes campos. O vencimento anotado vale até o RDAP responder.">
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
        </Secao>
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
      titulo={s.endereco || s.nome}
      descricao={`${ROTULO_DA_SAUDE[saudeDosAvisos(avisos)]} · ${s.hospedagem || ROTULO_DA_ORIGEM[s.origem]}`}
      rodape={
        <>
          <button type="button" className={juntar(botao.secundario, "mr-auto h-9")} onClick={() => void tirar()}>{s.arquivado ? "Desarquivar" : "Arquivar"}</button>
          {s.endereco && <a href={`https://${s.endereco}`} target="_blank" rel="noreferrer" className={juntar(botao.secundario, "mr-2 h-9")}>Abrir o site</a>}
          <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando} data-salvar-site="">{salvando ? "Salvando..." : "Salvar"}</button>
        </>
      }
    >
      <div className="min-w-0 space-y-5" data-ficha-do-site="">
        <ListaDeAvisos avisos={avisos} />
        <Linhas
          itens={[
            ["Na Cloudflare", s.cf_tipo ? `${s.cf_tipo === "pages" ? "Pages" : "Worker"} ${s.cf_nome}` : "não"],
            ["Domínios próprios", s.dominios_personalizados.join(", ")],
            ["Resposta", s.conferido_em ? (s.http_status ? `${s.http_status}${s.resposta_ms !== null ? ` em ${s.resposta_ms} ms` : ""}` : s.erro || "não abriu") : "ainda não conferido"],
            ["SSL", s.ssl_ok === true ? "certo" : s.ssl_ok === false ? "com problema" : ""],
            ["Última publicação", s.ultima_publicacao ? `${diaLegivel(s.ultima_publicacao, true)} (${quando(s.ultima_publicacao.slice(0, 10), hoje)})` : ""],
            ["Conferido", s.conferido_em ? quando(s.conferido_em.slice(0, 10), hoje) : ""],
            ["Cliente pelo domínio", s.cliente_herdado ? s.cliente_nome || "" : ""],
          ]}
        />
        <Secao titulo="Da casa" ajuda="Quem é o cliente, o domínio ligado, quanto custa e quanto a casa cobra. Sem cliente escolhido, o site herda o cliente do domínio. A leitura da Cloudflare nunca muda estes campos.">
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
        </Secao>
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
      descricao={parte === "dominios" ? "Para o domínio que não está na Cloudflare da casa." : "Para o site hospedado fora da Cloudflare da casa."}
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
