import { useEffect, useRef, useState, type FormEvent } from "react";
import { pacote } from "./pacote";

/**
 * Integrações da casa (Mesa Site SIT2): WhatsApp flutuante, aviso de cookies
 * (LGPD), pixel da Meta e GA4 só depois do consentimento, o formulário que
 * cai no CRM da agência (com armadilha e tempo mínimo contra robô) e o mapa
 * do Google que só carrega com clique ou consentimento. Tudo vem do pacote
 * (pacote.integracoes). Casca da casa: o agente USA, não reescreve.
 *
 * Nada roda no servidor: o estado de consentimento é lido depois de montar
 * (a página pré-renderizada hidrata igual).
 */

const integracoes = pacote.integracoes || null;
const CHAVE_DO_CONSENTIMENTO = "aceleriq-consentimento";
const EVENTO_DE_PREFERENCIAS = "aceleriq:preferencias-de-cookies";

type Consentimento = "aceito" | "recusado" | null;

function lerConsentimento(): Consentimento {
  try {
    const v = window.localStorage.getItem(CHAVE_DO_CONSENTIMENTO);
    return v === "aceito" || v === "recusado" ? v : null;
  } catch {
    return null;
  }
}

function gravarConsentimento(v: "aceito" | "recusado") {
  try {
    window.localStorage.setItem(CHAVE_DO_CONSENTIMENTO, v);
  } catch {
    /* navegador sem armazenamento: vale só nesta visita */
  }
}

/** Abre de novo o aviso de cookies (use no rodapé: "Preferências de cookies"). */
export function abrirPreferenciasDeCookies() {
  window.dispatchEvent(new Event(EVENTO_DE_PREFERENCIAS));
}

/** Link do WhatsApp com um texto (ou a mensagem padrão), ou null quando o WhatsApp está desligado. */
export function linkDoWhatsapp(texto?: string): string | null {
  const w = integracoes && integracoes.whatsapp;
  if (!w) return null;
  return `https://wa.me/${w.numero}?text=${encodeURIComponent(texto || w.mensagem)}`;
}

type Janela = Window & { fbq?: (...a: unknown[]) => void; _fbq?: unknown; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

let rastreioCarregado = false;
function carregarRastreio() {
  if (rastreioCarregado || !integracoes) return;
  rastreioCarregado = true;
  const w = window as Janela;
  if (integracoes.pixel_meta) {
    // Mesmo desenho do código oficial: fila até o fbevents.js carregar e trocar por ele.
    type Fbq = ((...a: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; push: unknown; loaded: boolean; version: string };
    const n = function (this: unknown, ...a: unknown[]) {
      if (n.callMethod) n.callMethod.apply(n, a);
      else n.queue.push(a);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    if (!w.fbq) w.fbq = n;
    if (!w._fbq) w._fbq = n;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    w.fbq!("init", integracoes.pixel_meta);
    w.fbq!("track", "PageView");
  }
  if (integracoes.ga4) {
    w.dataLayer = w.dataLayer || [];
    // O gtag.js só entende o objeto arguments (um array não funciona).
    w.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    };
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(integracoes.ga4)}`;
    document.head.appendChild(s);
    w.gtag("js", new Date());
    w.gtag("config", integracoes.ga4);
  }
}

/** Conta um lead nos rastreios ligados (só se o visitante aceitou). */
function contarLead() {
  const w = window as Janela;
  if (w.fbq) w.fbq("track", "Lead");
  if (w.gtag) w.gtag("event", "generate_lead");
}

function useConsentimento(): [Consentimento, (v: "aceito" | "recusado") => void, boolean] {
  const [valor, setValor] = useState<Consentimento>(null);
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    const v = lerConsentimento();
    setValor(v);
    setMontado(true);
    if (v === "aceito") carregarRastreio();
    const ouvir = (e: Event) => {
      if ((e as CustomEvent).detail === "aceito") setValor("aceito");
    };
    window.addEventListener("aceleriq:consentiu", ouvir);
    return () => window.removeEventListener("aceleriq:consentiu", ouvir);
  }, []);
  const decidir = (v: "aceito" | "recusado") => {
    gravarConsentimento(v);
    setValor(v);
    if (v === "aceito") {
      carregarRastreio();
      window.dispatchEvent(new CustomEvent("aceleriq:consentiu", { detail: "aceito" }));
    }
  };
  return [valor, decidir, montado];
}

/** Aviso de cookies (LGPD): aparece até a pessoa escolher; o rastreio só carrega com "Aceitar". */
function AvisoDeCookies() {
  const [consentimento, decidir, montado] = useConsentimento();
  const [reaberto, setReaberto] = useState(false);
  useEffect(() => {
    const abrir = () => setReaberto(true);
    window.addEventListener(EVENTO_DE_PREFERENCIAS, abrir);
    return () => window.removeEventListener(EVENTO_DE_PREFERENCIAS, abrir);
  }, []);
  if (!montado || !integracoes || !integracoes.cookies || (consentimento && !reaberto)) return null;
  const politica = integracoes.cookies.politica_url;
  return (
    <div role="dialog" aria-live="polite" aria-label="Aviso de cookies" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-texto/10 bg-superficie p-4 text-sm text-texto shadow-lg sm:inset-x-6">
      <p className="leading-relaxed">
        Usamos cookies para medir as visitas e melhorar os anúncios. Você escolhe.{" "}
        {politica ? (
          <a className="underline" href={politica} target="_blank" rel="noopener noreferrer">
            Política de privacidade
          </a>
        ) : null}
      </p>
      <div className="mt-3 flex flex-wrap justify-end">
        <button type="button" className="mb-1 mr-2 min-h-11 rounded-full border border-texto/20 px-4" onClick={() => (decidir("recusado"), setReaberto(false))}>
          Recusar
        </button>
        <button type="button" className="mb-1 min-h-11 rounded-full bg-destaque px-4 font-medium text-fundo" onClick={() => (decidir("aceito"), setReaberto(false))}>
          Aceitar
        </button>
      </div>
    </div>
  );
}

/** Botão flutuante do WhatsApp (canto de baixo, 56 px, com nome para leitor de tela). */
function WhatsappFlutuante() {
  const link = linkDoWhatsapp();
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar pelo WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:scale-105"
    >
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="currentColor">
        <path d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7 6.3 6.3 0 0 0 1.3 3.3 14.4 14.4 0 0 0 5.5 4.9c2 .9 2.8.9 3.8.8a3.2 3.2 0 0 0 2.1-1.5 2.6 2.6 0 0 0 .2-1.5c-.1-.2-.3-.3-.6-.4z" />
      </svg>
    </a>
  );
}

/** A camada que o App põe no fim da página: WhatsApp flutuante e aviso de cookies. */
export function CamadaDeIntegracoes() {
  return (
    <>
      <WhatsappFlutuante />
      <AvisoDeCookies />
    </>
  );
}

const ROTULOS: Record<string, string> = { nome: "Nome", email: "E-mail", whatsapp: "WhatsApp", empresa: "Empresa", mensagem: "Mensagem" };

/**
 * O formulário do site. Manda para o CRM da agência (função pública com
 * anti-spam). Sem formulário ligado no pacote, não desenha nada: a seção
 * mostra o WhatsApp ou o e-mail no lugar.
 */
export function Formulario({ className, rotuloDoBotao = "Enviar" }: { className?: string; rotuloDoBotao?: string }) {
  const f = integracoes && integracoes.formulario;
  const inicio = useRef(0);
  const [estado, setEstado] = useState<"livre" | "enviando" | "enviado" | "erro">("livre");
  const [erro, setErro] = useState("");
  useEffect(() => {
    inicio.current = Date.now();
  }, []);
  if (!f) return null;
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    const corpo: Record<string, unknown> = { chave: f.chave, pagina: window.location.pathname, iniciado_em: inicio.current, site_url: String(dados.get("site_url") || "") };
    f.campos.forEach((c) => (corpo[c] = String(dados.get(c) || "")));
    setEstado("enviando");
    setErro("");
    try {
      const r = await fetch(f.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensagem?: string };
      if (!r.ok || !j.ok) throw new Error(j.mensagem || "Não foi possível enviar agora.");
      setEstado("enviado");
      contarLead();
    } catch (x) {
      setEstado("erro");
      setErro(x instanceof Error ? x.message : "Não foi possível enviar agora.");
    }
  };
  if (estado === "enviado") {
    return (
      <p role="status" className={className}>
        {f.agradecimento}
      </p>
    );
  }
  return (
    <form onSubmit={enviar} className={className} noValidate={false}>
      {f.campos.map((c) => (
        <label key={c} className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">{ROTULOS[c] || c}</span>
          {c === "mensagem" ? (
            <textarea name={c} rows={4} maxLength={2000} className="w-full rounded-lg border border-texto/20 bg-transparent px-3 py-2" />
          ) : (
            <input
              name={c}
              type={c === "email" ? "email" : c === "whatsapp" ? "tel" : "text"}
              autoComplete={c === "nome" ? "name" : c === "email" ? "email" : c === "whatsapp" ? "tel" : c === "empresa" ? "organization" : "off"}
              required={c === "nome"}
              maxLength={c === "nome" || c === "empresa" ? 120 : 160}
              className="min-h-11 w-full rounded-lg border border-texto/20 bg-transparent px-3"
            />
          )}
        </label>
      ))}
      {/* Armadilha para robô: invisível e fora do teclado; gente não preenche. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Site
          <input name="site_url" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {estado === "erro" ? (
        <p role="alert" className="mb-3 text-sm">
          {erro}
        </p>
      ) : null}
      <button type="submit" disabled={estado === "enviando"} className="min-h-11 rounded-full bg-destaque px-6 font-medium text-fundo disabled:opacity-60">
        {estado === "enviando" ? "Enviando..." : rotuloDoBotao}
      </button>
    </form>
  );
}

/** Mapa do Google: só carrega com o clique ou com o consentimento (não põe cookie antes). */
export function Mapa({ className, altura = 360 }: { className?: string; altura?: number }) {
  const m = integracoes && integracoes.mapa;
  const [consentimento] = useConsentimento();
  const [ligado, setLigado] = useState(false);
  if (!m) return null;
  if (ligado || consentimento === "aceito") {
    return <iframe title={`Mapa: ${m.endereco}`} src={m.embed} width="100%" height={altura} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className={className} style={{ border: 0 }} />;
  }
  return (
    <button type="button" onClick={() => setLigado(true)} className={className} style={{ minHeight: altura, width: "100%" }} aria-label={`Ver no mapa: ${m.endereco}`}>
      <span className="block text-sm">{m.endereco}</span>
      <span className="mt-2 block font-medium underline">Ver no mapa</span>
    </button>
  );
}
