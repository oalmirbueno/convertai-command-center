import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Globe, Inbox, ListChecks, Mail, Pencil, Plus, Server, Wallet } from "lucide-react";
import {
  carregarEmail,
  casa,
  diaLegivel,
  fraseDoErro,
  listarContasDaCasa,
  ROTULO_DO_ESTADO_DO_DOMINIO,
  ROTULO_DO_PROVEDOR,
  WEBMAIL_DO_PROVEDOR,
  type CaixaDeEmail,
  type DominioDeEmail,
  type EstadoDoDominio,
  type EtapaDaMigracao,
  type ProvedorDeEmail,
} from "@/lib/produto/api";
import { Avatar, Card, Chip, HelpTooltip, List, ListRow, OverflowMenu, ProgressBar, StatCard, StatGrid, StatusPill, type Tone } from "@/components/ds";
import {
  CampoDeFormulario,
  EstadoVazio,
  GrupoDeCampos,
  JanelaCentral,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  foco,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";
import ChecagemDoDominio from "../ChecagemDoDominio";
import { chaveDasContas } from "./ContasDaCasa";
import EntradasDeEmail, { chaveDasEntradas } from "./EntradasDeEmail";
import IntegracaoDoDominio from "./IntegracaoDoDominio";
import MigaduDoDominio from "./MigaduDoDominio";
import { ErroDaTela, EsqueletoDaTela, TituloDoBloco } from "./pecasDaCasa";
import { atribuirCaixa, esperaPagamento, listarPedidos, type DominioComIntegracao } from "@/lib/produto/email-pedidos";

const ESTADOS: EstadoDoDominio[] = ["levantamento", "preparando", "virada", "concluido", "pausado"];
const PROVEDORES: ProvedorDeEmail[] = ["migadu", "zoho", "google", "microsoft", "outro"];
const ESTADOS_DA_CAIXA: CaixaDeEmail["estado"][] = ["pedida", "criada", "copiando", "ativa", "removida"];
const ROTULO_DA_CAIXA: Record<CaixaDeEmail["estado"], string> = { pedida: "Pedida", criada: "Criada", copiando: "Copiando", ativa: "Ativa", removida: "Removida" };
const TOM_DA_CAIXA: Record<CaixaDeEmail["estado"], Tone> = { pedida: "warning", criada: "info", copiando: "info", ativa: "success", removida: "neutral" };
export const TOM_DO_DOMINIO: Record<EstadoDoDominio, Tone> = { levantamento: "neutral", preparando: "info", virada: "warning", concluido: "success", pausado: "neutral" };
const NOME_CURTO_DO_PROVEDOR: Record<ProvedorDeEmail, string> = { migadu: "Migadu", zoho: "Zoho", google: "Google", microsoft: "Microsoft", outro: "Outro" };

/** Os registros de DNS que o provedor pede, prontos para colar no painel de DNS. */
export function registrosParaPublicar(d: Pick<DominioDeEmail, "dominio" | "provedor" | "dkim_seletor">): string {
  const linhas: string[] = [];
  if (d.provedor === "migadu") {
    linhas.push(`${d.dominio}.  MX  10  aspmx1.migadu.com.`, `${d.dominio}.  MX  20  aspmx2.migadu.com.`, `${d.dominio}.  TXT  "v=spf1 include:spf.migadu.com -all"`);
    for (const k of ["key1", "key2", "key3"]) linhas.push(`${k}._domainkey.${d.dominio}.  CNAME  ${k}.${d.dominio}._domainkey.migadu.com.`);
    linhas.push(`_dmarc.${d.dominio}.  TXT  "v=DMARC1; p=quarantine;"`);
    return linhas.join("\n");
  }
  if (d.provedor === "zoho") {
    linhas.push(`${d.dominio}.  MX  10  mx.zoho.com.`, `${d.dominio}.  MX  20  mx2.zoho.com.`, `${d.dominio}.  MX  50  mx3.zoho.com.`, `${d.dominio}.  TXT  "v=spf1 include:zohomail.com ~all"`);
  } else if (d.provedor === "google") {
    linhas.push(`${d.dominio}.  MX  1  smtp.google.com.`, `${d.dominio}.  TXT  "v=spf1 include:_spf.google.com ~all"`);
  } else if (d.provedor === "microsoft") {
    linhas.push(`${d.dominio}.  MX  0  ${d.dominio.replace(/\./g, "-")}.mail.protection.outlook.com.`, `${d.dominio}.  TXT  "v=spf1 include:spf.protection.outlook.com ~all"`);
  } else {
    linhas.push(`${d.dominio}.  MX  10  (servidor do provedor)`, `${d.dominio}.  TXT  "v=spf1 (servidor do provedor) ~all"`);
  }
  const seletor = d.dkim_seletor || (d.provedor === "zoho" ? "zmail" : d.provedor === "google" ? "google" : "selector1");
  linhas.push(`${seletor}._domainkey.${d.dominio}.  TXT  (a chave que o provedor gera)`);
  linhas.push(`_dmarc.${d.dominio}.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${d.dominio}"`);
  return linhas.join("\n");
}

type Vista = "entradas" | "migracoes";
type Parte = "passos" | "caixas" | "dns";

/**
 * O e-mail profissional numa rota só, em duas partes bem separadas: as entradas (pedidos a pagar e
 * pagos) e a migração de cada empresa. O domínio nasce quando a entrada é marcada como paga, já com
 * o passo a passo; a migração abre na janela do centro, com as etapas, as caixas e o DNS.
 * 19/11/2026 (redesenho): números no topo, as duas partes num seletor e o passo a passo como etapas
 * visuais com progresso.
 */
export default function EmailDaCasa() {
  const qc = useQueryClient();
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa });
  const email = useQuery({ queryKey: ["produto", "casa", "email"], queryFn: () => carregarEmail() });
  // Mesma chave da lista de entradas abertas: os números do topo e a lista leem o mesmo dado.
  const abertas = useQuery({ queryKey: [...chaveDasEntradas, "abertos"], queryFn: () => listarPedidos("abertos") });
  const [vista, setVista] = useEstadoDaTela<Vista>("produto:email:vista", "entradas", { validar: (v) => v === "entradas" || v === "migracoes" });
  const [aberto, setAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<DominioDeEmail | null>(null);
  const reler = () => qc.invalidateQueries({ queryKey: ["produto", "casa", "email"] });

  if (email.isLoading || contas.isLoading) return <EsqueletoDaTela rotulo="Carregando o e-mail" />;
  if (email.isError || !email.data) return <ErroDaTela titulo="Não foi possível carregar o e-mail." aoTentar={() => void email.refetch()} />;

  const { dominios, caixas, etapas } = email.data;
  const nomeDaConta = (id: string) => ((contas.data || []).filter((c) => c.id === id)[0] || { nome: "Empresa" }).nome;
  const pedidas = caixas.filter((c) => c.estado === "pedida").length;
  const emAndamento = dominios.filter((d) => d.estado !== "concluido" && d.estado !== "pausado").length;
  const noAr = dominios.filter((d) => d.estado === "concluido").length;
  const esperando = (abertas.data || []).filter(esperaPagamento).length;
  const dominio = dominios.filter((d) => d.id === aberto)[0] || null;
  const abrirMigracao = (id: string) => {
    setVista("migracoes");
    setAberto(id);
  };

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6" data-email-da-casa="">
      <StatGrid label="Resumo das entradas e migrações">
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Esperando pagamento" value={abertas.data ? esperando : "..."} hint={abertas.data ? `${abertas.data.length} ${abertas.data.length === 1 ? "entrada aberta" : "entradas abertas"}` : undefined} onClick={() => setVista("entradas")} />
        <StatCard icon={<ListChecks className="h-4 w-4" />} label="Migrando" value={emAndamento} hint={`${dominios.length} ${dominios.length === 1 ? "domínio" : "domínios"}`} onClick={() => setVista("migracoes")} />
        <StatCard icon={<Inbox className="h-4 w-4" />} label="Caixas pedidas" value={pedidas} hint={pedidas ? "esperando criar" : "nenhuma esperando"} />
        <StatCard icon={<Globe className="h-4 w-4" />} label="No ar" value={noAr} hint="migrações concluídas" />
      </StatGrid>

      <SeletorCompacto
        rotulo="Parte"
        opcoes={[
          { valor: "entradas", rotulo: "Entradas", contador: abertas.data ? abertas.data.length : null },
          { valor: "migracoes", rotulo: "Migrações", contador: dominios.length },
        ]}
        valor={vista}
        onEscolher={(v) => setVista(v as Vista)}
      />

      {vista === "entradas" ? (
        <EntradasDeEmail aoAbrirDominio={abrirMigracao} />
      ) : (
        <Card
          title="Migrações"
          subtitle={`${dominios.length}${pedidas ? ` · ${pedidas} ${pedidas === 1 ? "caixa pedida" : "caixas pedidas"}` : ""}`}
          help="Um domínio por empresa. Ele nasce quando a entrada é marcada como paga, já com o passo a passo. Abra a migração para marcar as etapas, cadastrar as caixas e conferir o DNS."
          data-migracoes=""
        >
          {dominios.length === 0 ? (
            <EstadoVazio
              icone={<Mail className="h-5 w-5" aria-hidden="true" />}
              titulo="Nenhuma migração ainda"
              descricao="Marque uma entrada como paga e ela aparece aqui."
              acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setVista("entradas")}>Ver entradas</button>}
            />
          ) : (
            <List label="Migrações">
              {dominios.map((d) => {
                const daqui = etapas.filter((e) => e.dominio_id === d.id);
                const feitas = daqui.filter((e) => e.feito_em).length;
                const pedidasAqui = caixas.filter((c) => c.dominio_id === d.id && c.estado === "pedida").length;
                return (
                  <ListRow
                    key={d.id}
                    leading={<Avatar name={nomeDaConta(d.conta_id)} tone={d.estado === "concluido" ? "accent" : "neutral"} />}
                    title={d.dominio}
                    subtitle={`${nomeDaConta(d.conta_id)} · ${NOME_CURTO_DO_PROVEDOR[d.provedor]}${pedidasAqui ? ` · ${pedidasAqui} ${pedidasAqui === 1 ? "caixa pedida" : "caixas pedidas"}` : ""}`}
                    status={<StatusPill tone={TOM_DO_DOMINIO[d.estado]}>{ROTULO_DO_ESTADO_DO_DOMINIO[d.estado]}</StatusPill>}
                    value={
                      <span className="flex w-[72px] flex-col items-end sm:w-[96px]">
                        <span>{feitas}/{daqui.length}</span>
                        <ProgressBar value={feitas} max={Math.max(1, daqui.length)} height={4} tone={1} className="mt-1" label={`${feitas} de ${daqui.length} etapas`} />
                      </span>
                    }
                    onClick={() => setAberto(d.id)}
                  />
                );
              })}
            </List>
          )}
        </Card>
      )}

      {dominio && (
        <JanelaDaMigracao
          key={dominio.id}
          dominio={dominio as DominioComIntegracao}
          empresa={nomeDaConta(dominio.conta_id)}
          etapas={etapas.filter((e) => e.dominio_id === dominio.id)}
          caixas={caixas.filter((c) => c.dominio_id === dominio.id)}
          equipe={((contas.data || []).filter((c) => c.id === dominio.conta_id)[0] || { equipe: [] }).equipe}
          aoMudar={reler}
          aoEditar={() => setEditando(dominio)}
          onFechar={() => setAberto(null)}
        />
      )}

      {editando && (
        <EditorDeDominio
          dominio={editando}
          contas={(contas.data || []).map((c) => ({ id: c.id, nome: c.nome }))}
          onFechar={() => setEditando(null)}
          onSalvo={(id) => {
            void reler();
            setAberto(id);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

/** A migração de uma empresa: as etapas, as caixas e o DNS (provedor, integração e registros). */
function JanelaDaMigracao({
  dominio,
  empresa,
  etapas,
  caixas,
  equipe,
  aoMudar,
  aoEditar,
  onFechar,
}: {
  dominio: DominioComIntegracao;
  empresa: string;
  etapas: EtapaDaMigracao[];
  caixas: CaixaDeEmail[];
  equipe: Array<{ id: string; nome: string; email: string }>;
  aoMudar: () => Promise<unknown>;
  aoEditar: () => void;
  onFechar: () => void;
}) {
  const [parte, setParte] = useState<Parte>("passos");
  const feitas = etapas.filter((e) => e.feito_em).length;
  const webmail = dominio.webmail_url || WEBMAIL_DO_PROVEDOR[dominio.provedor];
  const caminho = [dominio.provedor_antigo ? `De ${dominio.provedor_antigo}` : "", `para ${NOME_CURTO_DO_PROVEDOR[dominio.provedor]}`, dominio.dns_em ? `DNS em ${dominio.dns_em}` : ""].filter(Boolean).join(" · ");
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="xl"
      titulo={dominio.dominio}
      descricao={`${empresa} · ${caminho}`}
      ajuda={dominio.observacao || undefined}
      rotuloDaAjuda="Anotações do domínio"
      acoes={
        <>
          <StatusPill tone={TOM_DO_DOMINIO[dominio.estado]}>{ROTULO_DO_ESTADO_DO_DOMINIO[dominio.estado]}</StatusPill>
          <OverflowMenu
            label="Mais ações da migração"
            items={[
              { label: "Editar o domínio", icon: <Pencil className="h-4 w-4" />, onSelect: aoEditar },
              webmail ? { label: "Abrir o webmail", icon: <Mail className="h-4 w-4" />, onSelect: () => window.open(webmail, "_blank", "noopener") } : null,
            ]}
          />
        </>
      }
      abaixoDoTitulo={
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-center">
            <ProgressBar value={feitas} max={Math.max(1, etapas.length)} height={6} tone={1} className="min-w-0 flex-1" label={`${feitas} de ${etapas.length} etapas`} />
            <span className="ml-3 shrink-0 text-[12px] leading-4 tabular-nums text-muted-foreground">{feitas} de {etapas.length}</span>
          </div>
          <SeletorCompacto
            rotulo="Parte da migração"
            opcoes={[
              { valor: "passos", rotulo: "Passo a passo", icone: <ListChecks className="h-4 w-4" aria-hidden="true" /> },
              { valor: "caixas", rotulo: "Caixas", contador: caixas.length, icone: <Inbox className="h-4 w-4" aria-hidden="true" /> },
              { valor: "dns", rotulo: "DNS e provedor", icone: <Server className="h-4 w-4" aria-hidden="true" /> },
            ]}
            valor={parte}
            onEscolher={(v) => setParte(v as Parte)}
            listaQuandoNaoCabe
          />
        </div>
      }
      data-migracao-aberta=""
    >
      {parte === "passos" && <PassoAPasso etapas={etapas} aoMudar={aoMudar} />}
      {parte === "caixas" && <CaixasDaCasa dominio={dominio} caixas={caixas} equipe={equipe} aoMudar={aoMudar} />}
      {parte === "dns" && (
        <div className="min-w-0 space-y-8">
          {dominio.provedor === "migadu" && <MigaduDoDominio key={`migadu-${dominio.id}`} dominio={dominio} aoMudar={aoMudar} />}
          <IntegracaoDoDominio key={`integracao-${dominio.id}`} dominio={dominio} aoMudar={aoMudar} />
          <Registros dominio={dominio} />
          <ChecagemDoDominio dominio={dominio} detalhado aoConferir={() => void aoMudar()} />
        </div>
      )}
    </JanelaCentral>
  );
}

/** As etapas como uma linha do tempo: feita (check), a de agora (em destaque) e as que faltam. */
function PassoAPasso({ etapas, aoMudar }: { etapas: EtapaDaMigracao[]; aoMudar: () => Promise<unknown> }) {
  const [anotando, setAnotando] = useState<EtapaDaMigracao | null>(null);
  const [nota, setNota] = useState("");
  const [marcando, setMarcando] = useState<string | null>(null);
  const ordenadas = etapas.slice().sort((a, b) => a.ordem - b.ordem);
  const atual = ordenadas.findIndex((e) => !e.feito_em);
  const marcar = async (e: EtapaDaMigracao) => {
    setMarcando(e.id);
    try {
      await casa.marcarEtapa(e.id, !e.feito_em);
      await aoMudar();
    } catch (erro) {
      toast.error(fraseDoErro(erro));
    } finally {
      setMarcando(null);
    }
  };
  if (!ordenadas.length) return <EstadoVazio compacto titulo="Sem passo a passo." descricao="Ele nasce quando a entrada é marcada como paga." />;
  return (
    <>
      <ol className="min-w-0" data-passo-a-passo="">
        {ordenadas.map((e, i) => {
          const feita = !!e.feito_em;
          const agora = i === atual;
          return (
            <li key={e.id} className={juntar("relative flex min-w-0 items-start", i < ordenadas.length - 1 && "pb-5")} data-etapa={feita ? "feita" : agora ? "agora" : "falta"}>
              {i < ordenadas.length - 1 && <span aria-hidden="true" className={juntar("absolute bottom-0 left-[15px] top-8 w-0.5", feita ? "bg-primary" : "bg-border")} />}
              <button
                type="button"
                role="checkbox"
                aria-checked={feita}
                aria-label={e.titulo}
                title={feita ? "Desmarcar" : "Marcar como feita"}
                onClick={() => void marcar(e)}
                disabled={marcando === e.id}
                className={juntar(
                  "toque-compacto relative z-[1] mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors",
                  foco,
                  feita ? "bg-primary text-primary-foreground" : agora ? "border-2 border-primary bg-card text-primary" : "border-2 border-border bg-card text-muted-foreground hover:border-primary/60",
                  marcando === e.id && "animate-pulse",
                )}
              >
                {feita ? <Check className="h-4 w-4" aria-hidden="true" /> : e.ordem}
              </button>
              <div className={juntar("min-w-0 flex-1 rounded-lg px-3 py-1.5", agora && "bg-primary/[0.07]")}>
                <div className="flex min-w-0 items-center">
                  <span className={juntar(texto.corpo, "min-w-0 font-medium", feita && "text-muted-foreground")}>{e.titulo}</span>
                  {e.ajuda && <HelpTooltip className="ml-1" label={`Como fazer: ${e.titulo}`}>{e.ajuda}</HelpTooltip>}
                  {agora && <Chip tone="accent" className="ml-2">Agora</Chip>}
                </div>
                {e.nota && <p className={juntar(texto.auxiliar, "mt-1 whitespace-pre-wrap leading-5 text-foreground/80")}>{e.nota}</p>}
                {feita && <span className={juntar(texto.auxiliar, "mt-0.5 block")}>Feita em {diaLegivel(e.feito_em as string, true)}</span>}
              </div>
              <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Anotar na etapa ${e.titulo}`} title="Anotar" onClick={() => { setAnotando(e); setNota(e.nota || ""); }}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <JanelaCentral
        aberta={!!anotando}
        onFechar={() => setAnotando(null)}
        largura="sm"
        titulo={anotando ? anotando.titulo : "Anotação"}
        rodape={
          <button
            type="button"
            className={botao.primario}
            onClick={() => {
              const e = anotando;
              if (!e) return;
              void casa.marcarEtapa(e.id, !!e.feito_em, nota.trim()).then(() => aoMudar()).then(() => setAnotando(null)).catch((erro) => toast.error(fraseDoErro(erro)));
            }}
          >
            Salvar anotação
          </button>
        }
      >
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} className={campoTexto} maxLength={1500} aria-label="Anotação da etapa" placeholder="O que foi feito, o que falta, com quem falar" />
      </JanelaCentral>
    </>
  );
}

function CaixasDaCasa({ dominio, caixas, equipe, aoMudar }: { dominio: DominioDeEmail; caixas: CaixaDeEmail[]; equipe: Array<{ id: string; nome: string; email: string }>; aoMudar: () => Promise<unknown> }) {
  const atribuir = async (c: CaixaDeEmail, membro: string) => {
    try {
      await atribuirCaixa(c.id, membro || null);
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };
  const [nova, setNova] = useState({ usuario: "", pessoa: "", tipo: "caixa" as CaixaDeEmail["tipo"], tamanho: "", convite: "", destinos: "" });
  const noMigadu = dominio.provedor === "migadu";
  const [adicionando, setAdicionando] = useState(caixas.length === 0);
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    const nome = nova.usuario.trim().toLowerCase().replace(/@.*$/, "");
    if (!/^[a-z0-9._-]{1,60}$/.test(nome)) return void toast.error("Use letras, números, ponto ou traço no endereço.");
    const convite = nova.convite.trim().toLowerCase();
    if (convite && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(convite) || convite.endsWith(`@${dominio.dominio}`))) {
      return void toast.error("O convite vai para o e-mail de hoje da pessoa, de fora deste domínio.");
    }
    const destinos = nova.destinos.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).map((x) => (x.indexOf("@") >= 0 ? x : `${x}@${dominio.dominio}`));
    setSalvando(true);
    try {
      // No Migadu a caixa nasce "pedida": o botão Montar cria e manda o convite.
      await casa.salvarCaixa({ dominio_id: dominio.id, conta_id: dominio.conta_id, endereco: `${nome}@${dominio.dominio}`, pessoa: nova.pessoa.trim(), tipo: nova.tipo, tamanho_origem: nova.tamanho.trim() || null, estado: noMigadu ? "pedida" : "criada", ...(noMigadu ? { email_convite: convite || null, destinos: nova.tipo === "caixa" ? null : destinos } : {}) });
      setNova({ usuario: "", pessoa: "", tipo: "caixa", tamanho: "", convite: "", destinos: "" });
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível cadastrar a caixa."));
    } finally {
      setSalvando(false);
    }
  };
  const mudarEstado = async (c: CaixaDeEmail, estado: CaixaDeEmail["estado"]) => {
    try {
      await casa.salvarCaixa({ id: c.id, dominio_id: c.dominio_id, conta_id: c.conta_id, endereco: c.endereco, estado });
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e));
    }
  };
  const porEstado = ESTADOS_DA_CAIXA.map((e) => ({ e, n: caixas.filter((c) => c.estado === e).length })).filter((x) => x.n > 0);
  return (
    <div className="min-w-0 space-y-5" data-caixas-da-casa="">
      <TituloDoBloco
        aoLado={
          <>
            <HelpTooltip label="Sobre as caixas">Cadastre cada caixa que existe hoje e acompanhe: criada no provedor novo, copiando o histórico, ativa. Diga de quem é cada caixa: no correio, a pessoa vê a dela e quem administra a empresa vê todas. A senha nunca passa por aqui.</HelpTooltip>
            {!adicionando && (
              <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setAdicionando(true)} data-abrir-nova-caixa="">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Caixa
              </button>
            )}
          </>
        }
      >
        {caixas.length} {caixas.length === 1 ? "caixa" : "caixas"}
      </TituloDoBloco>
      {porEstado.length > 0 && (
        <div className="-mt-2 flex min-w-0 flex-wrap [&>*]:mb-1.5 [&>*]:mr-1.5">
          {porEstado.map((x) => <Chip key={x.e} tone={TOM_DA_CAIXA[x.e]} dot>{x.n} {ROTULO_DA_CAIXA[x.e].toLowerCase()}</Chip>)}
        </div>
      )}
      {caixas.length > 0 && (
        <ul className="-mx-2 min-w-0 divide-y divide-border/50">
          {caixas.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-wrap items-center rounded-lg px-2 py-2.5 hover:bg-muted/40 sm:flex-nowrap">
              <span className="min-w-0 flex-1 basis-full sm:basis-0">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.endereco}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{[c.pessoa, c.tipo !== "caixa" ? c.tipo : "", c.tamanho_origem ? `${c.tamanho_origem} hoje` : ""].filter(Boolean).join(" · ") || "Sem responsável"}</span>
              </span>
              <span className="mt-2 flex min-w-0 items-center sm:mt-0">
                {c.tipo === "caixa" && equipe.length > 0 && (
                  <select value={(c as CaixaDeEmail & { membro_id?: string | null }).membro_id || ""} onChange={(e) => void atribuir(c, e.target.value)} className={juntar(campo, "h-8 w-auto max-w-[150px] text-[12px] sm:ml-2")} aria-label={`De quem é ${c.endereco}`} title="De quem é a caixa no correio" data-dono-da-caixa="">
                    <option value="">Sem pessoa</option>
                    {equipe.map((m) => <option key={m.id} value={m.id}>{m.nome || m.email}</option>)}
                  </select>
                )}
                <select value={c.estado} onChange={(e) => void mudarEstado(c, e.target.value as CaixaDeEmail["estado"])} className={juntar(campo, "ml-2 h-8 w-auto text-[12px]")} aria-label={`Situação de ${c.endereco}`}>
                  {ESTADOS_DA_CAIXA.map((e) => <option key={e} value={e}>{ROTULO_DA_CAIXA[e]}</option>)}
                </select>
              </span>
            </li>
          ))}
        </ul>
      )}
      {adicionando && (
        <div className="min-w-0 rounded-lg bg-muted/40 p-4" data-nova-caixa="">
          <p className={juntar(texto.rotulo, "mb-2")}>Nova caixa</p>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_110px]">
            <input value={nova.usuario} onChange={(e) => setNova({ ...nova, usuario: e.target.value })} className={campo} placeholder={`nome @${dominio.dominio}`} aria-label="Endereço da caixa" autoCapitalize="none" />
            <input value={nova.pessoa} onChange={(e) => setNova({ ...nova, pessoa: e.target.value })} className={campo} placeholder="Quem usa" aria-label="Quem usa" />
            <select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value as CaixaDeEmail["tipo"] })} className={campo} aria-label="Tipo">
              <option value="caixa">Caixa</option>
              <option value="apelido">Apelido</option>
              <option value="grupo">Grupo</option>
            </select>
            <input value={nova.tamanho} onChange={(e) => setNova({ ...nova, tamanho: e.target.value })} className={campo} placeholder="Tamanho" aria-label="Tamanho hoje" />
          </div>
          {noMigadu && (
            <div className="mt-2 min-w-0" data-convite-da-caixa="">
              {nova.tipo === "caixa" ? (
                <input value={nova.convite} onChange={(e) => setNova({ ...nova, convite: e.target.value })} className={campo} placeholder="E-mail de hoje da pessoa (recebe o convite)" aria-label="E-mail de hoje da pessoa, para o convite" autoCapitalize="none" inputMode="email" />
              ) : (
                <input value={nova.destinos} onChange={(e) => setNova({ ...nova, destinos: e.target.value })} className={campo} placeholder="Entrega em (ex.: joao, maria)" aria-label="Caixas que recebem o apelido" autoCapitalize="none" />
              )}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end">
            {caixas.length > 0 && <button type="button" className={juntar(botao.discreto, "mr-2 h-8")} onClick={() => setAdicionando(false)}>Cancelar</button>}
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void criar()} disabled={salvando || !nova.usuario.trim()}>{salvando ? "Adicionando..." : "Adicionar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Registros({ dominio }: { dominio: DominioDeEmail }) {
  const textoDosRegistros = registrosParaPublicar(dominio);
  const [ver, setVer] = useState(false);
  return (
    <section className="min-w-0" data-registros="">
      <TituloDoBloco
        aoLado={
          <>
            <HelpTooltip label="Sobre os registros">O modelo do provedor escolhido. O DKIM e a verificação do domínio usam valores que o próprio provedor gera para a conta do cliente: copie de lá. Comece o DMARC em p=none e suba para quarantine depois de alguns dias sem erro.</HelpTooltip>
            <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setVer((v) => !v)} aria-expanded={ver}>{ver ? "Esconder" : "Ver"}</button>
            <button
              type="button"
              className={botao.icone}
              aria-label="Copiar os registros"
              title="Copiar"
              onClick={() => void navigator.clipboard.writeText(textoDosRegistros).then(() => toast.success("Registros copiados.")).catch(() => toast.error("Não foi possível copiar."))}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        }
      >
        Modelo de registros ({NOME_CURTO_DO_PROVEDOR[dominio.provedor]})
      </TituloDoBloco>
      {ver && <pre className="min-w-0 overflow-x-auto rounded-md bg-muted/50 p-3 text-[12px] leading-5 text-foreground" data-registros-de-dns="">{textoDosRegistros}</pre>}
    </section>
  );
}

function EditorDeDominio({ dominio, contas, onFechar, onSalvo }: { dominio: DominioDeEmail; contas: Array<{ id: string; nome: string }>; onFechar: () => void; onSalvo: (id: string) => void }) {
  const [f, setF] = useState({
    conta_id: dominio.conta_id,
    dominio: dominio.dominio,
    provedor: dominio.provedor,
    provedor_antigo: dominio.provedor_antigo || "",
    dns_em: dominio.dns_em || "",
    registro_em: dominio.registro_em || "",
    webmail_url: dominio.webmail_url || "",
    dkim_seletor: dominio.dkim_seletor || "",
    estado: dominio.estado,
    observacao: dominio.observacao || "",
  });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const limpo = f.dominio.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(limpo)) return void toast.error("Escreva o domínio como suaempresa.com.br.");
    if (!f.conta_id) return void toast.error("Escolha a empresa.");
    setSalvando(true);
    try {
      const id = await casa.salvarDominio({
        id: dominio.id,
        conta_id: f.conta_id,
        dominio: limpo,
        provedor: f.provedor,
        provedor_antigo: f.provedor_antigo.trim() || null,
        dns_em: f.dns_em.trim() || null,
        registro_em: f.registro_em.trim() || null,
        webmail_url: /^https:\/\//.test(f.webmail_url.trim()) ? f.webmail_url.trim() : null,
        dkim_seletor: f.dkim_seletor.trim() || null,
        estado: f.estado,
        observacao: f.observacao.trim() || null,
      });
      toast.success("Domínio salvo.");
      onSalvo(id);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar o domínio."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo="Editar o domínio"
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-dominio="">{salvando ? "Salvando..." : "Salvar"}</button>}
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Empresa" obrigatorio>
          <select value={f.conta_id} onChange={(e) => setF({ ...f, conta_id: e.target.value })} className={campo} disabled>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Domínio" obrigatorio>
          <input value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })} className={campo} placeholder="suaempresa.com.br" autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Provedor novo">
          <select value={f.provedor} onChange={(e) => setF({ ...f, provedor: e.target.value as ProvedorDeEmail })} className={campo}>
            {PROVEDORES.map((p) => <option key={p} value={p}>{ROTULO_DO_PROVEDOR[p]}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Provedor de hoje">
          <input value={f.provedor_antigo} onChange={(e) => setF({ ...f, provedor_antigo: e.target.value })} className={campo} placeholder="UOL Host, Locaweb..." />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="DNS em">
          <input value={f.dns_em} onChange={(e) => setF({ ...f, dns_em: e.target.value })} className={campo} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Registro do domínio em">
          <input value={f.registro_em} onChange={(e) => setF({ ...f, registro_em: e.target.value })} className={campo} placeholder="Registro.br" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Seletor do DKIM" apoio="Vazio usa o padrão do provedor">
          <input value={f.dkim_seletor} onChange={(e) => setF({ ...f, dkim_seletor: e.target.value })} className={campo} autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Endereço do webmail" apoio="Vazio usa o do provedor">
          <input value={f.webmail_url} onChange={(e) => setF({ ...f, webmail_url: e.target.value })} className={campo} placeholder="https://" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Situação" largo>
          <SeletorCompacto rotulo="Situação do domínio" opcoes={ESTADOS.map((e) => ({ valor: e, rotulo: ROTULO_DO_ESTADO_DO_DOMINIO[e] }))} valor={f.estado} onEscolher={(v) => setF({ ...f, estado: v as EstadoDoDominio })} listaQuandoNaoCabe />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Anotações" largo>
          <textarea value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} className={campoTexto} maxLength={1500} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
