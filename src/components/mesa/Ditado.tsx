import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Ditado gratuito para os campos dos agentes da Mesa: usa o reconhecimento de
 * voz do próprio navegador (Chrome e Edge; Safari 14.1+), em português, e vai
 * escrevendo no campo enquanto a pessoa fala. Sem custo e sem servidor nosso.
 * Onde o navegador não tem reconhecimento, o botão não aparece.
 *
 * Uso: <Ditado valor={texto} onChange={setTexto} />
 */

type Resultado = { isFinal: boolean; 0: { transcript: string } };
type EventoDeFala = { resultIndex: number; results: { length: number; [i: number]: Resultado } };
type Reconhecedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: EventoDeFala) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function construtor(): (new () => Reconhecedor) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Reconhecedor; webkitSpeechRecognition?: new () => Reconhecedor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const ditadoDisponivel = () => construtor() !== null;

/** Junta o texto que já estava no campo com o que foi falado, com um espaço entre eles. */
export function juntarDitado(base: string, falado: string): string {
  const f = falado.replace(/\s+/g, " ").trim();
  if (!f) return base;
  if (!base.trim()) return f.charAt(0).toUpperCase() + f.slice(1);
  return /\s$/.test(base) ? base + f : `${base} ${f}`;
}

export function Ditado({
  valor,
  onChange,
  disabled,
  className = "",
}: {
  valor: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<Reconhecedor | null>(null);
  const base = useRef("");
  const finais = useRef("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => () => rec.current?.abort(), []);

  const Construtor = construtor();
  if (!Construtor) return null;

  const parar = () => {
    rec.current?.stop();
  };

  const comecar = () => {
    setErro(null);
    const r = new Construtor();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    base.current = valor;
    finais.current = "";
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const trecho = e.results[i][0].transcript;
        if (e.results[i].isFinal) finais.current = `${finais.current} ${trecho}`;
        else parcial += ` ${trecho}`;
      }
      onChangeRef.current(juntarDitado(base.current, `${finais.current} ${parcial}`));
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setErro("Libere o microfone para este site nas permissões do navegador.");
      else if (e.error && e.error !== "no-speech" && e.error !== "aborted") setErro("O ditado parou. Toque no microfone de novo.");
    };
    r.onend = () => {
      setOuvindo(false);
      rec.current = null;
      // Texto final limpo, sem o trecho parcial que ficou no meio.
      onChangeRef.current(juntarDitado(base.current, finais.current));
    };
    rec.current = r;
    try {
      r.start();
      setOuvindo(true);
    } catch {
      setErro("Não foi possível abrir o microfone.");
      rec.current = null;
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={ouvindo ? "destructive" : "outline"}
            className="h-8 w-8 shrink-0"
            onClick={ouvindo ? parar : comecar}
            disabled={disabled && !ouvindo}
            aria-label={ouvindo ? "Parar ditado" : "Falar em vez de digitar"}
            aria-pressed={ouvindo}
          >
            {ouvindo ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{ouvindo ? "Ouvindo… toque para parar" : "Falar em vez de digitar (grátis)"}</TooltipContent>
      </Tooltip>
      {ouvindo && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />}
      {erro && <span className="text-[11px] text-destructive">{erro}</span>}
    </span>
  );
}
