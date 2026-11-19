import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Copy, KeyRound, Link2, MailOpen, MessageCircle, Send, Users } from "lucide-react";
import { Avatar, Card, Chip, EmptyState, List, ListRow, PageHeader, PillTabs, SearchField, StatCard, StatGrid, Toolbar, type Tone } from "@/components/ds";
import { Carregando, EstadoDeErro, JanelaCentral, botao, juntar, rolagem, texto } from "@/components/sistema";
import { copiarLinkDeAcesso, diaLegivel, fraseDoErro, linkDeAcesso, listarContasDaCasa, reenviarConvite, type ContaNaCasa } from "@/lib/produto/api";
import { linkDeEntrada, linkDoWhatsApp, mensagemDeEntrada, situacaoDoAcesso, temAcesso, type DestinoDoAcesso, type SituacaoDoAcesso } from "@/lib/produto/acessos";

const MinhaCaixa = lazy(() => import("@/components/produto/casa/MinhaCaixa"));
const PessoasECaixas = lazy(() => import("@/components/produto/casa/PessoasECaixas"));
const LigarAoCliente = lazy(() => import("@/components/produto/casa/PessoasECaixas").then((m) => ({ default: m.LigarAoCliente })));

/**
 * Acessos dos clientes (19/11/2026, pedido do dono), só admin:
 *   /produto/acessos        cada empresa com CRM ou e-mail, o link de entrada para copiar ou mandar no
 *                           WhatsApp, quem já entrou e o convite ou primeiro acesso de quem falta;
 *   /produto/acessos/pessoas Pessoas e caixas: todas as pessoas do CRM e todas as caixas, com senha nova,
 *                           senha do cofre, link, desativar e o Adicionar (componente PessoasECaixas);
 *   /produto/acessos/caixa  Minha caixa: escolher uma caixa e entrar com a senha dela para ver o correio
 *                           como o cliente vê (componente MinhaCaixa).
 * O painel não vira usuário do CRM: os links abrem o login do produto, em outra sessão (TrocaDeAcesso).
 */

type Aba = "clientes" | "pessoas" | "caixa";
type Filtro = "todos" | "crm" | "email" | "faltam";

export const chaveDasContasDaCasa = ["produto", "casa", "contas"] as const;

const ROTULO_DO_DESTINO: Record<DestinoDoAcesso, string> = { crm: "CRM", correio: "Correio" };
const SITUACAO: Record<SituacaoDoAcesso, { rotulo: string; tom: Tone }> = {
  todos: { rotulo: "Todos entraram", tom: "success" },
  parte: { rotulo: "Falta gente", tom: "warning" },
  ninguem: { rotulo: "Ninguém entrou", tom: "danger" },
  sem_pessoas: { rotulo: "Sem pessoas", tom: "neutral" },
};

/** Os produtos da empresa que têm porta de entrada. */
export const destinosDaConta = (c: Pick<ContaNaCasa, "crm_ativo" | "email_ativo" | "dominios">): DestinoDoAcesso[] => {
  const d: DestinoDoAcesso[] = [];
  if (c.crm_ativo) d.push("crm");
  if (c.email_ativo || c.dominios > 0) d.push("correio");
  return d;
};

async function copiar(texto: string, aviso: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(aviso);
  } catch {
    window.prompt("Copie o link:", texto);
  }
}

const abrirWhatsApp = (telefone: string | null, mensagem: string) => {
  window.open(linkDoWhatsApp(telefone, mensagem), "_blank", "noopener,noreferrer");
};

export default function AcessosDosClientes() {
  const { aba: pedida } = useParams();
  const navegar = useNavigate();
  const aba: Aba = pedida === "caixa" ? "caixa" : pedida === "pessoas" ? "pessoas" : "clientes";
  return (
    <div className="min-w-0 space-y-6" data-acessos-dos-clientes={aba}>
      <PageHeader
        title="Acessos dos clientes"
        help="Empresas: o link de entrada de cada empresa (abre o login do produto dela, sem senha no link), quem já entrou e o convite de quem falta. Pessoas e caixas: todos os logins do CRM e todas as caixas, com senha nova, senha do cofre, link e o Adicionar. Minha caixa: escolha uma caixa e entre com a senha dela para ver o correio como o cliente vê. A senha fica só nesta aba e some ao sair."
        toolbar={
          <PillTabs<Aba>
            label="Áreas dos acessos"
            value={aba}
            onChange={(v) => navegar(v === "clientes" ? "/produto/acessos" : `/produto/acessos/${v}`, { replace: true })}
            tabs={[
              { value: "clientes", label: "Empresas", icon: <Building2 className="h-4 w-4" aria-hidden="true" /> },
              { value: "pessoas", label: "Pessoas e caixas", icon: <Users className="h-4 w-4" aria-hidden="true" /> },
              { value: "caixa", label: "Minha caixa", icon: <MailOpen className="h-4 w-4" aria-hidden="true" /> },
            ]}
          />
        }
      />
      {aba === "clientes" ? (
        <ListaDeAcessos />
      ) : aba === "pessoas" ? (
        <Suspense fallback={<Carregando linhas={6} rotulo="Carregando pessoas e caixas" />}>
          <PessoasECaixas />
        </Suspense>
      ) : (
        <Suspense fallback={<Carregando linhas={4} rotulo="Abrindo a caixa" />}>
          <MinhaCaixa />
        </Suspense>
      )}
    </div>
  );
}

function ListaDeAcessos() {
  const contas = useQuery({ queryKey: chaveDasContasDaCasa, queryFn: listarContasDaCasa });
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const todas = useMemo(() => (contas.data || []).filter(temAcesso), [contas.data]);
  const resumo = useMemo(() => {
    let pessoas = 0;
    let entraram = 0;
    let esperando = 0;
    todas.forEach((c) => {
      const s = situacaoDoAcesso(c.equipe);
      pessoas += s.total;
      entraram += s.entraram;
      esperando += s.esperando;
    });
    return { pessoas, entraram, esperando };
  }, [todas]);
  const termo = busca.trim().toLowerCase();
  const vistas = todas.filter((c) => {
    if (filtro === "crm" && !c.crm_ativo) return false;
    if (filtro === "email" && destinosDaConta(c).indexOf("correio") < 0) return false;
    if (filtro === "faltam" && situacaoDoAcesso(c.equipe).situacao === "todos") return false;
    if (!termo) return true;
    return [c.nome, c.email_cobranca || ""].concat(c.equipe.map((m) => `${m.nome} ${m.email}`)).join(" ").toLowerCase().indexOf(termo) >= 0;
  });
  const aberta = todas.filter((c) => c.id === abertaId)[0] || null;

  if (contas.isError) {
    return <EstadoDeErro titulo={fraseDoErro(contas.error, "Não foi possível carregar as empresas.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void contas.refetch()}>Tentar de novo</button>} />;
  }
  return (
    <div className="min-w-0 space-y-6" data-lista-de-acessos="">
      <StatGrid cols={3} label="Resumo dos acessos">
        <StatCard label="Empresas" value={contas.isLoading ? "..." : todas.length} />
        <StatCard label="Já entraram" value={contas.isLoading ? "..." : resumo.entraram} unit={resumo.pessoas ? `de ${resumo.pessoas}` : undefined} progress={resumo.pessoas ? { value: resumo.entraram, max: resumo.pessoas } : undefined} />
        <StatCard label="Convites esperando" value={contas.isLoading ? "..." : resumo.esperando} />
      </StatGrid>

      <Card flush>
        <div className="min-w-0 p-4 sm:p-5">
          <Toolbar
            label="Filtrar empresas"
            search={<SearchField value={busca} onChange={setBusca} placeholder="Buscar empresa ou pessoa" label="Buscar empresa ou pessoa" />}
            filters={
              <PillTabs<Filtro>
                label="Mostrar"
                variant="soft"
                size="sm"
                value={filtro}
                onChange={setFiltro}
                tabs={[
                  { value: "todos", label: "Todas" },
                  { value: "crm", label: "CRM" },
                  { value: "email", label: "E-mail" },
                  { value: "faltam", label: "Falta entrar" },
                ]}
              />
            }
          />
        </div>
        <div className={juntar("min-w-0 px-4 pb-3 sm:px-5", rolagem.longa)} data-lista-rolavel="">
          {contas.isLoading ? (
            <Carregando linhas={6} rotulo="Carregando as empresas" />
          ) : !todas.length ? (
            <EmptyState icon={<KeyRound className="h-5 w-5" />} title="Nenhuma empresa com CRM ou e-mail" description="Elas aparecem aqui quando a casa liga o CRM ou o e-mail." />
          ) : !vistas.length ? (
            <EmptyState compact title="Nada com esse filtro." action={<button type="button" className={botao.discreto} onClick={() => { setBusca(""); setFiltro("todos"); }}>Limpar filtros</button>} />
          ) : (
            <List label="Empresas e acessos">
              {vistas.map((c) => (
                <LinhaDaEmpresa key={c.id} conta={c} aoAbrir={() => setAbertaId(c.id)} />
              ))}
            </List>
          )}
        </div>
      </Card>

      {aberta && <FichaDeAcesso conta={aberta} aoFechar={() => setAbertaId(null)} />}
    </div>
  );
}

function LinhaDaEmpresa({ conta, aoAbrir }: { conta: ContaNaCasa; aoAbrir: () => void }) {
  const s = situacaoDoAcesso(conta.equipe);
  const destinos = destinosDaConta(conta);
  const principal = destinos[0] || "crm";
  const produtos = destinos.map((d) => ROTULO_DO_DESTINO[d]).join(" · ");
  return (
    <ListRow
      leading={<Avatar name={conta.nome} />}
      title={conta.nome}
      subtitle={`${produtos}${s.total ? ` · ${s.entraram} de ${s.total} entraram` : ""}`}
      onClick={aoAbrir}
      status={<Chip tone={SITUACAO[s.situacao].tom} dot size="sm">{SITUACAO[s.situacao].rotulo}</Chip>}
      action={
        <button type="button" className={botao.icone} onClick={() => void copiar(linkDeEntrada(conta.id, principal), `Link de entrada (${ROTULO_DO_DESTINO[principal]}) de ${conta.nome} copiado.`)} aria-label={`Copiar o link de entrada de ${conta.nome}`} title="Copiar o link de entrada" data-copiar-entrada={conta.id}>
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      }
      menuLabel={`Mais ações de ${conta.nome}`}
      menu={[
        ...destinos.map((d) => ({ label: `Copiar link do ${ROTULO_DO_DESTINO[d]}`, icon: <Link2 className="h-4 w-4" />, onSelect: () => void copiar(linkDeEntrada(conta.id, d), `Link do ${ROTULO_DO_DESTINO[d]} copiado.`) })),
        ...destinos.map((d) => ({ label: `Mandar o link do ${ROTULO_DO_DESTINO[d]} no WhatsApp`, icon: <MessageCircle className="h-4 w-4" />, onSelect: () => abrirWhatsApp(conta.telefone, mensagemDeEntrada({ empresa: conta.nome, destino: d, link: linkDeEntrada(conta.id, d) })) })),
        { label: "Ver pessoas e convites", icon: <Users className="h-4 w-4" />, onSelect: aoAbrir, separatorBefore: true },
      ]}
    />
  );
}

/** A ficha da empresa, no centro: os links de entrada e cada pessoa com o seu acesso. */
function FichaDeAcesso({ conta, aoFechar }: { conta: ContaNaCasa; aoFechar: () => void }) {
  const qc = useQueryClient();
  const s = situacaoDoAcesso(conta.equipe);
  const destinos = destinosDaConta(conta);
  const [gerado, setGerado] = useState<{ nome: string; email: string; link: string; primeiro: boolean } | null>(null);
  const [gerando, setGerando] = useState<string | null>(null);
  const pessoas = conta.equipe.filter((m) => m.estado !== "removido");

  const gerar = async (m: ContaNaCasa["equipe"][number]) => {
    setGerando(m.id);
    try {
      const r = await linkDeAcesso(m.id);
      setGerado({ nome: m.nome || m.email, email: r.email, link: r.link, primeiro: m.estado !== "ativo" });
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível gerar o link agora."));
    } finally {
      setGerando(null);
    }
  };

  return (
    <JanelaCentral aberta onFechar={aoFechar} largura="md" titulo={conta.nome} descricao={s.total ? `${s.entraram} de ${s.total} entraram` : "Sem pessoas ainda"} data-ficha-de-acesso={conta.id}>
      <div className="min-w-0 space-y-6">
        {!conta.client_id && (
          <section className="min-w-0" aria-label="Cliente">
            <h3 className={juntar(texto.rotulo, "mb-2")}>Cliente</h3>
            <Suspense fallback={null}>
              <LigarAoCliente conta={conta} aoLigar={() => void qc.invalidateQueries({ queryKey: chaveDasContasDaCasa })} />
            </Suspense>
          </section>
        )}
        <section className="min-w-0" aria-label="Links de entrada">
          <h3 className={juntar(texto.rotulo, "mb-2")}>Link de entrada</h3>
          <List label="Links de entrada">
            {destinos.map((d) => {
              const link = linkDeEntrada(conta.id, d);
              return (
                <ListRow
                  key={d}
                  dense
                  leading={<Avatar icon={d === "crm" ? <Users className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />} size="sm" tone="accent" />}
                  title={ROTULO_DO_DESTINO[d]}
                  subtitle={link.replace(/^https?:\/\//, "")}
                  action={
                    <>
                      <button type="button" className={botao.icone} onClick={() => void copiar(link, `Link do ${ROTULO_DO_DESTINO[d]} copiado.`)} aria-label={`Copiar o link do ${ROTULO_DO_DESTINO[d]}`} title="Copiar">
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <a className={botao.icone} href={linkDoWhatsApp(conta.telefone, mensagemDeEntrada({ empresa: conta.nome, destino: d, link }))} target="_blank" rel="noreferrer" aria-label={`Mandar o link do ${ROTULO_DO_DESTINO[d]} no WhatsApp`} title="Mandar no WhatsApp">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      </a>
                    </>
                  }
                />
              );
            })}
          </List>
        </section>

        <section className="min-w-0" aria-label="Pessoas">
          <h3 className={juntar(texto.rotulo, "mb-2")}>Pessoas</h3>
          {!pessoas.length ? (
            <EmptyState compact title="Ninguém convidado ainda." description="Convide pela ficha da empresa em Produto CRM, Empresas." />
          ) : (
            <List label="Pessoas da empresa">
              {pessoas.map((m) => {
                const entrou = m.estado === "ativo";
                return (
                  <ListRow
                    key={m.id}
                    dense
                    leading={<Avatar name={m.nome || m.email} size="sm" />}
                    title={m.nome || m.email}
                    subtitle={`${m.email}${m.papel === "admin" ? " · administra" : ""}`}
                    status={entrou ? <Chip tone="success" size="sm">{m.entrou_em ? `Entrou em ${diaLegivel(m.entrou_em)}` : "Entrou"}</Chip> : m.estado === "convidado" ? <Chip tone="warning" size="sm">Não entrou</Chip> : <Chip size="sm">{m.estado}</Chip>}
                    menuLabel={`Acesso de ${m.nome || m.email}`}
                    menu={[
                      { label: entrou ? "Gerar link para trocar a senha" : "Gerar link de primeiro acesso", icon: <KeyRound className="h-4 w-4" />, onSelect: () => void gerar(m), disabled: gerando === m.id },
                      { label: "Copiar link de primeiro acesso", icon: <Copy className="h-4 w-4" />, onSelect: () => void copiarLinkDeAcesso(m.id).then((e) => toast.success(`Link de acesso de ${e} copiado. Vale uma vez.`)).catch((e) => toast.error(fraseDoErro(e))) },
                      m.estado === "convidado" && { label: "Reenviar o convite por e-mail", icon: <Send className="h-4 w-4" />, onSelect: () => void reenviarConvite(m.id).then((r) => (r.enviado ? toast.success("Convite reenviado.") : toast.error("O e-mail não saiu agora."))).catch((e) => toast.error(fraseDoErro(e))) },
                    ]}
                  />
                );
              })}
            </List>
          )}
        </section>

        {gerado && (
          <section className="min-w-0 rounded-lg bg-muted p-4" aria-label="Link gerado" data-link-gerado="">
            <p className={juntar(texto.corpo, "font-medium")}>{gerado.primeiro ? "Primeiro acesso" : "Troca de senha"} de {gerado.nome}</p>
            <p className={juntar(texto.auxiliar, "mt-0.5")}>Vale uma vez. {gerado.email}</p>
            <div className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
              <button type="button" className={botao.primario} onClick={() => void copiar(gerado.link, "Link copiado. Vale uma vez.")}>
                <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Copiar
              </button>
              <a
                className={botao.secundario}
                href={linkDoWhatsApp(null, mensagemDeEntrada({ empresa: conta.nome, destino: destinos[0] || "crm", link: gerado.link, primeiroAcesso: true }))}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
            </div>
          </section>
        )}
      </div>
    </JanelaCentral>
  );
}
