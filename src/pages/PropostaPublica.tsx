import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import PropostaDocumento from "@/components/mesa-proposta/PropostaDocumento";
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
  statusEfetivo,
  validarAceite,
} from "../../supabase/functions/_shared/proposta-modelo";

/**
 * /proposta/:token (frente PRO): a proposta que o cliente abre pelo link,
 * sem login. Página vertical, feita para o celular, com o aceite no fim
 * (nome, e-mail e a caixa) e "Baixar PDF" pela impressão do navegador (A4
 * vertical, sem biblioteca pesada).
 *
 * Rastreio: ao abrir, uma sessão (guardada nesta aba) avisa a função; a cada
 * 15 s com a página à vista, o tempo de leitura sobe na mesma linha. Nada de
 * dado pessoal no endereço: o token é o único parâmetro.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proposta-publica`;
const CHAVE_API = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const PASSO_MS = 15_000;

type Fase = "lendo" | "invalido" | "pronto";

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
};

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

function FormularioDeAceite({ token, onAceito }: { token: string; onAceito: (nome: string, em: string) => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [aceito, setAceito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aceitar = async () => {
    const problema = validarAceite({ nome, email, aceito });
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CHAVE_API },
        body: JSON.stringify({ token, aceitar: { nome: nome.trim(), email: email.trim(), aceito: true } }),
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
      className="pd-aceite"
      onSubmit={(e) => {
        e.preventDefault();
        void aceitar();
      }}
      aria-label="Aceitar a proposta"
    >
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

export default function PropostaPublica() {
  const { token = "" } = useParams<{ token: string }>();
  const [fase, setFase] = useState<Fase>("lendo");
  const [p, setP] = useState<Publica | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [agencia, setAgencia] = useState<{ nome?: string; site?: string; email?: string; whatsapp?: string; instagram?: string } | null>(null);
  const [aceiteFeito, setAceiteFeito] = useState<{ nome: string; em: string } | null>(null);
  const segundos = useRef(0);

  useEffect(() => {
    if (!/^[0-9a-f]{32,128}$/i.test(token)) {
      setFase("invalido");
      return;
    }
    let vivo = true;
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, { headers: { apikey: CHAVE_API } })
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (!d || d.error || !d.proposta) {
          setFase("invalido");
          return;
        }
        setP(d.proposta as Publica);
        setLogo(typeof d.logo_cliente_url === "string" ? d.logo_cliente_url : null);
        setAgencia(d.agencia && typeof d.agencia === "object" ? d.agencia : null);
        setFase("pronto");
      })
      .catch(() => vivo && setFase("invalido"));
    return () => {
      vivo = false;
    };
  }, [token]);

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

  if (fase === "invalido" || !p) {
    return (
      <div className="pd" style={{ minHeight: "100vh" }}>
        <div className="pd-pagina pd-escuro">
          <div className="pd-interno">
            <MarcaAceleriq altura={28} />
            <h2 className="pd-titulo" style={{ marginTop: 32 }}>
              Link indisponível
            </h2>
            <p className="pd-sub">A proposta pode ter sido atualizada. Peça o link novo à Aceleriq.</p>
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

  const blocoDeAceite =
    status === "aceita" ? (
      <div className="pd-aceite" role="status">
        <p className="pd-ok">Proposta aceita{quemAceitou ? ` por ${quemAceitou.nome}` : ""}{quemAceitou && quemAceitou.em ? ` em ${dataCurta(quemAceitou.em.slice(0, 10))}` : ""}.</p>
        <p className="pd-pequeno">Obrigado. A Aceleriq entra em contato com o contrato e o kickoff.</p>
      </div>
    ) : motivo ? (
      <div className="pd-aceite" role="status">
        <p className="pd-erro">{motivo}</p>
      </div>
    ) : (
      <FormularioDeAceite token={token} onAceito={(nome, em) => setAceiteFeito({ nome, em })} />
    );

  return (
    <div style={{ minHeight: "100vh", background: "#0b0d0c" }}>
      <PropostaDocumento
        dados={{ numero: p.numero, titulo: p.titulo, conteudo: normalizarConteudo(p.conteudo), itens: normalizarItens(p.itens), validade_ate: validade, data: p.enviada_em ? p.enviada_em.slice(0, 10) : null }}
        cliente={p.cliente}
        logoCliente={logo}
        aceite={blocoDeAceite}
      />
      <div className="pd pd-rodape pd-nao-imprime">
        {validade && status !== "aceita" ? <div>Proposta {p.numero}, válida até {dataCurta(validade)}.</div> : <div>Proposta {p.numero}</div>}
        {agencia ? <div>{[agencia.nome, agencia.site, agencia.whatsapp, agencia.email].filter(Boolean).join(" · ")}</div> : null}
        <button type="button" className="pd-botao-secundario" onClick={() => window.print()}>
          Baixar PDF
        </button>
      </div>
    </div>
  );
}
