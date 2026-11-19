import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Copy, Eye, KeyRound, Link2, Mail, MailOpen, MessageCircle, Plus, RefreshCw, Send, Shuffle, UserPlus, Users } from "lucide-react";
import { Avatar, Card, Chip, EmptyState, List, ListRow, PillTabs, SearchField, StatCard, StatGrid, Toolbar } from "@/components/ds";
import { CampoDeFormulario, Carregando, EstadoDeErro, GrupoDeCampos, JanelaCentral, botao, campo, juntar, rolagem, texto } from "@/components/sistema";
import { useClients } from "@/hooks/useSupabaseData";
import { ROTULO_DO_PAPEL, carregarEmail, casa, fraseDoErro, linkDeAcesso, listarContasDaCasa, type ContaNaCasa, type PapelNaConta } from "@/lib/produto/api";
import { linkDeEntrada, linkDoWhatsApp, mensagemDeEntrada } from "@/lib/produto/acessos";
import {
  extrasDeCrmVivos,
  opcoesDeEmpresaParaPessoa,
  caixasDaCentral,
  central,
  dominiosParaCaixaNova,
  enderecoNoDominio,
  filtrarNaCentral,
  fraseDoExtra,
  gerarSenhaForte,
  listarPessoasDaCasa,
  mandarLinkPorEmail,
  problemaDaSenha,
  ultimoAcessoLegivel,
  type CaixaNaCentral,
  type PessoaNaCentral,
  type TipoNaCentral,
} from "@/lib/produto/central-de-acessos";

/**
 * Pessoas e caixas (19/11/2026, pedido do dono): todas as pessoas do CRM e todas as caixas de e-mail das
 * empresas, com busca e filtro, as ações de cada linha no "…" e o "Adicionar" (pessoa no CRM ou caixa).
 *
 * Senha: a do CRM nunca aparece (não é recuperável); "Definir senha nova" mostra a senha escolhida UMA
 * vez. A da caixa vem do cofre só ao pedir "Mostrar senha" (fica no histórico da empresa) e some ao fechar
 * a janela. Nenhuma senha vai para o armazenamento do navegador, a URL ou o console.
 *
 * Rolagem: no computador cada lista rola dentro do seu cartão (cabeçalho parado); no celular a página rola.
 */

export const chaveDasPessoasDaCasa = ["produto", "casa", "pessoas"] as const;
const chaveDoEmail = ["produto", "casa", "email", "todas"] as const;
const chaveDasContas = ["produto", "casa", "contas"] as const;

type Janela =
  | { tipo: "senha_crm"; pessoa: PessoaNaCentral }
  | { tipo: "ver_senha"; caixa: CaixaNaCentral }
  | { tipo: "senha_caixa"; caixa: CaixaNaCentral }
  | { tipo: "link"; pessoa: Pick<PessoaNaCentral, "id" | "nome" | "email" | "empresa" | "estado">; link: string | null; extra?: string | null }
  | { tipo: "tirar_pessoa"; pessoa: PessoaNaCentral }
  | { tipo: "desativar_caixa"; caixa: CaixaNaCentral }
  | { tipo: "adicionar"; o_que: "pessoa" | "caixa" };

async function copiar(valor: string, aviso: string) {
  try {
    await navigator.clipboard.writeText(valor);
    toast.success(aviso);
  } catch {
    toast.error("Não deu para copiar aqui. Selecione e copie à mão.");
  }
}

/** Abre a aba já no clique (o navegador bloqueia janela aberta depois de esperar a rede) e leva ao link. */
function abrirDepois(): (url: string) => void {
  const aba = window.open("", "_blank");
  if (aba) aba.opener = null;
  return (url: string) => {
    if (aba) aba.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  };
}

const SITUACAO_DA_PESSOA: Record<PessoaNaCentral["estado"], { rotulo: string; tom: "success" | "warning" }> = {
  ativo: { rotulo: "Ativa", tom: "success" },
  convidado: { rotulo: "Convite", tom: "warning" },
};

export default function PessoasECaixas() {
  const qc = useQueryClient();
  const contas = useQuery({ queryKey: chaveDasContas, queryFn: listarContasDaCasa });
  const pessoas = useQuery({ queryKey: chaveDasPessoasDaCasa, queryFn: listarPessoasDaCasa });
  const email = useQuery({ queryKey: chaveDoEmail, queryFn: () => carregarEmail() });
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<TipoNaCentral>("todos");
  const [empresa, setEmpresa] = useState("");
  const [janela, setJanela] = useState<Janela | null>(null);

  const nomes = useMemo(() => {
    const n: Record<string, string> = {};
    (contas.data || []).forEach((c) => {
      n[c.id] = c.nome;
    });
    return n;
  }, [contas.data]);
  const caixas = useMemo(() => (email.data ? caixasDaCentral(email.data.caixas, email.data.dominios, nomes) : []), [email.data, nomes]);
  const todasAsPessoas = pessoas.data || [];
  const pessoasVistas = filtrarNaCentral(todasAsPessoas, { busca, empresa, campos: (p) => [p.nome, p.email] });
  const caixasVistas = filtrarNaCentral(caixas, { busca, empresa, campos: (c) => [c.endereco, c.pessoa] });
  const guardadas = caixas.filter((c) => c.guardada).length;
  const empresas = useMemo(() => (contas.data || []).filter((c) => c.crm_ativo || c.email_ativo || c.dominios > 0).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [contas.data]);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: chaveDasPessoasDaCasa });
    void qc.invalidateQueries({ queryKey: chaveDoEmail });
    void qc.invalidateQueries({ queryKey: chaveDasContas });
  };
  const erro = pessoas.error || email.error || contas.error;
  if (erro) {
    return <EstadoDeErro titulo={fraseDoErro(erro, "Não foi possível carregar as pessoas e as caixas.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={recarregar}>Tentar de novo</button>} />;
  }
  const carregando = pessoas.isLoading || email.isLoading || contas.isLoading;
  const limparFiltros = () => {
    setBusca("");
    setEmpresa("");
    setTipo("todos");
  };

  const linhaDaPessoa = (p: PessoaNaCentral) => {
    const sit = SITUACAO_DA_PESSOA[p.estado];
    return (
      <ListRow
        key={p.id}
        dense
        leading={<Avatar name={p.nome || p.email} size="sm" />}
        title={p.nome || p.email}
        subtitle={`${p.email} · ${p.empresa}`}
        status={<Chip tone={sit.tom} dot size="sm">{sit.rotulo}</Chip>}
        value={<span className="text-[12px] font-normal text-muted-foreground">{ultimoAcessoLegivel(p.ultimo_acesso)}</span>}
        menuLabel={`Acesso de ${p.nome || p.email}`}
        menu={[
          { label: "Copiar e-mail", icon: <Copy className="h-4 w-4" />, onSelect: () => void copiar(p.email, "E-mail copiado.") },
          { label: "Definir senha nova", icon: <KeyRound className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "senha_crm", pessoa: p }) },
          { label: p.estado === "ativo" ? "Gerar link de troca de senha" : "Gerar link de primeiro acesso", icon: <Link2 className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "link", pessoa: p, link: null }) },
          { label: "Mandar o link por e-mail", icon: <Send className="h-4 w-4" />, onSelect: () => void avisarEnvio(p.id) },
          { label: "Mandar o link no WhatsApp", icon: <MessageCircle className="h-4 w-4" />, onSelect: () => void linkNoWhatsApp(p) },
          { label: "Tirar do CRM", icon: <Ban className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "tirar_pessoa", pessoa: p }), separatorBefore: true, danger: true },
        ]}
      />
    );
  };

  const linhaDaCaixa = (c: CaixaNaCentral) => (
    <ListRow
      key={c.id}
      dense
      leading={<Avatar icon={<MailOpen className="h-4 w-4" />} size="sm" tone="accent" />}
      title={c.endereco}
      subtitle={c.pessoa ? `${c.pessoa} · ${c.empresa}` : c.empresa}
      status={
        c.estado === "pedida" ? <Chip size="sm">Pedida</Chip> : c.guardada ? <Chip tone="success" dot size="sm">Senha no cofre</Chip> : <Chip tone="warning" dot size="sm">Sem senha no cofre</Chip>
      }
      menuLabel={`Acesso de ${c.endereco}`}
      menu={[
        { label: "Copiar e-mail", icon: <Copy className="h-4 w-4" />, onSelect: () => void copiar(c.endereco, "E-mail copiado.") },
        c.guardada && { label: "Mostrar senha", icon: <Eye className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "ver_senha", caixa: c }) },
        { label: c.provedor === "migadu" ? "Redefinir senha da caixa" : "Guardar a senha no cofre", icon: <RefreshCw className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "senha_caixa", caixa: c }), disabled: c.estado === "pedida" },
        { label: "Mandar o acesso no WhatsApp", icon: <MessageCircle className="h-4 w-4" />, onSelect: () => window.open(linkDoWhatsApp(null, mensagemDeEntrada({ empresa: c.empresa, destino: "correio", link: linkDeEntrada(c.conta_id, "correio") }) + ` (login: ${c.endereco})`), "_blank", "noopener,noreferrer") },
        { label: "Desativar caixa", icon: <Ban className="h-4 w-4" />, onSelect: () => setJanela({ tipo: "desativar_caixa", caixa: c }), separatorBefore: true, danger: true },
      ]}
    />
  );

  async function avisarEnvio(membroId: string) {
    const id = toast.loading("Mandando o link por e-mail...");
    try {
      const r = await mandarLinkPorEmail(membroId);
      if (r.situacao === "falhou") toast.error(r.frase, { id, duration: 12000 });
      else toast.success(r.frase, { id });
    } catch (e) {
      toast.error(fraseDoErro(e, "O e-mail não saiu agora. Copie o link."), { id });
    }
  }

  async function linkNoWhatsApp(p: PessoaNaCentral) {
    const ir = abrirDepois();
    try {
      const r = await linkDeAcesso(p.id);
      ir(linkDoWhatsApp(null, mensagemDeEntrada({ empresa: p.empresa, destino: "crm", link: r.link, primeiroAcesso: true })));
    } catch (e) {
      ir("about:blank");
      toast.error(fraseDoErro(e, "Não foi possível gerar o link agora."));
    }
  }

  const verPessoas = tipo !== "email";
  const verCaixas = tipo !== "crm";

  return (
    <div className="min-w-0 space-y-6" data-pessoas-e-caixas="">
      <StatGrid cols={3} label="Resumo dos acessos">
        <StatCard label="Pessoas no CRM" value={carregando ? "..." : todasAsPessoas.length} unit={carregando ? undefined : `${todasAsPessoas.filter((p) => p.estado === "ativo").length} ativas`} />
        <StatCard label="Caixas de e-mail" value={carregando ? "..." : caixas.length} />
        <StatCard label="Senhas no cofre" value={carregando ? "..." : guardadas} unit={caixas.length ? `de ${caixas.length}` : undefined} progress={caixas.length ? { value: guardadas, max: caixas.length } : undefined} />
      </StatGrid>

      <Toolbar
        label="Filtrar pessoas e caixas"
        search={<SearchField value={busca} onChange={setBusca} placeholder="Buscar nome, e-mail ou empresa" label="Buscar nome, e-mail ou empresa" />}
        filters={
          <>
            <PillTabs<TipoNaCentral>
              label="Tipo"
              variant="soft"
              size="sm"
              value={tipo}
              onChange={setTipo}
              tabs={[
                { value: "todos", label: "Tudo" },
                { value: "crm", label: "CRM" },
                { value: "email", label: "E-mail" },
              ]}
            />
            <select className={juntar(campo, "h-9 w-auto min-w-0 max-w-[220px]")} value={empresa} onChange={(e) => setEmpresa(e.target.value)} aria-label="Empresa" data-filtro-empresa="">
              <option value="">Todas as empresas</option>
              {empresas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </>
        }
        actions={
          <button type="button" className={botao.primario} onClick={() => setJanela({ tipo: "adicionar", o_que: tipo === "email" ? "caixa" : "pessoa" })} data-adicionar="">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Adicionar
          </button>
        }
      />

      <div className={juntar("grid min-w-0 gap-6", verPessoas && verCaixas && "xl:grid-cols-2")}>
        {verPessoas && (
          <Card flush title="Pessoas do CRM" icon={<Users className="h-4 w-4" />} subtitle={carregando ? undefined : `${pessoasVistas.length} ${pessoasVistas.length === 1 ? "pessoa" : "pessoas"}`} help="O login de cada pessoa no CRM. A senha não aparece (não dá para recuperar): use Definir senha nova ou mande o link de troca. Último acesso é a última vez que a pessoa entrou." data-cartao-pessoas="">
            <ListaRolavel rotulo="Lista de pessoas do CRM" carregando={carregando} vazio={!todasAsPessoas.length ? <EmptyState compact icon={<Users className="h-5 w-5" />} title="Ninguém no CRM ainda." /> : !pessoasVistas.length ? <EmptyState compact title="Nada com esse filtro." action={<button type="button" className={botao.discreto} onClick={limparFiltros}>Limpar filtros</button>} /> : null}>
              {pessoasVistas.map(linhaDaPessoa)}
            </ListaRolavel>
          </Card>
        )}
        {verCaixas && (
          <Card flush title="Caixas de e-mail" icon={<Mail className="h-4 w-4" />} subtitle={carregando ? undefined : `${caixasVistas.length} ${caixasVistas.length === 1 ? "caixa" : "caixas"}`} help="As caixas das empresas. A senha fica cifrada no cofre: Mostrar senha só para a administração, e cada vez fica no histórico da empresa. Redefinir troca no Migadu e no cofre." data-cartao-caixas="">
            <ListaRolavel rotulo="Lista de caixas de e-mail" carregando={carregando} vazio={!caixas.length ? <EmptyState compact icon={<Mail className="h-5 w-5" />} title="Nenhuma caixa ainda." /> : !caixasVistas.length ? <EmptyState compact title="Nada com esse filtro." action={<button type="button" className={botao.discreto} onClick={limparFiltros}>Limpar filtros</button>} /> : null}>
              {caixasVistas.map(linhaDaCaixa)}
            </ListaRolavel>
          </Card>
        )}
      </div>

      {janela && janela.tipo === "senha_crm" && <JanelaDaSenhaDoCrm pessoa={janela.pessoa} aoFechar={() => setJanela(null)} />}
      {janela && janela.tipo === "ver_senha" && <JanelaVerSenha caixa={janela.caixa} aoFechar={() => setJanela(null)} />}
      {janela && janela.tipo === "senha_caixa" && <JanelaDaSenhaDaCaixa caixa={janela.caixa} aoFechar={() => setJanela(null)} aoMudar={recarregar} />}
      {janela && janela.tipo === "link" && <JanelaDoLink pessoa={janela.pessoa} linkPronto={janela.link} extra={janela.extra || null} aoFechar={() => setJanela(null)} />}
      {janela && janela.tipo === "tirar_pessoa" && (
        <JanelaDeConfirmar
          titulo={`Tirar ${janela.pessoa.nome || janela.pessoa.email} do CRM`}
          botaoTexto="Tirar do CRM"
          aoFechar={() => setJanela(null)}
          fazer={async () => {
            const r = await central.removerPessoa(janela.pessoa.id);
            recarregar();
            const extra = fraseDoExtra(r.extra, "crm");
            if (r.aviso) toast.warning(r.aviso);
            toast.success(extra ? `Pessoa tirada do CRM. ${extra}` : "Pessoa tirada do CRM.");
          }}
        >
          <p className={texto.corpo}>{janela.pessoa.email} perde o acesso ao CRM da {janela.pessoa.empresa}. Os negócios dela ficam sem dono.</p>
        </JanelaDeConfirmar>
      )}
      {janela && janela.tipo === "desativar_caixa" && (
        <JanelaDeConfirmar
          titulo={`Desativar ${janela.caixa.endereco}`}
          botaoTexto="Desativar caixa"
          aoFechar={() => setJanela(null)}
          fazer={async () => {
            const r = await central.desativarCaixa(janela.caixa.id);
            recarregar();
            const extra = fraseDoExtra(r.extra, "email");
            if (r.aviso) toast.warning(r.aviso);
            toast.success(extra ? `Caixa desativada. ${extra}` : "Caixa desativada.");
          }}
        >
          <p className={texto.corpo}>A caixa para de enviar, receber e abrir. As mensagens não são apagadas.</p>
        </JanelaDeConfirmar>
      )}
      {janela && janela.tipo === "adicionar" && (
        <JanelaAdicionar
          inicial={janela.o_que}
          contas={contas.data || []}
          dominios={email.data ? email.data.dominios : []}
          nomes={nomes}
          aoFechar={() => setJanela(null)}
          aoMudar={recarregar}
          aoPessoaCriada={(pessoa, link, extra) => setJanela({ tipo: "link", pessoa, link, extra })}
        />
      )}
    </div>
  );
}

/**
 * A lista dentro do cartão: no computador rola sozinha com altura máxima (o cabeçalho do cartão fica
 * parado e a página não rola junto); abaixo de 1024 px a página rola normal, sem prender o dedo.
 */
function ListaRolavel({ rotulo, carregando, vazio, children }: { rotulo: string; carregando: boolean; vazio: ReactNode; children: ReactNode }) {
  return (
    <div className={juntar("min-w-0 px-2 pb-2 sm:px-3", rolagem.longa)} data-lista-rolavel="" aria-label={rotulo} role="region" tabIndex={0}>
      {carregando ? <div className="px-2 py-2"><Carregando linhas={6} rotulo="Carregando" /></div> : vazio ? <div className="px-2 py-2">{vazio}</div> : <List label={rotulo}>{children}</List>}
    </div>
  );
}

// ------------------------------------------------------------------ senha

/** Campo de senha com "Gerar". A senha mora só neste estado (some quando a janela fecha). */
function CampoDeSenha({ valor, aoMudar, erro }: { valor: string; aoMudar: (v: string) => void; erro?: string | null }) {
  return (
    <CampoDeFormulario rotulo="Senha nova" erro={erro || undefined}>
      <span className="flex min-w-0 items-center">
        <input
          type="text"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          className={juntar(campo, "min-w-0 flex-1 tabular-nums")}
          autoComplete="new-password"
          spellCheck={false}
          aria-label="Senha nova"
          data-campo-senha=""
        />
        <button type="button" className={juntar(botao.secundario, "ml-2 h-9")} onClick={() => aoMudar(gerarSenhaForte())} data-gerar-senha="">
          <Shuffle className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Gerar
        </button>
      </span>
    </CampoDeFormulario>
  );
}

/** A senha à vista uma vez, para copiar. Fechar a janela apaga. */
function SenhaUmaVez({ rotulo, senha, aviso }: { rotulo: string; senha: string; aviso: string }) {
  return (
    <section className="min-w-0 rounded-lg bg-muted p-4" aria-label={rotulo} data-senha-uma-vez="">
      <p className={juntar(texto.auxiliar, "mb-1")}>{rotulo}</p>
      <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-2">
        <code className="mr-3 min-w-0 break-all rounded-sm bg-card px-2 py-1 text-[15px] font-medium tabular-nums text-foreground">{senha}</code>
        <button type="button" className={botao.primario} onClick={() => void copiar(senha, "Senha copiada.")}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Copiar
        </button>
      </div>
      <p className={texto.auxiliar}>{aviso}</p>
    </section>
  );
}

function JanelaDaSenhaDoCrm({ pessoa, aoFechar }: { pessoa: PessoaNaCentral; aoFechar: () => void }) {
  const [senha, setSenha] = useState(() => gerarSenhaForte());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [definida, setDefinida] = useState<string | null>(null);
  const fechar = () => {
    setSenha("");
    setDefinida(null);
    aoFechar();
  };
  const definir = async () => {
    const p = problemaDaSenha(senha);
    if (p) return setErro(p);
    setSalvando(true);
    setErro(null);
    try {
      await central.definirSenha(pessoa.id, senha);
      setDefinida(senha);
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível definir a senha agora."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={fechar}
      largura="sm"
      titulo="Definir senha nova"
      descricao={pessoa.email}
      ajuda="A senha do CRM não é guardada em lugar nenhum e não dá para ver a antiga. A nova aparece só agora: copie e mande para a pessoa. Ela pode trocar depois pelo link de troca de senha."
      rodape={
        definida ? (
          <button type="button" className={botao.primario} onClick={fechar}>Pronto</button>
        ) : (
          <>
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={fechar}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void definir()} disabled={salvando} data-definir-senha="">
              {salvando ? "Definindo..." : "Definir senha"}
            </button>
          </>
        )
      }
      data-janela-senha-crm={pessoa.id}
    >
      {definida ? (
        <SenhaUmaVez rotulo={`Senha de ${pessoa.email}`} senha={definida} aviso="Ela não aparece de novo depois que você fechar." />
      ) : (
        <CampoDeSenha valor={senha} aoMudar={(v) => { setSenha(v); setErro(null); }} erro={erro} />
      )}
    </JanelaCentral>
  );
}

function JanelaVerSenha({ caixa, aoFechar }: { caixa: CaixaNaCentral; aoFechar: () => void }) {
  const [senha, setSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    central.mostrarSenha(caixa.id).then((r) => vivo && setSenha(r.senha)).catch((e) => vivo && setErro(fraseDoErro(e, "Não foi possível abrir o cofre agora.")));
    // Fechou, trocou de tela ou passou um minuto: a senha sai da memória.
    const t = window.setTimeout(() => vivo && setSenha(null), 60000);
    return () => {
      vivo = false;
      window.clearTimeout(t);
      setSenha(null);
    };
  }, [caixa.id]);
  return (
    <JanelaCentral aberta onFechar={aoFechar} largura="sm" titulo="Senha da caixa" descricao={caixa.endereco} ajuda="A senha sai do cofre só agora e some em um minuto ou ao fechar. Esta visualização fica no histórico da empresa." rodape={<button type="button" className={botao.primario} onClick={aoFechar}>Fechar</button>} data-janela-ver-senha={caixa.id}>
      {erro ? <EstadoDeErro titulo={erro} /> : senha ? <SenhaUmaVez rotulo={`Login: ${caixa.endereco}`} senha={senha} aviso="Registrado no histórico da empresa." /> : <Carregando linhas={1} rotulo="Abrindo o cofre" />}
    </JanelaCentral>
  );
}

function JanelaDaSenhaDaCaixa({ caixa, aoFechar, aoMudar }: { caixa: CaixaNaCentral; aoFechar: () => void; aoMudar: () => void }) {
  const soGuardar = caixa.provedor !== "migadu";
  const [senha, setSenha] = useState(() => (soGuardar ? "" : gerarSenhaForte()));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [feita, setFeita] = useState<string | null>(null);
  const fechar = () => {
    setSenha("");
    setFeita(null);
    aoFechar();
  };
  const salvar = async () => {
    const p = problemaDaSenha(senha);
    if (p) return setErro(p);
    setSalvando(true);
    setErro(null);
    try {
      await central.redefinirSenhaDaCaixa(caixa.id, senha, soGuardar);
      setFeita(senha);
      aoMudar();
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível trocar a senha agora."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={fechar}
      largura="sm"
      titulo={soGuardar ? "Guardar senha no cofre" : "Redefinir senha da caixa"}
      descricao={caixa.endereco}
      ajuda={soGuardar ? "Esta caixa não é do Migadu: troque a senha no provedor dela e guarde a mesma aqui. O correio da casa passa a abrir com ela." : "Troca a senha no Migadu e no cofre ao mesmo tempo. Programas de e-mail que usam a senha antiga pedem a nova."}
      rodape={
        feita ? (
          <button type="button" className={botao.primario} onClick={fechar}>Pronto</button>
        ) : (
          <>
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={fechar}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-senha-caixa="">
              {salvando ? "Salvando..." : soGuardar ? "Guardar" : "Redefinir"}
            </button>
          </>
        )
      }
      data-janela-senha-caixa={caixa.id}
    >
      {feita ? <SenhaUmaVez rotulo={`Login: ${caixa.endereco}`} senha={feita} aviso="Guardada no cofre. Para ver de novo, use Mostrar senha." /> : <CampoDeSenha valor={senha} aoMudar={(v) => { setSenha(v); setErro(null); }} erro={erro} />}
    </JanelaCentral>
  );
}

// ------------------------------------------------------------------ link

function JanelaDoLink({ pessoa, linkPronto, extra, aoFechar }: { pessoa: Pick<PessoaNaCentral, "id" | "nome" | "email" | "empresa" | "estado">; linkPronto: string | null; extra: string | null; aoFechar: () => void }) {
  const [link, setLink] = useState<string | null>(linkPronto);
  const [erro, setErro] = useState<string | null>(null);
  const [envio, setEnvio] = useState<{ situacao: string; frase: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (linkPronto) return;
    let vivo = true;
    linkDeAcesso(pessoa.id).then((r) => vivo && setLink(r.link)).catch((e) => vivo && setErro(fraseDoErro(e, "Não foi possível gerar o link agora.")));
    return () => {
      vivo = false;
    };
  }, [pessoa.id, linkPronto]);
  const mandar = async () => {
    setEnviando(true);
    setEnvio({ situacao: "na_fila", frase: "Mandando..." });
    try {
      setEnvio(await mandarLinkPorEmail(pessoa.id));
    } catch (e) {
      setEnvio({ situacao: "falhou", frase: fraseDoErro(e, "O e-mail não saiu agora. Copie o link.") });
    } finally {
      setEnviando(false);
    }
  };
  const primeiro = pessoa.estado !== "ativo";
  return (
    <JanelaCentral aberta onFechar={aoFechar} largura="sm" titulo={primeiro ? "Link de primeiro acesso" : "Link de troca de senha"} descricao={pessoa.email} ajuda="O link vale uma vez e por pouco tempo. Ele abre o CRM e pede para a pessoa criar a senha dela." rodape={<button type="button" className={botao.primario} onClick={aoFechar}>Pronto</button>} data-janela-link={pessoa.id}>
      <div className="min-w-0 space-y-4">
        {extra && <Chip tone="info" size="sm">{extra}</Chip>}
        {erro ? (
          <EstadoDeErro titulo={erro} />
        ) : !link ? (
          <Carregando linhas={1} rotulo="Gerando o link" />
        ) : (
          <>
            <p className={juntar(texto.auxiliar, "truncate")} title={link}>{link.replace(/^https?:\/\//, "")}</p>
            <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
              <button type="button" className={botao.primario} onClick={() => void copiar(link, "Link copiado. Vale uma vez.")} data-copiar-link="">
                <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Copiar
              </button>
              <a className={botao.secundario} href={linkDoWhatsApp(null, mensagemDeEntrada({ empresa: pessoa.empresa, destino: "crm", link, primeiroAcesso: true }))} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                WhatsApp
              </a>
              <button type="button" className={botao.secundario} onClick={() => void mandar()} disabled={enviando} data-mandar-email="">
                <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Por e-mail
              </button>
            </div>
            {envio && (
              <p className={juntar(texto.auxiliar, envio.situacao === "falhou" && "text-destructive")} role="status" data-envio={envio.situacao}>
                {envio.frase}
              </p>
            )}
          </>
        )}
      </div>
    </JanelaCentral>
  );
}

// ------------------------------------------------------------------ confirmar

function JanelaDeConfirmar({ titulo, botaoTexto, fazer, aoFechar, children }: { titulo: string; botaoTexto: string; fazer: () => Promise<void>; aoFechar: () => void; children: ReactNode }) {
  const [fazendo, setFazendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      largura="sm"
      titulo={titulo}
      rodape={
        <>
          <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={aoFechar}>Cancelar</button>
          <button
            type="button"
            className={botao.perigo}
            disabled={fazendo}
            onClick={() => {
              setFazendo(true);
              setErro(null);
              fazer().then(aoFechar).catch((e) => {
                setErro(fraseDoErro(e));
                setFazendo(false);
              });
            }}
            data-confirmar=""
          >
            {fazendo ? "Aguarde..." : botaoTexto}
          </button>
        </>
      }
    >
      <div className="min-w-0 space-y-3">
        {children}
        {erro && <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">{erro}</p>}
      </div>
    </JanelaCentral>
  );
}

// ------------------------------------------------------------------ adicionar

/** Liga a empresa a um cliente da Aceleriq (para o Financeiro e a ficha do cliente acompanharem). */
export function LigarAoCliente({ conta, aoLigar }: { conta: ContaNaCasa; aoLigar: () => void }) {
  const clientes = useClients();
  const [escolhido, setEscolhido] = useState("");
  const [ligando, setLigando] = useState(false);
  const lista = ((clientes.data || []) as Array<{ id: string; full_name?: string | null; company_name?: string | null }>)
    .map((c) => ({ id: c.id, nome: (c.company_name || c.full_name || "Cliente").trim() }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ligar = async () => {
    if (!escolhido) return;
    setLigando(true);
    try {
      await casa.salvarConta(conta.id, { client_id: escolhido });
      toast.success(`${conta.nome} ligada ao cliente. O Financeiro passa a acompanhar.`);
      aoLigar();
    } catch (e) {
      const m = String((e as { message?: string })?.message || "");
      toast.error(/produto_contas_um_por_cliente/.test(m) ? "Esse cliente já tem outra empresa no CRM." : fraseDoErro(e, "Não foi possível ligar agora."));
    } finally {
      setLigando(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-2" data-ligar-ao-cliente={conta.id}>
      <Chip tone="warning" dot size="sm" className="mr-3">Sem cliente ligado</Chip>
      <select className={juntar(campo, "mr-2 h-9 w-auto min-w-0 max-w-[240px]")} value={escolhido} onChange={(e) => setEscolhido(e.target.value)} aria-label="Cliente da Aceleriq">
        <option value="">{clientes.isLoading ? "Carregando..." : "Escolha o cliente"}</option>
        {lista.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
      <button type="button" className={juntar(botao.secundario, "h-9")} onClick={() => void ligar()} disabled={!escolhido || ligando}>
        {ligando ? "Ligando..." : "Ligar"}
      </button>
    </div>
  );
}

function JanelaAdicionar({
  inicial,
  contas,
  dominios,
  nomes,
  aoFechar,
  aoMudar,
  aoPessoaCriada,
}: {
  inicial: "pessoa" | "caixa";
  contas: ContaNaCasa[];
  dominios: Parameters<typeof dominiosParaCaixaNova>[0];
  nomes: Record<string, string>;
  aoFechar: () => void;
  aoMudar: () => void;
  aoPessoaCriada: (pessoa: Pick<PessoaNaCentral, "id" | "nome" | "email" | "empresa" | "estado">, link: string | null, extra: string | null) => void;
}) {
  const [o_que, setOQue] = useState<"pessoa" | "caixa">(inicial);
  const clientes = useClients();
  const extrasDeCrm = useQuery({ queryKey: ["produto", "casa", "extras-crm"], queryFn: extrasDeCrmVivos, staleTime: 60_000 });
  const opcoes = useMemo(
    () =>
      opcoesDeEmpresaParaPessoa(
        contas,
        ((clientes.data || []) as Array<{ id: string; full_name?: string | null; company_name?: string | null }>).map((c) => ({ id: c.id, nome: (c.company_name || c.full_name || "").trim() })),
        extrasDeCrm.data || [],
      ),
    [contas, clientes.data, extrasDeCrm.data],
  );
  const paraCaixa = dominiosParaCaixaNova(dominios, nomes);
  // Pessoa
  const [contaId, setContaId] = useState("");
  const [nome, setNome] = useState("");
  const [emailDaPessoa, setEmailDaPessoa] = useState("");
  const [papel, setPapel] = useState<PapelNaConta>("usuario");
  // Caixa
  const [dominioId, setDominioId] = useState("");
  const [parte, setParte] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [senha, setSenha] = useState(() => gerarSenhaForte());
  const [criada, setCriada] = useState<{ endereco: string; senha: string; extra: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const opcao = opcoes.filter((o) => o.valor === contaId)[0] || null;
  const idDaConta = opcao && (opcao.destino.tipo === "conta" || opcao.destino.tipo === "ativar") ? opcao.destino.conta_id : "";
  const conta = contas.filter((c) => c.id === idDaConta)[0] || null;
  const empresaNova = !!opcao && (opcao.destino.tipo === "plano" || opcao.destino.tipo === "nova");
  const dominio = paraCaixa.filter((d) => d.id === dominioId)[0] || null;
  const contaDaCaixa = dominio ? contas.filter((c) => c.id === dominio.conta_id)[0] || null : null;
  const endereco = dominio ? enderecoNoDominio(parte, dominio.dominio) : null;

  const fechar = () => {
    setSenha("");
    setCriada(null);
    aoFechar();
  };

  const adicionarPessoa = async () => {
    if (!opcao) return setErro("Escolha a empresa.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailDaPessoa.trim())) return setErro("Diga o e-mail de login da pessoa.");
    setSalvando(true);
    setErro(null);
    const email = emailDaPessoa.trim().toLowerCase();
    const pessoa = (id: string) => ({ id, nome: nome.trim(), email, empresa: opcao.nome, estado: "convidado" as const });
    try {
      const d = opcao.destino;
      if (d.tipo === "plano") {
        // Cliente com o extra de CRM no plano: liga o CRM pelo plano (o Financeiro já cobra pelo extra).
        const r = await casa.crmPeloPlano({ extra_id: d.extra_id, email, nome: nome.trim() || undefined });
        aoMudar();
        const link = r.membro_id ? await linkDeAcesso(r.membro_id).then((x) => x.link).catch(() => null) : null;
        aoPessoaCriada(pessoa(r.membro_id || ""), link, null);
        return;
      }
      if (d.tipo === "nova") {
        // Cliente sem empresa no CRM: nasce a empresa ligada a ele, com esta pessoa administrando.
        const r = await casa.criarConta({ nome: opcao.nome, email, nome_responsavel: nome.trim(), client_id: d.client_id, convidar: false, com_link: true });
        aoMudar();
        aoPessoaCriada(pessoa(r.membro_id || ""), r.link || null, null);
        return;
      }
      if (d.tipo === "ativar") await casa.salvarConta(d.conta_id, { crm_ativo: true });
      const r = await central.convidar({ conta_id: d.conta_id, email, nome, papel });
      aoMudar();
      aoPessoaCriada(pessoa(r.membro_id), r.link, fraseDoExtra(r.extra, "crm"));
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível adicionar agora."));
      setSalvando(false);
    }
  };
  const adicionarCaixa = async () => {
    if (!dominio) return setErro("Escolha o domínio.");
    if (!endereco) return setErro("Escreva o endereço: letras, números, ponto ou hífen antes do @.");
    const p = problemaDaSenha(senha);
    if (p) return setErro(p);
    setSalvando(true);
    setErro(null);
    try {
      const r = await central.criarCaixa({ dominio_id: dominio.id, endereco, senha, pessoa });
      aoMudar();
      if (r.aviso) toast.warning(r.aviso);
      setCriada({ endereco: r.endereco, senha, extra: fraseDoExtra(r.extra, "email") });
    } catch (e) {
      setErro(fraseDoErro(e, "Não foi possível criar a caixa agora."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <JanelaCentral
      aberta
      onFechar={fechar}
      largura="md"
      titulo={criada ? "Caixa criada" : "Adicionar"}
      ajuda="Pessoa no CRM: entra como convite e você recebe o link de primeiro acesso para copiar, mandar no WhatsApp ou por e-mail. Caixa: nasce no Migadu com a senha escolhida, que fica guardada no cofre. Nas empresas ligadas a um cliente, o extra de CRM ou de e-mail acompanha no Financeiro."
      abaixoDoTitulo={
        criada ? undefined : (
          <PillTabs<"pessoa" | "caixa">
            label="O que adicionar"
            variant="soft"
            size="sm"
            value={o_que}
            onChange={(v) => {
              setOQue(v);
              setErro(null);
            }}
            tabs={[
              { value: "pessoa", label: "Pessoa no CRM", icon: <UserPlus className="h-4 w-4" aria-hidden="true" /> },
              { value: "caixa", label: "Caixa de e-mail", icon: <Mail className="h-4 w-4" aria-hidden="true" /> },
            ]}
          />
        )
      }
      rodape={
        criada ? (
          <button type="button" className={botao.primario} onClick={fechar}>Pronto</button>
        ) : (
          <>
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={fechar}>Cancelar</button>
            <button type="button" className={botao.primario} disabled={salvando} onClick={() => void (o_que === "pessoa" ? adicionarPessoa() : adicionarCaixa())} data-confirmar-adicionar={o_que}>
              {salvando ? "Salvando..." : o_que === "pessoa" ? "Adicionar e gerar link" : "Criar caixa"}
            </button>
          </>
        )
      }
      data-janela-adicionar={o_que}
    >
      {criada ? (
        <div className="min-w-0 space-y-3">
          {criada.extra && <Chip tone="info" size="sm">{criada.extra}</Chip>}
          <SenhaUmaVez rotulo={`Login: ${criada.endereco}`} senha={criada.senha} aviso="Guardada no cofre. Para ver de novo, use Mostrar senha na lista." />
        </div>
      ) : o_que === "pessoa" ? (
        <div className="min-w-0 space-y-4" data-form-pessoa="">
          {!opcoes.length ? (
            <EmptyState compact title={clientes.isLoading ? "Carregando os clientes..." : "Nenhum cliente no painel."} />
          ) : (
            <GrupoDeCampos colunas={2}>
              <CampoDeFormulario rotulo="Empresa">
                <select className={campo} value={contaId} onChange={(e) => { setContaId(e.target.value); setErro(null); }} data-escolher-empresa="">
                  <option value="">Escolha a empresa ou o cliente</option>
                  {opcoes.some((o) => o.grupo === "crm") && (
                    <optgroup label="Com CRM">
                      {opcoes.filter((o) => o.grupo === "crm").map((o) => (
                        <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                      ))}
                    </optgroup>
                  )}
                  {opcoes.some((o) => o.grupo === "clientes") && (
                    <optgroup label="Outros clientes">
                      {opcoes.filter((o) => o.grupo === "clientes").map((o) => (
                        <option key={o.valor} value={o.valor}>{o.rotulo}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Papel">
                <select className={campo} value={papel} onChange={(e) => setPapel(e.target.value as PapelNaConta)}>
                  {(["usuario", "gerente", "admin"] as PapelNaConta[]).map((p) => (
                    <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>
                  ))}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Nome">
                <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="E-mail de login">
                <input className={campo} type="email" value={emailDaPessoa} onChange={(e) => { setEmailDaPessoa(e.target.value); setErro(null); }} autoComplete="off" data-email-da-pessoa="" />
              </CampoDeFormulario>
            </GrupoDeCampos>
          )}
          {empresaNova && opcao && (
            <Chip tone="info" size="sm">
              {opcao.destino.tipo === "plano" ? "Liga o CRM pelo plano do cliente; a pessoa entra administrando" : "Cria a empresa no CRM ligada ao cliente; a pessoa entra administrando"}
            </Chip>
          )}
          {conta && conta.cobranca_por === "plano" && <Chip tone="info" size="sm">Cobrada no plano do cliente: o extra de CRM acompanha</Chip>}
          {conta && !conta.client_id && <LigarAoCliente conta={conta} aoLigar={aoMudar} />}
          {erro && <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">{erro}</p>}
        </div>
      ) : (
        <div className="min-w-0 space-y-4" data-form-caixa="">
          {!paraCaixa.length ? (
            <EmptyState compact title="Nenhum domínio no Migadu ainda." />
          ) : (
            <GrupoDeCampos colunas={2}>
              <CampoDeFormulario rotulo="Domínio">
                <select className={campo} value={dominioId} onChange={(e) => { setDominioId(e.target.value); setErro(null); }} data-escolher-dominio="">
                  <option value="">Escolha o domínio</option>
                  {paraCaixa.map((d) => (
                    <option key={d.id} value={d.id}>{d.dominio} ({d.empresa})</option>
                  ))}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Endereço">
                <span className="flex min-w-0 items-center">
                  <input className={juntar(campo, "min-w-0 flex-1")} value={parte} onChange={(e) => { setParte(e.target.value); setErro(null); }} autoComplete="off" placeholder="nome" data-parte-do-endereco="" />
                  <span className={juntar(texto.auxiliar, "ml-2 max-w-[50%] truncate")}>@{dominio ? dominio.dominio : "dominio"}</span>
                </span>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="De quem é">
                <input className={campo} value={pessoa} onChange={(e) => setPessoa(e.target.value)} autoComplete="off" />
              </CampoDeFormulario>
              <CampoDeSenha valor={senha} aoMudar={(v) => { setSenha(v); setErro(null); }} />
            </GrupoDeCampos>
          )}
          {contaDaCaixa && !contaDaCaixa.client_id && <LigarAoCliente conta={contaDaCaixa} aoLigar={aoMudar} />}
          {erro && <p className={juntar(texto.auxiliar, "text-destructive")} role="alert">{erro}</p>}
        </div>
      )}
    </JanelaCentral>
  );
}
