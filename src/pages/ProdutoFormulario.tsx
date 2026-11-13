import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { CampoDeFormulario, Carregando, botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { variaveisDaCor, type CorDaEmpresa } from "@/lib/produto/aparencia";
import {
  CAMPO_ISCA,
  ErroDoFormulario,
  LIMITES,
  abrirFormularioPublico,
  enviarFormularioPublico,
  lerCookie,
  origemDaUrl,
  validarEnvio,
  type FormularioPublico,
  type OrigemDaCaptacao,
} from "@/lib/produto/captacao";
import "@/components/produto/produto.css";

type Fbq = (...args: unknown[]) => void;

/**
 * Carrega o Pixel da Meta da empresa. Só é chamado quando a empresa tem pixel:
 * sem pixel, nenhum código da Meta entra na página.
 */
function carregarPixel(id: string): Fbq | null {
  try {
    const w = window as unknown as { fbq?: Fbq & { queue?: unknown[]; callMethod?: (...a: unknown[]) => void; push?: unknown; loaded?: boolean; version?: string }; _fbq?: unknown };
    if (!w.fbq) {
      const n = function (...args: unknown[]) {
        if (n.callMethod) n.callMethod(...args);
        else n.queue.push(args);
      } as Fbq & { queue: unknown[]; callMethod?: (...a: unknown[]) => void; push?: unknown; loaded?: boolean; version?: string };
      n.queue = [];
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      w.fbq = n;
      if (!w._fbq) w._fbq = n;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);
    }
    w.fbq("init", id);
    w.fbq("track", "PageView");
    return w.fbq;
  } catch {
    return null;
  }
}

const iniciais = (nome: string) => (nome || "").trim().slice(0, 1).toUpperCase() || "•";

/**
 * A página pública de um formulário de captação (endereço /f/:token). Quem
 * chega pelo anúncio, pela bio ou pelo site preenche e vira negócio no funil
 * da empresa. A origem do clique (utm_*, fbclid, gclid) é lida do endereço na
 * chegada e vai junto com o envio.
 *
 * Leve de propósito: um pedido para abrir, um para enviar, sem biblioteca de
 * dados. O Pixel da Meta só carrega se a empresa tiver pixel.
 */
export default function ProdutoFormulario() {
  const { token = "" } = useParams();
  const { theme } = useTheme();
  const [formulario, setFormulario] = useState<FormularioPublico | null>(null);
  const [falha, setFalha] = useState<{ codigo: string; mensagem: string } | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<{ campo: string; mensagem: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const fbq = useRef<Fbq | null>(null);
  // A origem é lida uma vez, na chegada: é o link em que a pessoa clicou.
  const origem = useRef<OrigemDaCaptacao | null>(null);
  if (origem.current === null && typeof window !== "undefined") {
    origem.current = origemDaUrl(window.location.href, { referencia: document.referrer || "", agora: Date.now() });
  }

  useEffect(() => {
    let vivo = true;
    setFalha(null);
    setFormulario(null);
    abrirFormularioPublico(token)
      .then((f) => {
        if (!vivo) return;
        setFormulario(f);
        if (f.pixel) fbq.current = carregarPixel(f.pixel);
      })
      .catch((e) => {
        if (!vivo) return;
        const err = e instanceof ErroDoFormulario ? e : new ErroDoFormulario("erro", "Não foi possível abrir o formulário.");
        setFalha({ codigo: err.codigo, mensagem: err.message });
      });
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  useEffect(() => {
    if (formulario) document.title = formulario.empresa.nome ? `${formulario.titulo} · ${formulario.empresa.nome}` : formulario.titulo;
  }, [formulario]);

  const cores = useMemo(() => variaveisDaCor((formulario && (formulario.empresa.cor as CorDaEmpresa)) || undefined, theme) as CSSProperties, [formulario, theme]);
  const mudar = (chave: string, valor: string) => {
    setValores((v) => ({ ...v, [chave]: valor }));
    if (erro && erro.campo === chave) setErro(null);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!formulario || enviando) return;
    const respostas: Record<string, string> = {};
    for (const p of formulario.perguntas) respostas[p.chave] = valores[`p:${p.chave}`] || "";
    const envio = {
      nome: valores.nome || "",
      whatsapp: valores.whatsapp || "",
      email: valores.email || "",
      empresa: valores.empresa || "",
      mensagem: valores.mensagem || "",
      respostas,
      origem: { ...(origem.current || {}), ...(lerCookie("_fbp") ? { fbp: lerCookie("_fbp") } : {}) },
      [CAMPO_ISCA]: valores[CAMPO_ISCA] || "",
    };
    const conferido = validarEnvio(formulario, envio);
    if (conferido.ok === false) {
      setErro({ campo: conferido.campo, mensagem: conferido.mensagem });
      const alvo = document.querySelector(`[data-campo="${conferido.campo}"] input, [data-campo="${conferido.campo}"] textarea`);
      if (alvo && (alvo as HTMLElement).focus) (alvo as HTMLElement).focus();
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await enviarFormularioPublico(token, envio);
      // O mesmo id vai pelo servidor (API de Conversões): a Meta conta uma vez só.
      if (fbq.current && !r.repetido) fbq.current("track", "Lead", {}, r.evento_id ? { eventID: r.evento_id } : {});
      setEnviado(true);
    } catch (e2) {
      const err = e2 instanceof ErroDoFormulario ? e2 : new ErroDoFormulario("erro", "Não foi possível enviar. Tente de novo.");
      setErro({ campo: err.campo, mensagem: err.message });
    } finally {
      setEnviando(false);
    }
  };

  const pede = (c: "whatsapp" | "email" | "empresa" | "mensagem") => (formulario ? formulario.campos[c] : "nao");
  const erroDe = (c: string) => (erro && erro.campo === c ? erro.mensagem : undefined);

  return (
    <div className="produto-fundo min-h-screen px-4 pb-10 pt-6 text-foreground sm:px-6 sm:pt-12" style={cores} data-produto-formulario="">
      <main className="produto-entra mx-auto w-full max-w-[440px]">
        {falha ? (
          <div className={juntar(superficie.painel, "p-6 text-center")} role="alert" data-formulario-indisponivel={falha.codigo}>
            <p className={texto.tituloSecao}>{falha.codigo === "formulario_desligado" ? "Este formulário foi encerrado." : falha.codigo === "formulario_inexistente" ? "Este formulário não existe." : "Não foi possível abrir o formulário."}</p>
            {falha.codigo !== "formulario_desligado" && falha.codigo !== "formulario_inexistente" && (
              <button type="button" className={juntar(botao.secundario, "mt-4")} onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
            )}
          </div>
        ) : !formulario ? (
          <div className={juntar(superficie.painel, "p-6")}>
            <Carregando linhas={4} rotulo="Abrindo o formulário" />
          </div>
        ) : (
          <>
            <div className="mb-5 flex min-w-0 items-center justify-center">
              {formulario.empresa.logo ? (
                <img src={formulario.empresa.logo} alt={formulario.empresa.nome} className="h-10 w-auto max-w-[200px] object-contain" />
              ) : (
                <>
                  <span className="mr-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground" aria-hidden="true">{iniciais(formulario.empresa.nome)}</span>
                  <span className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{formulario.empresa.nome}</span>
                </>
              )}
            </div>

            <div className={juntar(superficie.painel, "p-5 sm:p-6")}>
              {enviado ? (
                <div className="py-4 text-center" role="status" data-formulario-enviado="">
                  <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <p className={texto.tituloPagina}>Pronto.</p>
                  <p className={juntar(texto.corpo, "mt-2 whitespace-pre-line text-muted-foreground")}>{formulario.agradecimento}</p>
                </div>
              ) : (
                <form onSubmit={(e) => void enviar(e)} noValidate data-formulario-de-captacao="">
                  <p role="heading" aria-level={1} className={texto.tituloPagina}>{formulario.titulo}</p>
                  {formulario.descricao && <p className={juntar(texto.corpo, "mt-1.5 whitespace-pre-line text-muted-foreground")}>{formulario.descricao}</p>}

                  <div className="mt-5 space-y-4">
                    <div data-campo="nome">
                      <CampoDeFormulario rotulo="Nome" obrigatorio erro={erroDe("nome")}>
                        <input className={campo} value={valores.nome || ""} onChange={(e) => mudar("nome", e.target.value)} maxLength={LIMITES.nome} autoComplete="name" name="nome" />
                      </CampoDeFormulario>
                    </div>
                    {pede("whatsapp") !== "nao" && (
                      <div data-campo="whatsapp">
                        <CampoDeFormulario rotulo="WhatsApp" obrigatorio={pede("whatsapp") === "obrigatorio"} erro={erroDe("whatsapp")}>
                          <input className={campo} value={valores.whatsapp || ""} onChange={(e) => mudar("whatsapp", e.target.value)} maxLength={LIMITES.whatsapp} type="tel" inputMode="tel" autoComplete="tel" name="whatsapp" placeholder="(00) 00000-0000" />
                        </CampoDeFormulario>
                      </div>
                    )}
                    {pede("email") !== "nao" && (
                      <div data-campo="email">
                        <CampoDeFormulario rotulo="E-mail" obrigatorio={pede("email") === "obrigatorio"} erro={erroDe("email")}>
                          <input className={campo} value={valores.email || ""} onChange={(e) => mudar("email", e.target.value)} maxLength={LIMITES.email} type="email" inputMode="email" autoComplete="email" name="email" />
                        </CampoDeFormulario>
                      </div>
                    )}
                    {pede("empresa") !== "nao" && (
                      <div data-campo="empresa">
                        <CampoDeFormulario rotulo="Empresa" obrigatorio={pede("empresa") === "obrigatorio"} erro={erroDe("empresa")}>
                          <input className={campo} value={valores.empresa || ""} onChange={(e) => mudar("empresa", e.target.value)} maxLength={LIMITES.empresa} autoComplete="organization" name="empresa" />
                        </CampoDeFormulario>
                      </div>
                    )}
                    {formulario.perguntas.map((p) => (
                      <div key={p.chave} data-campo={p.chave}>
                        <CampoDeFormulario rotulo={p.rotulo} obrigatorio={p.obrigatoria} erro={erroDe(p.chave)}>
                          <input className={campo} value={valores[`p:${p.chave}`] || ""} onChange={(e) => { mudar(`p:${p.chave}`, e.target.value); if (erro && erro.campo === p.chave) setErro(null); }} maxLength={LIMITES.resposta} name={p.chave} />
                        </CampoDeFormulario>
                      </div>
                    ))}
                    {pede("mensagem") !== "nao" && (
                      <div data-campo="mensagem">
                        <CampoDeFormulario rotulo="Mensagem" obrigatorio={pede("mensagem") === "obrigatorio"} erro={erroDe("mensagem")}>
                          <textarea className={campoTexto} value={valores.mensagem || ""} onChange={(e) => mudar("mensagem", e.target.value)} maxLength={LIMITES.mensagem} name="mensagem" rows={3} />
                        </CampoDeFormulario>
                      </div>
                    )}
                  </div>

                  {/* Campo isca: fora da tela e fora do teclado. Gente não preenche; robô preenche e o envio é descartado. */}
                  <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                    <label>
                      Site
                      <input tabIndex={-1} autoComplete="off" name={CAMPO_ISCA} value={valores[CAMPO_ISCA] || ""} onChange={(e) => mudar(CAMPO_ISCA, e.target.value)} />
                    </label>
                  </div>

                  {erro && !erro.campo && <p className={juntar(texto.auxiliar, "mt-4 leading-5 text-destructive")} role="alert">{erro.mensagem}</p>}

                  <button type="submit" className={juntar(botao.primario, "mt-5 h-11 w-full")} disabled={enviando} data-enviar-formulario="">
                    {enviando ? "Enviando..." : formulario.texto_botao}
                  </button>
                  <p className={juntar(texto.auxiliar, "mt-3 text-center leading-5")}>Ao enviar, você aceita ser contatado por {formulario.empresa.nome || "esta empresa"}.</p>
                </form>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
