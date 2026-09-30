import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import PropostaDocumento, { itensDoIndice } from "@/components/mesa-proposta/PropostaDocumento";
import "@/components/mesa-proposta/proposta-documento.css";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import {
  dataCurta,
  diaValido,
  ehStatus,
  hojeEmSaoPaulo,
  motivoParaNaoAceitar,
  normalizarConteudo,
  normalizarItens,
  reais,
  statusEfetivo,
  totaisDosItens,
  validarAceite,
} from "../../supabase/functions/_shared/proposta-modelo";
import { ehNivel, normalizarPagamento, resumoDosPacotes, textoDaOpcao, type NivelDoPacote, type ResumoDoPacote, type OpcaoDePagamento } from "../../supabase/functions/_shared/proposta-comercial";

/**
 * /proposta/:token (frente PRO): a proposta que o cliente abre pelo link,
 * sem login. Página vertical, feita para o celular, com o aceite no fim
 * (nome, e-mail e a caixa) e "Baixar PDF" pela impressão do navegador (A4
 * vertical, sem biblioteca pesada).
 *
 * Frente PRO2: índice no topo, páginas que entram com um fade leve ao rolar
 * (sem animação para quem pede menos movimento e em navegador sem
 * IntersectionObserver), barra fixa com "Aceitar agora" e o WhatsApp da
 * agência, e no aceite a escolha do pacote e da forma de pagamento.
 *
 * Rastreio: ao abrir, uma sessão (guardada nesta aba) avisa a função; a cada
 * 15 s com a página à vista, o tempo de leitura sobe na mesma linha. Nada de
 * dado pessoal no endereço: o token é o único parâmetro.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proposta-publica`;
const CHAVE_API = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PASSO_MS = 15_000;
/** Função lenta: depois disto, a tela oferece "Tentar de novo" (a resposta que chegar depois ainda abre). */
const ESPERA_MAXIMA_MS = 20_000;

/**
 * lendo, pronto; invalido = o servidor disse que o link não existe
 * (error "link_invalido"); falhou = qualquer outra coisa (rede do celular,
 * função lenta ou fora do ar, 5xx, 401, resposta sem proposta). O 404 do
 * gateway (função não publicada) é falha nossa, não link ruim: por isso a
 * decisão é pelo corpo, não só pelo status.
 */
type Fase = "lendo" | "invalido" | "falhou" | "pronto";

type Publica = {
  id: string;
  numero: string;
  titulo: string;
  status: string;
  validade_ate: string | null;
  enviada_em: string | null;
  conteudo: unknown;
  itens: unknown;
  cliente: string;
  aceite: { nome?: string; em?: string } | null;
  pacotes?: unknown;
  pagamento?: unknown;
  visual?: unknown;
  anexos?: Array<{ id: string; titulo: string; url: string }>;
  pacote_aceito?: string | null;
};

type Agencia = { nome?: string; site?: string; email?: string; whatsapp?: string; instagram?: string };

function sessaoDaAba(token: string): string {
  const chave = `proposta:sessao:${token.slice(0, 16)}`;
  try {
    const guardada = window.sessionStorage.getItem(chave);
    if (guardada && guardada.length >= 8) return guardada;
  } catch {
    /* sem armazenamento: sessão nova */
  }
  const nova = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  try {
    window.sessionStorage.setItem(chave, nova);
  } catch {
    /* segue sem guardar */
  }
  return nova;
}

function enviarRastreio(corpo: Record<string, unknown>, aoSair = false) {
  try {
    void fetch(FN_URL, { method: "POST", keepalive: aoSair, headers: { "Content-Type": "application/json", apikey: CHAVE_API }, body: JSON.stringify(corpo) }).catch(() => undefined);
  } catch {
    /* rastreio nunca atrapalha a leitura */
  }
}

/** Número do WhatsApp da agência para o wa.me (só dígitos, com o 55 quando faltar). */
export function whatsDaAgencia(telefone: string | undefined): string {
  const d = String(telefone || "").replace(/[^\d]/g, "");
  if (d.length < 10) return "";
  return d.length <= 11 ? `55${d}` : d;
}

function FormularioDeAceite({
  token,
  pacotes,
  opcoes,
  totaisDoPacote,
  pacote,
  onPacote,
  onAceito,
}: {
  token: string;
  pacotes: ResumoDoPacote[];
  opcoes: OpcaoDePagamento[];
  totaisDoPacote: ReturnType<typeof totaisDosItens>;
  pacote: NivelDoPacote | null;
  onPacote: (n: NivelDoPacote) => void;
  onAceito: (nome: string, em: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [aceito, setAceito] = useState(false);
  const [pagamento, setPagamento] = useState<string>(opcoes.length === 1 ? opcoes[0].id : "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aceitar = async () => {
    const problema = validarAceite({ nome, email, aceito }) || (pacotes.length && !pacote ? "Escolha um dos pacotes." : null) || (opcoes.length > 1 && !pagamento ? "Escolha a forma de pagamento." : null);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const corpo: Record<string, unknown> = { nome: nome.trim(), email: email.trim(), aceito: true };
      if (pacotes.length && pacote) corpo.pacote = pacote;
      if (opcoes.length && pagamento) corpo.pagamento = pagamento;
      const r = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CHAVE_API },
        body: JSON.stringify({ token, aceitar: corpo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.mensagem || "Não foi possível registrar o aceite agora. Tente de novo.");
      onAceito(nome.trim(), d.aceita_em || new Date().toISOString());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o aceite agora.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form
      id="pd-aceite"
      className="pd-aceite"
      onSubmit={(e) => {
        e.preventDefault();
        void aceitar();
      }}
      aria-label="Aceitar a proposta"
    >
      {pacotes.length ? (
        <fieldset className="pd-escolha">
          <legend>Qual pacote?</legend>
          {pacotes.map((p) => (
            <label key={p.nivel}>
              <input type="radio" name="pacote" value={p.nivel} checked={pacote === p.nivel} onChange={() => onPacote(p.nivel)} />
              <span>
                {p.nome}
                {p.destaque ? " (recomendado)" : ""}: {[p.totais.unico > 0 ? reais(p.totais.unico) : "", p.totais.mensal > 0 ? `${reais(p.totais.mensal)} por mês` : ""].filter(Boolean).join(" + ")}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {opcoes.length > 1 ? (
        <fieldset className="pd-escolha">
          <legend>Forma de pagamento</legend>
          {opcoes.map((op) => (
            <label key={op.id}>
              <input type="radio" name="pagamento" value={op.id} checked={pagamento === op.id} onChange={() => setPagamento(op.id)} />
              <span>{textoDaOpcao(op, totaisDoPacote)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label htmlFor="aceite-nome">Seu nome completo</label>
      <input id="aceite-nome" type="text" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} />
      <label htmlFor="aceite-email">Seu e-mail</label>
      <input id="aceite-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
      <label className="pd-aceite-caixa">
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
        <span>Li a proposta e aceito o escopo, o investimento e as condições. Registramos nome, e-mail, data, IP e navegador como prova do aceite.</span>
      </label>
      {erro ? (
        <p className="pd-erro" role="alert">
          {erro}
        </p>
      ) : null}
      <button type="submit" className="pd-botao" disabled={enviando}>
        {enviando ? "Registrando..." : "Aceitar proposta"}
      </button>
    </form>
  );
}

/** Fade leve ao rolar: só com IntersectionObserver e sem "reduzir movimento". */
function useEntradaSuave(ativo: boolean): boolean {
  const [ligado, setLigado] = useState(false);
  useEffect(() => {
    if (!ativo || typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const reduz = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduz) setLigado(true);
  }, [ativo]);
  // Depois do desenho com as classes: observa as páginas e revela ao entrar na tela.
  useEffect(() => {
    if (!ligado) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("pd-visivel");
            obs.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    Array.prototype.slice.call(document.querySelectorAll(".pd-revela")).forEach((el: Element) => obs.observe(el));
    return () => obs.disconnect();
  }, [ligado]);
  return ligado;
}

export default function PropostaPublica() {
  const { token = "" } = useParams<{ token: string }>();
  const [fase, setFase] = useState<Fase>("lendo");
  const [p, setP] = useState<Publica | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [agencia, setAgencia] = useState<Agencia | null>(null);
  const [aceiteFeito, setAceiteFeito] = useState<{ nome: string; em: string } | null>(null);
  const [pacote, setPacote] = useState<NivelDoPacote | null>(null);
  // "Tentar de novo" soma aqui e o efeito lê de novo.
  const [tentativa, setTentativa] = useState(0);
  const segundos = useRef(0);
  const animar = useEntradaSuave(fase === "pronto");

  useEffect(() => {
    // Formato do token conferido antes, sem ir ao servidor.
    if (!/^[0-9a-f]{32,128}$/i.test(token)) {
      setFase("invalido");
      return;
    }
    let vivo = true;
    setFase("lendo");
    // Sem AbortController (Safari 11): passado o tempo, oferece tentar de novo; a resposta que chegar depois ainda abre.
    const relogio = window.setTimeout(() => {
      if (vivo) setFase((f) => (f === "lendo" ? "falhou" : f));
    }, ESPERA_MAXIMA_MS);
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, { headers: { apikey: CHAVE_API } })
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        window.clearTimeout(relogio);
        if (d && d.error === "link_invalido") {
          setAgencia(d.agencia && typeof d.agencia === "object" ? d.agencia : null);
          setFase("invalido");
          return;
        }
        if (!d || d.error || !d.proposta) {
          setFase("falhou");
          return;
        }
        setP(d.proposta as Publica);
        setLogo(typeof d.logo_cliente_url === "string" ? d.logo_cliente_url : null);
        setAgencia(d.agencia && typeof d.agencia === "object" ? d.agencia : null);
        setFase("pronto");
      })
      .catch(() => {
        if (!vivo) return;
        window.clearTimeout(relogio);
        setFase("falhou");
      });
    return () => {
      vivo = false;
      window.clearTimeout(relogio);
    };
  }, [token, tentativa]);

  // Rastreio: abertura e tempo de leitura com a página à vista.
  useEffect(() => {
    if (fase !== "pronto" || !p) return;
    document.title = `Proposta ${p.numero} · Aceleriq`;
    const sessao = sessaoDaAba(token);
    enviarRastreio({ token, tipo: "aberta", sessao, segundos: 0 });
    const relogio = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      segundos.current += PASSO_MS / 1000;
      enviarRastreio({ token, tipo: "leitura", sessao, segundos: segundos.current });
    }, PASSO_MS);
    const sair = () => enviarRastreio({ token, tipo: "leitura", sessao, segundos: segundos.current }, true);
    window.addEventListener("pagehide", sair);
    return () => {
      window.clearInterval(relogio);
      window.removeEventListener("pagehide", sair);
    };
  }, [fase, p, token]);

  if (fase === "lendo") {
    return (
      <div className="pd" style={{ minHeight: "100vh" }} aria-busy="true">
        <div className="pd-pagina pd-escuro">
          <div className="pd-interno">
            <MarcaAceleriq altura={28} />
            <p className="pd-sub">Abrindo a proposta...</p>
          </div>
        </div>
      </div>
    );
  }

  if (fase === "falhou") {
    // Rede ou servidor: o link pode estar bom. Nada de "peça o link novo" aqui.
    return (
      <div className="pd" style={{ minHeight: "100vh" }}>
        <div className="pd-pagina pd-escuro">
          <div className="pd-interno">
            <MarcaAceleriq altura={28} />
            <h2 className="pd-titulo" style={{ marginTop: 32 }}>
              Não abriu agora.
            </h2>
            <p className="pd-sub">Confira a internet e tente de novo.</p>
            <button type="button" className="pd-botao" style={{ marginTop: 24 }} onClick={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (fase === "invalido" || !p) {
    const whatsDoLink = agencia ? whatsDaAgencia(agencia.whatsapp) : "";
    return (
      <div className="pd" style={{ minHeight: "100vh" }}>
        <div className="pd-pagina pd-escuro">
          <div className="pd-interno">
            <MarcaAceleriq altura={28} />
            <h2 className="pd-titulo" style={{ marginTop: 32 }}>
              Link indisponível
            </h2>
            <p className="pd-sub">A proposta pode ter sido atualizada. Peça o link novo à Aceleriq.</p>
            {whatsDoLink ? (
              // Texto fixo: sem token nem dado pessoal no endereço.
              <a className="pd-botao-secundario" style={{ display: "inline-block", marginTop: 24, textDecoration: "none" }} href={`https://wa.me/${whatsDoLink}?text=${encodeURIComponent("Oi, o link da minha proposta não abriu.")}`} target="_blank" rel="noopener noreferrer">
                Falar com a Aceleriq
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const hoje = hojeEmSaoPaulo();
  const validade = diaValido(p.validade_ate);
  const status = aceiteFeito ? "aceita" : statusEfetivo(ehStatus(p.status) ? p.status : "enviada", validade, hoje);
  const motivo = aceiteFeito ? "Esta proposta já foi aceita." : motivoParaNaoAceitar({ status, validade_ate: validade }, hoje);
  const quemAceitou = aceiteFeito || (p.aceite && p.aceite.nome ? { nome: p.aceite.nome, em: p.aceite.em || "" } : null);
  const conteudo = normalizarConteudo(p.conteudo);
  const itens = normalizarItens(p.itens);
  const pacotes = resumoDosPacotes(itens, p.pacotes);
  const opcoes = normalizarPagamento(p.pagamento).opcoes;
  const pacoteAceito = ehNivel(p.pacote_aceito) ? p.pacote_aceito : null;
  const pacoteVisto = pacoteAceito || pacote;
  const doPacote = pacotes.length ? pacotes.find((x) => x.nivel === pacoteVisto) || pacotes.find((x) => x.destaque) || pacotes[1] : null;
  const totaisDoPacote = doPacote ? doPacote.totais : totaisDosItens(itens);
  const indice = itensDoIndice(conteudo);
  const whats = agencia ? whatsDaAgencia(agencia.whatsapp) : "";
  const podeAceitar = !motivo && status !== "aceita";
  const comBarra = podeAceitar || !!whats;

  const blocoDeAceite =
    status === "aceita" ? (
      <div id="pd-aceite" className="pd-aceite" role="status">
        <p className="pd-ok">Proposta aceita{quemAceitou ? ` por ${quemAceitou.nome}` : ""}{quemAceitou && quemAceitou.em ? ` em ${dataCurta(quemAceitou.em.slice(0, 10))}` : ""}.</p>
        <p className="pd-pequeno">Obrigado. A Aceleriq entra em contato com o contrato e o kickoff.</p>
      </div>
    ) : motivo ? (
      <div id="pd-aceite" className="pd-aceite" role="status">
        <p className="pd-erro">{motivo}</p>
      </div>
    ) : (
      <FormularioDeAceite token={token} pacotes={pacotes} opcoes={opcoes} totaisDoPacote={totaisDoPacote} pacote={pacote} onPacote={setPacote} onAceito={(nome, em) => setAceiteFeito({ nome, em })} />
    );

  return (
    <div className={comBarra ? "pd-com-barra" : undefined} style={{ minHeight: "100vh", background: "#0b0d0c" }}>
      {indice.length > 2 ? (
        <nav className="pd pd-indice pd-nao-imprime" aria-label="Índice da proposta">
          <details>
            <summary>Índice da proposta {p.numero}</summary>
            <ol>
              {indice.map((i) => (
                <li key={i.tipo}>
                  <a href={`#pd-${i.tipo}`}>{i.titulo}</a>
                </li>
              ))}
            </ol>
          </details>
        </nav>
      ) : null}
      <PropostaDocumento
        dados={{
          numero: p.numero,
          titulo: p.titulo,
          conteudo,
          itens,
          validade_ate: validade,
          data: p.enviada_em ? p.enviada_em.slice(0, 10) : null,
          pacotes: p.pacotes,
          pagamento: p.pagamento,
          visual: p.visual,
          anexos: Array.isArray(p.anexos) ? p.anexos : [],
        }}
        cliente={p.cliente}
        logoCliente={logo}
        aceite={blocoDeAceite}
        animar={animar}
        pacoteEscolhido={pacoteVisto}
      />
      <div className="pd pd-rodape pd-nao-imprime">
        {validade && status !== "aceita" ? <div>Proposta {p.numero}, válida até {dataCurta(validade)}.</div> : <div>Proposta {p.numero}</div>}
        {agencia ? <div>{[agencia.nome, agencia.site, agencia.whatsapp, agencia.email].filter(Boolean).join(" · ")}</div> : null}
        <button type="button" className="pd-botao-secundario" onClick={() => window.print()}>
          Baixar PDF
        </button>
      </div>
      {comBarra ? (
        <div className="pd pd-barra-fixa pd-nao-imprime" role="region" aria-label="Ações da proposta">
          {podeAceitar ? (
            <a className="pd-barra-aceitar" href="#pd-aceite">
              Aceitar agora
            </a>
          ) : null}
          {whats ? (
            <a className="pd-barra-whatsapp" href={`https://wa.me/${whats}?text=${encodeURIComponent(`Oi, estou vendo a proposta ${p.numero} (${p.titulo}).`)}`} target="_blank" rel="noopener noreferrer">
              Falar no WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
