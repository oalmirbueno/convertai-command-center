import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Inbox, Lock, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { abrirPorta, carregarMinhasCaixas, portaAberta } from "@/lib/produto/email-central";
import { quemSouNoCorreio } from "@/lib/produto/correio-dia";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { Carregando, EstadoDeErro, EstadoVazio, botao, campo, etiqueta, foco, juntar, texto } from "@/components/sistema";
import CaixaPorPrioridade from "@/components/correio/CaixaPorPrioridade";
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
  const [liberado, setLiberado] = useState(() => (user ? portaAberta(user.id) : false));

  useEffect(() => {
    const antes = document.title;
    document.title = "Correio | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  if (!user) return null;
  if (!liberado) {
    return (
      <div className="flex min-h-[100dvh] min-w-0 flex-col bg-muted/40 text-foreground" data-correio="">
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
  return <CorreioAberto />;
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
        className="w-full max-w-[400px] rounded-3xl bg-card p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <div className="mb-5 flex items-center">
          <MarcaAceleriq altura={20} />
          <span className={juntar(texto.corpo, "ml-3 font-medium")}>Correio</span>
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

function CorreioAberto() {
  const [busca, setBusca] = useSearchParams();
  const pedida = busca.get("area") || "";
  const area: Area = AREAS.some((a) => a.id === pedida) ? (pedida as Area) : "caixa";
  const minhas = useQuery({ queryKey: ["produto", "correio", "caixas"], queryFn: carregarMinhasCaixas, retry: 1 });
  const eu = useQuery({ queryKey: ["produto", "correio", "eu"], queryFn: quemSouNoCorreio, retry: 1 });
  const [escolhida, setEscolhida] = useState<string | null>(null);
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
  if (minhas.isLoading || eu.isLoading) corpo = <div className="rounded-3xl bg-card p-5"><Carregando linhas={5} rotulo="Abrindo o correio" /></div>;
  else if (minhas.isError || !d) corpo = <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void minhas.refetch()}>Tentar de novo</button>} />;
  else if (!d.conta) corpo = <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Você ainda não tem uma caixa" descricao="O correio é das empresas com e-mail profissional na Aceleriq." acao={<Link to="/email" className={botao.primario}>Conhecer o e-mail profissional</Link>} />;
  else if (!d.liberado) corpo = <EstadoVazio icone={<Lock className="h-5 w-5" aria-hidden="true" />} titulo="O e-mail da empresa não está liberado" descricao="Fale com quem administra a empresa." />;
  else if (area === "campanhas") corpo = <CampanhasDoCorreio />;
  else if (area === "ferramentas") corpo = <FerramentasDoCorreio />;
  else if (area === "dia") corpo = euNoCorreio ? <MeuDia caixa={caixa} eu={euNoCorreio} nome={euNoCorreio.nome} /> : <EstadoVazio titulo="Seu acesso ainda não está ligado a esta empresa." />;
  else if (!caixa) corpo = <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Nenhuma caixa ligada a você" descricao={d.master ? "As caixas aparecem aqui quando a migração criar as primeiras." : "Peça para quem administra a empresa ligar a sua caixa ao seu acesso."} />;
  else if (area === "quadro") corpo = <QuadroDaCaixa key={caixa.id} caixa={caixa} />;
  else corpo = <CaixaPorPrioridade key={caixa.id} caixa={caixa} eu={euNoCorreio} />;

  return (
    <div className="min-h-[100dvh] min-w-0 bg-muted/40 text-foreground" data-correio={area}>
      <div className="mx-auto min-w-0 max-w-[1600px] space-y-4 p-4 sm:p-5">
        <header className="flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-3">
          <div className="flex h-12 items-center rounded-full bg-card pl-4 pr-5">
            <MarcaAceleriq altura={18} />
            <span className={juntar(texto.corpo, "ml-2.5 font-semibold")}>Correio</span>
          </div>
          <nav className="flex min-w-0 flex-wrap rounded-full bg-card p-1" aria-label="Áreas do correio">
            {AREAS.map((a) => (
              <button key={a.id} type="button" onClick={() => irPara(a.id)} aria-current={a.id === area ? "page" : undefined} className={juntar("h-10 rounded-full px-4 text-[14px] font-medium", foco, a.id === area ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")} data-area-do-correio={a.id}>
                {a.nome}
              </button>
            ))}
          </nav>
          {d && d.caixas.length > 0 && (
            <label className="flex h-12 min-w-0 flex-1 basis-[220px] items-center rounded-full bg-card px-4">
              <Inbox className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Caixa</span>
              <select value={caixa ? caixa.id : ""} onChange={(e) => setEscolhida(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" data-caixas-do-correio="">
                {d.caixas.map((c) => (
                  <option key={c.id} value={c.id}>{c.endereco}{c.minha ? "" : c.dono ? ` (${c.dono})` : ""}{c.ligado ? "" : " · em preparação"}</option>
                ))}
              </select>
              {d.master && (
                <span className={juntar(etiqueta, "ml-2 shrink-0 bg-accent-soft text-primary")} title="Você vê todas as caixas da empresa">
                  <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                  Master
                </span>
              )}
            </label>
          )}
          <Link to="/app/email" className={juntar("flex h-12 w-12 items-center justify-center rounded-full bg-card hover:bg-muted", foco)} aria-label="Voltar ao painel" title="Voltar ao painel">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
        </header>
        {corpo}
      </div>
    </div>
  );
}
