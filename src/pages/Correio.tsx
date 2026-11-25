import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Inbox, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { abrirPorta, carregarMinhasCaixas, correio, portaAberta, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { quemSouNoCorreio } from "@/lib/produto/correio-dia";
import LogoDoCorreio from "@/components/correio/LogoDoCorreio";
import { BotaoInstalarCorreio, SaidaDoCorreio } from "@/components/correio/NavegacaoDoCorreio";
import { BotaoDoTema, useTemaDoCorreio, type TemaDoCorreio } from "@/components/correio/TemaDoCorreio";
import { useTrocaDeAcesso } from "@/components/produto/TrocaDeAcesso";
import { useProduto } from "@/hooks/useProduto";
import { usePwaProfile } from "@/hooks/usePwaProfile";
import { Carregando, EstadoDeErro, EstadoVazio, botao, campo, etiqueta, foco, juntar, texto } from "@/components/sistema";
import CaixaPorPrioridade from "@/components/correio/CaixaPorPrioridade";
import "@/components/correio/correio-tema.css";
import { CampanhasDoCorreio, FerramentasDoCorreio, MeuDia, QuadroDaCaixa } from "@/components/correio/AreasDoCorreio";

/**
 * O correio do cliente (endereço /correio), separado do painel e do CRM: abre por um link próprio e
 * pede a senha de novo ao entrar. Cinco áreas: a caixa por prioridade, o quadro, o dia (agenda e
 * tarefas), as campanhas e as ferramentas. Cada pessoa vê a própria caixa; o master vê todas.
 */

type Area = "caixa" | "quadro" | "dia" | "campanhas" | "ferramentas";
const AREAS: Array<{ id: Area; nome: string }> = [
  { id: "caixa", nome: "Caixa" },
  { id: "quadro", nome: "Quadro" },
  { id: "dia", nome: "Meu dia" },
  { id: "campanhas", nome: "Campanhas" },
  { id: "ferramentas", nome: "Ferramentas" },
];

export default function Correio() {
  const { user } = useAuth();
  // App próprio: quem instala daqui ganha o "Correio" com o ícone do envelope (public/correio.webmanifest).
  usePwaProfile({ manifestHref: "/correio.webmanifest", appleTitle: "Correio", appleIcon: "/correio-apple-touch-icon.png" });
  const [liberado, setLiberado] = useState(() => (user ? portaAberta(user.id) : false));

  useEffect(() => {
    const antes = document.title;
    document.title = "Correio | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  // Claro por padrão e escuro no botão do topo (TemaDoCorreio); a escolha do painel não muda o Correio.
  const tema = useTemaDoCorreio();

  if (!user) return null;
  if (!liberado) {
    return (
      <div className="correio-tema flex min-h-[100dvh] min-w-0 flex-col text-foreground" data-correio="">
        <Porta
          email={user.email || ""}
          aoAbrir={() => {
            abrirPorta(user.id);
            setLiberado(true);
          }}
        />
      </div>
    );
  }
  return <CorreioAberto tema={tema.tema} aoAlternarTema={tema.alternar} />;
}

/** A senha de novo, mesmo já logado: o e-mail não abre só porque o painel ficou aberto no computador. */
function Porta({ email, aoAbrir }: { email: string; aoAbrir: () => void }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [conferindo, setConferindo] = useState(false);
  const entrar = async () => {
    if (!senha) return;
    setConferindo(true);
    setErro("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) setErro("Senha incorreta.");
      else aoAbrir();
    } catch {
      setErro("Não foi possível conferir agora. Tente de novo.");
    } finally {
      setConferindo(false);
    }
  };
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-10" data-porta-do-correio="">
      <form
        className="w-full max-w-[400px] rounded-lg bg-card p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <div className="mb-5 flex items-center">
          <LogoDoCorreio tamanho={34} />
        </div>
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className={texto.tituloSecao}>Confirme a sua senha</h1>
        <p className={juntar(texto.auxiliar, "mb-4 mt-1")}>O correio pede a senha de novo ao abrir. {email}</p>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={campo} autoComplete="current-password" autoFocus aria-label="Senha" data-campo="senha-do-correio" />
        {erro && <p className="mt-2 text-[13px] text-destructive" role="alert">{erro}</p>}
        <button type="submit" className={juntar(botao.primario, "mt-4 w-full")} disabled={conferindo || !senha}>{conferindo ? "Conferindo..." : "Abrir o correio"}</button>
      </form>
    </main>
  );
}

/**
 * Ligar a caixa ao painel (19/11/2026): quem administra a empresa digita a senha da caixa uma vez.
 * Ela vai direto para o cofre (Vault) pela função produto-correio e nunca volta para a tela.
 */
function ConectarCaixa({ caixa, aoConectar }: { caixa: CaixaDoCorreio; aoConectar: () => void }) {
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const conectar = async () => {
    if (senha.length < 6) return setErro("Digite a senha da caixa.");
    setSalvando(true);
    setErro("");
    try {
      await correio.guardarSegredo(caixa.id, senha);
      setSenha("");
      // Confere na hora: lista a entrada. Se a senha estiver errada, o provedor avisa.
      await correio.listar(caixa.id, "INBOX");
      aoConectar();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível conectar agora.");
      aoConectar();
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="mx-auto max-w-[520px] rounded-lg bg-card p-6" data-conectar-caixa="">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <KeyRound className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className={juntar(texto.tituloSecao, "mt-4")}>Conectar {caixa.endereco}</h2>
      <p className={juntar(texto.corpo, "mt-1 text-muted-foreground")}>
        Digite a senha desta caixa (a mesma do webmail). Ela fica guardada no cofre e nunca aparece de novo na tela. Se trocar a senha no provedor, conecte de novo aqui.
      </p>
      <label className="mt-5 block">
        <span className={juntar(texto.auxiliar, "mb-1.5 block")}>Senha da caixa</span>
        <span className="flex min-w-0 items-center">
          <input type={ver ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void conectar()} className={juntar(campo, "min-w-0 flex-1")} autoComplete="off" data-senha-da-caixa="" />
          <button type="button" className={juntar(botao.discreto, "ml-2 h-9")} onClick={() => setVer((v) => !v)} aria-pressed={ver}>
            {ver ? "Ocultar" : "Mostrar"}
          </button>
        </span>
      </label>
      {erro && <p className={juntar(texto.auxiliar, "mt-3 text-destructive")} role="alert">{erro}</p>}
      <button type="button" className={juntar(botao.primario, "mt-5 w-full")} onClick={() => void conectar()} disabled={salvando || !senha} data-conectar="">
        {salvando ? "Conectando..." : "Conectar a caixa"}
      </button>
    </div>
  );
}

/** A caixa aberta e a troca de caixa: um menu com cada endereço, de quem é e se já está ligada. */
function SeletorDeCaixa({ caixas, atual, master, aoEscolher }: { caixas: CaixaDoCorreio[]; atual: CaixaDoCorreio; master: boolean; aoEscolher: (id: string) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" className={juntar("flex h-11 min-w-0 max-w-full items-center rounded-lg bg-muted pl-2 pr-3 hover:bg-muted/70 sm:w-[300px]", foco)} aria-label={`Caixa aberta: ${atual.endereco}. Trocar de caixa`} data-caixas-do-correio="">
          <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-[12px] font-semibold text-background" aria-hidden="true">{atual.endereco.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[14px] font-semibold leading-5">{atual.endereco}</span>
            <span className="block truncate text-[12px] leading-4 text-muted-foreground">{atual.ligado ? (atual.minha ? "Sua caixa" : atual.dono ? `De ${atual.dono}` : "Caixa da empresa") : "Falta conectar"}</span>
          </span>
          {caixas.length > 1 && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] rounded-lg p-2">
        <div className="flex items-center px-3 pb-2 pt-1.5">
          <span className={juntar(texto.auxiliar, "flex-1 font-semibold")}>Caixas</span>
          {master && (
            <span className={juntar(etiqueta, "bg-muted text-foreground")} title="Você administra a empresa e vê todas as caixas">
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              Você vê todas
            </span>
          )}
        </div>
        <ul className="space-y-1" role="listbox" aria-label="Escolher a caixa">
          {caixas.map((c) => {
            const ativa = c.id === atual.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={ativa}
                  onClick={() => {
                    aoEscolher(c.id);
                    setAberto(false);
                  }}
                  className={juntar("flex w-full min-w-0 items-center rounded-lg p-2.5 text-left", foco, ativa ? "bg-muted" : "hover:bg-muted/60")}
                  data-caixa-opcao={c.endereco}
                >
                  <span className={juntar("mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold", ativa ? "bg-foreground text-background" : "bg-muted text-foreground")} aria-hidden="true">{c.endereco.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{c.endereco}</span>
                    <span className="flex items-center text-[12px] text-muted-foreground">
                      <i className={juntar("mr-1.5 h-1.5 w-1.5 rounded-full", c.ligado ? "bg-success" : "bg-warning")} aria-hidden="true" />
                      {c.ligado ? (c.minha ? "Sua caixa" : c.dono ? `De ${c.dono}` : "Da empresa") : "Falta conectar"}
                    </span>
                  </span>
                  {ativa && <Check className="ml-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CorreioAberto({ tema, aoAlternarTema }: { tema: TemaDoCorreio; aoAlternarTema: () => void }) {
  const [busca, setBusca] = useSearchParams();
  const pedida = busca.get("area") || "";
  const area: Area = AREAS.some((a) => a.id === pedida) ? (pedida as Area) : "caixa";
  const minhas = useQuery({ queryKey: ["produto", "correio", "caixas"], queryFn: carregarMinhasCaixas, retry: 1 });
  const eu = useQuery({ queryKey: ["produto", "correio", "eu"], queryFn: quemSouNoCorreio, retry: 1 });
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const produto = useProduto();
  const troca = useTrocaDeAcesso();
  const irPara = (a: Area) => {
    const nova = new URLSearchParams(busca);
    if (a === "caixa") nova.delete("area");
    else nova.set("area", a);
    setBusca(nova, { replace: true });
  };

  const d = minhas.data;
  const caixa = d ? d.caixas.filter((c) => c.id === escolhida)[0] || d.caixas[0] || null : null;
  const euNoCorreio = d && d.liberado ? eu.data || null : null;

  let corpo;
  if (minhas.isLoading || eu.isLoading) corpo = <div className="rounded-lg bg-card p-5"><Carregando linhas={5} rotulo="Abrindo o correio" /></div>;
  else if (minhas.isError || !d) corpo = <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void minhas.refetch()}>Tentar de novo</button>} />;
  else if (!d.conta && produto.data && produto.data.crm_da_empresa) corpo = <EstadoVazio icone={<KeyRound className="h-5 w-5" aria-hidden="true" />} titulo={`${produto.data.crm_da_empresa.nome} tem e-mail profissional`} descricao="O Correio abre com o usuário de cada pessoa, e não com o login geral do painel." acao={<button type="button" className={juntar(botao.primario, "correio-botao-forte")} onClick={() => troca.abrir("correio")} data-entrar-com-meu-usuario="">Entrar com o meu usuário</button>} />;
  else if (!d.conta) corpo = <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Você ainda não tem uma caixa" descricao="O correio é das empresas com e-mail profissional na Aceleriq." acao={<Link to="/email" className={botao.primario}>Conhecer o e-mail profissional</Link>} />;
  else if (!d.liberado) corpo = <EstadoVazio icone={<Lock className="h-5 w-5" aria-hidden="true" />} titulo="O e-mail da empresa não está liberado" descricao="Fale com quem administra a empresa." />;
  else if (area === "campanhas") corpo = <CampanhasDoCorreio key={caixa ? caixa.id : ""} caixa={caixa} />;
  else if (area === "ferramentas") corpo = <FerramentasDoCorreio caixas={d.caixas} master={d.master} aoIr={(x) => irPara(x as Area)} />;
  else if (area === "dia") corpo = euNoCorreio ? <MeuDia caixa={caixa} eu={euNoCorreio} nome={euNoCorreio.nome} /> : <EstadoVazio titulo="Seu acesso ainda não está ligado a esta empresa." />;
  else if (!caixa) corpo = <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Nenhuma caixa ligada a você" descricao={d.master ? "As caixas aparecem aqui quando a migração criar as primeiras." : "Peça para quem administra a empresa ligar a sua caixa ao seu acesso."} />;
  else if (!caixa.ligado && d.master) corpo = <ConectarCaixa key={caixa.id} caixa={caixa} aoConectar={() => void minhas.refetch()} />;
  else if (area === "quadro") corpo = <QuadroDaCaixa key={caixa.id} caixa={caixa} eu={euNoCorreio} />;
  else corpo = <CaixaPorPrioridade key={caixa.id} caixa={caixa} eu={euNoCorreio} />;

  return (
    <div className="correio-tema min-h-[100dvh] min-w-0 text-foreground" data-correio={area}>
      <div className="mx-auto min-w-0 max-w-[1680px] space-y-4 p-3 sm:p-4">
        <header className="flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2 rounded-lg bg-card p-2" data-topo-do-correio="">
          <SaidaDoCorreio />
          <span className="flex h-11 shrink-0 items-center pl-1 pr-2" aria-label="Correio da Aceleriq"><LogoDoCorreio tamanho={34} className="max-sm:[&>.logo-do-topo]:hidden max-sm:[&>i]:hidden" /></span>
          <nav className="flex min-w-0 flex-1 [&>*]:mr-1 [&>*:last-child]:mr-0 overflow-x-auto max-md:order-last max-md:basis-full" aria-label="Áreas do correio">
            {AREAS.map((a) => (
              <button key={a.id} type="button" onClick={() => irPara(a.id)} aria-current={a.id === area ? "page" : undefined} className={juntar("h-10 shrink-0 rounded-lg px-4 text-[14px] font-medium", foco, a.id === area ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")} data-area-do-correio={a.id}>
                {a.nome}
              </button>
            ))}
          </nav>
          <BotaoInstalarCorreio />
          <BotaoDoTema tema={tema} aoAlternar={aoAlternarTema} />
          {d && d.caixas.length > 0 && caixa && <SeletorDeCaixa caixas={d.caixas} atual={caixa} master={d.master} aoEscolher={setEscolhida} />}
        </header>
        {corpo}
      </div>
      {troca.janela}
    </div>
  );
}
