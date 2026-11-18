import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Inbox, Lock, PenSquare, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import { abrirPorta, carregarMinhasCaixas, correio, correioDesligado, portaAberta, type CaixaDoCorreio, type ResumoDaMensagem } from "@/lib/produto/email-central";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import { CampoDeBusca, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, botao, campo, campoTexto, etiqueta, foco, juntar, lista, texto } from "@/components/sistema";

/**
 * O correio do cliente (endereço /correio), separado do painel e do CRM: abre por um link próprio e
 * pede a senha de novo ao entrar. Cada pessoa vê a própria caixa; o master (quem administra a empresa
 * ou quem recebeu a marca) vê todas. Sem provedor contratado, a caixa aparece "em preparação".
 */
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
  return (
    <div className="flex min-h-[100dvh] min-w-0 flex-col bg-background text-foreground" data-correio="">
      <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <MarcaAceleriq altura={20} />
        <span className={juntar(texto.corpo, "ml-3 font-medium")}>Correio</span>
        <span className="flex-1" />
        <Link to="/app/email" className={juntar(botao.icone, foco)} aria-label="Voltar ao painel" title="Voltar ao painel">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>
      {liberado ? (
        <CaixasDoCorreio />
      ) : (
        <Porta
          email={user.email || ""}
          aoAbrir={() => {
            abrirPorta(user.id);
            setLiberado(true);
          }}
        />
      )}
    </div>
  );
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
        className="w-full max-w-[380px]"
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className={texto.tituloPagina}>Confirme a sua senha</h1>
        <p className={juntar(texto.auxiliar, "mb-4 mt-1")}>O correio pede a senha de novo ao abrir. {email}</p>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={campo} autoComplete="current-password" autoFocus aria-label="Senha" data-campo="senha-do-correio" />
        {erro && <p className="mt-2 text-[13px] text-destructive" role="alert">{erro}</p>}
        <button type="submit" className={juntar(botao.primario, "mt-4 w-full")} disabled={conferindo || !senha}>{conferindo ? "Conferindo..." : "Abrir o correio"}</button>
      </form>
    </main>
  );
}

function CaixasDoCorreio() {
  const minhas = useQuery({ queryKey: ["produto", "correio", "caixas"], queryFn: carregarMinhasCaixas, retry: 1 });
  const [escolhida, setEscolhida] = useState<string | null>(null);
  if (minhas.isLoading) return <div className="p-6"><Carregando linhas={5} rotulo="Abrindo o correio" /></div>;
  if (minhas.isError || !minhas.data) return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void minhas.refetch()}>Tentar de novo</button>} />;
  const d = minhas.data;
  if (!d.conta) return <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Você ainda não tem uma caixa" descricao="O correio é das empresas com e-mail profissional na Aceleriq." acao={<Link to="/email" className={botao.primario}>Conhecer o e-mail profissional</Link>} />;
  if (!d.liberado) return <EstadoVazio icone={<Lock className="h-5 w-5" aria-hidden="true" />} titulo="O e-mail da empresa não está liberado" descricao="Fale com quem administra a empresa." />;
  if (!d.caixas.length) return <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Nenhuma caixa ligada a você" descricao={d.master ? "As caixas aparecem aqui quando a migração criar as primeiras." : "Peça para quem administra a empresa ligar a sua caixa ao seu acesso."} />;
  const caixa = d.caixas.filter((c) => c.id === escolhida)[0] || d.caixas[0];
  const minhasCaixas = d.caixas.filter((c) => c.minha);
  const outras = d.caixas.filter((c) => !c.minha);
  const grupo = (titulo: string, itens: CaixaDoCorreio[]) =>
    itens.length > 0 && (
      <div className="mb-4 min-w-0">
        <p className={juntar(texto.auxiliar, "mb-1 px-2")}>{titulo}</p>
        <ul>
          {itens.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setEscolhida(c.id)} aria-pressed={c.id === caixa.id} className={juntar("flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left", foco, c.id === caixa.id ? "bg-muted" : "hover:bg-muted/60")} data-caixa-do-correio={c.ligado ? "ligada" : "desligada"}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{c.endereco}</span>
                  {(c.dono || c.pessoa) && <span className={juntar(texto.auxiliar, "block truncate")}>{c.dono || c.pessoa}</span>}
                </span>
                {!c.ligado && <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" title="Em preparação" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <aside className="min-w-0 shrink-0 border-b border-border p-3 md:w-[280px] md:border-b-0 md:border-r" data-caixas-do-correio="">
        <p className={juntar(texto.corpo, "mb-3 flex min-w-0 items-center px-2 font-medium")}>
          <span className="truncate">{d.conta.nome}</span>
          {d.master && (
            <span className={juntar(etiqueta, "ml-2 bg-accent-soft text-primary")} title="Você vê todas as caixas da empresa">
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              Master
            </span>
          )}
        </p>
        {grupo(outras.length ? "Minhas caixas" : "Caixas", minhasCaixas)}
        {grupo("Todas da empresa", outras)}
      </aside>
      <CaixaAberta key={caixa.id} caixa={caixa} />
    </div>
  );
}

function CaixaAberta({ caixa }: { caixa: CaixaDoCorreio }) {
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<ResumoDaMensagem | null>(null);
  const [escrevendo, setEscrevendo] = useState(false);
  const mensagens = useQuery({ queryKey: ["produto", "correio", "mensagens", caixa.id, busca], queryFn: () => correio.listar(caixa.id, "INBOX", busca || undefined), enabled: caixa.ligado, retry: 0 });
  const lida = useQuery({ queryKey: ["produto", "correio", "mensagem", caixa.id, aberta ? aberta.id : ""], queryFn: () => correio.ler(caixa.id, "INBOX", aberta!.id), enabled: caixa.ligado && !!aberta, retry: 0 });

  const emPreparo = !caixa.ligado || (mensagens.isError && correioDesligado(mensagens.error));
  if (emPreparo) {
    return (
      <main className="min-w-0 flex-1 p-4" data-correio-em-preparo="">
        <EstadoVazio
          icone={<Inbox className="h-5 w-5" aria-hidden="true" />}
          titulo={`${caixa.endereco} está em preparação`}
          descricao="A leitura e o envio por aqui entram em seguida. Enquanto isso, use o webmail do provedor com o mesmo endereço e senha."
          acao={<a href="https://mail.zoho.com" target="_blank" rel="noreferrer" className={botao.primario}>Abrir o webmail</a>}
        />
      </main>
    );
  }
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row" data-caixa-aberta="">
      <section className="min-w-0 border-b border-border lg:w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex min-w-0 items-center border-b border-border p-3">
          <span className="min-w-0 flex-1">
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar" rotulo="Buscar nesta caixa" />
          </span>
          <button type="button" className={juntar(botao.icone, "ml-2")} onClick={() => void mensagens.refetch()} aria-label="Atualizar" title="Atualizar">
            <RefreshCw className={juntar("h-4 w-4", mensagens.isFetching && "animate-spin")} aria-hidden="true" />
          </button>
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setEscrevendo(true)} aria-label="Escrever" title="Escrever">
            <PenSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          </button>
        </div>
        {mensagens.isLoading ? (
          <div className="p-3"><Carregando linhas={6} rotulo="Lendo a caixa" /></div>
        ) : mensagens.isError ? (
          <EstadoDeErro titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void mensagens.refetch()}>Tentar de novo</button>} />
        ) : !(mensagens.data || []).length ? (
          <EstadoVazio compacto className="m-3" titulo="Nada por aqui." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-mensagens-do-correio="">
            {(mensagens.data || []).map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setAberta(m)} aria-pressed={!!aberta && aberta.id === m.id} className={juntar(lista.linha, "w-full items-start text-left", aberta && aberta.id === m.id && lista.destaque)}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate", !m.lida && "font-medium")}>{m.de}</span>
                    <span className={juntar(texto.corpo, "block truncate", !m.lida && "font-medium")}>{m.assunto}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{m.resumo}</span>
                  </span>
                  {m.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(m.recebida_em)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="min-w-0 flex-1 p-4" data-leitura-do-correio="">
        {!aberta ? (
          <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Escolha uma mensagem" />
        ) : lida.isLoading ? (
          <Carregando linhas={8} rotulo="Abrindo a mensagem" />
        ) : lida.isError || !lida.data ? (
          <EstadoDeErro titulo={fraseDoErro(lida.error, "Não foi possível abrir a mensagem.")} />
        ) : (
          <article className="min-w-0">
            <h2 className="text-[18px] font-semibold leading-6">{lida.data.assunto}</h2>
            <p className={juntar(texto.auxiliar, "mt-1")}>{lida.data.de} para {lida.data.para}{lida.data.recebida_em ? ` · ${diaLegivel(lida.data.recebida_em, true)}` : ""}</p>
            <div className={juntar(texto.corpo, "mt-4 whitespace-pre-wrap break-words leading-6")}>{lida.data.texto}</div>
            {lida.data.anexos.length > 0 && <p className={juntar(texto.auxiliar, "mt-4")}>Anexos: {lida.data.anexos.map((a) => a.nome).join(", ")}. Para baixar, abra no webmail.</p>}
          </article>
        )}
      </section>
      {escrevendo && <Escrever caixa={caixa} onFechar={() => setEscrevendo(false)} />}
    </main>
  );
}

function Escrever({ caixa, onFechar }: { caixa: CaixaDoCorreio; onFechar: () => void }) {
  const [f, setF] = useState({ para: "", assunto: "", texto: "" });
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      await correio.enviar(caixa.id, f);
      toast.success("Enviado.");
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível enviar."));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="md"
      titulo="Nova mensagem"
      descricao={`De ${caixa.endereco}`}
      rodape={
        <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || !f.para.trim()}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {enviando ? "Enviando..." : "Enviar"}
        </button>
      }
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="Para" apoio="Separe com vírgula">
          <input value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })} className={campo} inputMode="email" autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Assunto">
          <input value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} className={campo} maxLength={200} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Mensagem">
          <textarea value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} className={juntar(campoTexto, "min-h-[220px]")} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
