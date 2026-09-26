import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Link2Off, Loader2, Send } from "lucide-react";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { safeStorage } from "@/lib/safeStorage";
import { QUESTIONS, type Question } from "@/components/briefing/questions";
import {
  BarraDeAcoes,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Secao,
  botao,
  campo,
  campoTexto,
  foco,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import aceleriqLogo from "@/assets/logo-aceleriq-256.png";

/**
 * Fases da página pública do diagnóstico.
 *
 * "load_error" e "submit_error" existem porque antes qualquer falha de rede
 * ao abrir virava "link inválido" (e apagava o progresso salvo), e qualquer
 * falha ao enviar mostrava a tela de sucesso com as respostas perdidas.
 *
 * Sistema de design (docs/design/SISTEMA.md): as perguntas viraram um
 * formulário só, com rótulo em cima, 2 colunas no computador e 1 no celular,
 * agrupado pelos blocos do diagnóstico. As respostas continuam salvas no
 * aparelho a cada mudança, com as mesmas chaves de antes.
 */
type Phase =
  | "loading"
  | "load_error"
  | "invalid"
  | "questions"
  | "submitting"
  | "submit_error"
  | "complete";

const answersKey = (token: string) => `briefing_answers_${token}`;
const idxKey = (token: string) => `briefing_idx_${token}`;

const DEFAULT_ANSWERS: Record<string, any> = {
  companyName: "",
  segment: "",
  companyAge: "",
  companyDescription: "",
  digitalPresence: [],
  paidTraffic: "",
  digitalLevel: "",
  objectives: [],
  expectedResults: "",
  biggestChallenge: "",
  idealClient: "",
  region: "",
  howClientsFind: [],
  budget: "",
  additionalNotes: "",
};

const idDoCampo = (key: string) => `briefing-${key}`;

function respondida(q: Question, answers: Record<string, any>): boolean {
  const val = answers[q.key];
  if (val === undefined || val === null) return false;
  if (Array.isArray(val)) return val.length > 0;
  return typeof val === "string" && val.trim().length > 0;
}

/** Os blocos do diagnóstico, na ordem das perguntas. */
const BLOCOS = QUESTIONS.reduce<Array<{ label: string; perguntas: Question[] }>>((acc, q) => {
  const ultimo = acc[acc.length - 1];
  if (ultimo && ultimo.label === q.blockLabel) ultimo.perguntas.push(q);
  else acc.push({ label: q.blockLabel, perguntas: [q] });
  return acc;
}, []);

const PROXIMOS_PASSOS = [
  { titulo: "Análise do diagnóstico", texto: "A equipe lê cada resposta. Prazo: até 24h." },
  { titulo: "Proposta personalizada", texto: "Um plano sob medida, com estratégia e orçamento." },
  { titulo: "Conversa de apresentação", texto: "Uma chamada para apresentar tudo e alinhar." },
];

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          {/* O bitmap é quadrado com margem transparente: recorta na altura da barra (como no painel). */}
          <div className="-ml-5 flex h-full shrink-0 items-center overflow-hidden">
            <img src={aceleriqLogo} alt="Aceleriq" className="h-28 w-auto" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const [hasRestoredProgress, setHasRestoredProgress] = useState(false);
  /** Incrementa para tentar carregar de novo depois de uma falha de rede. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** Depois da primeira tentativa de envio, mostra o que falta responder. */
  const [mostrarErros, setMostrarErros] = useState(false);

  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    if (!token) return { ...DEFAULT_ANSWERS };
    // safeStorage: o localStorage pode lançar (Safari privado, link aberto
    // dentro do WhatsApp) e um throw aqui era tela branca no primeiro render.
    const saved = safeStorage.get(answersKey(token));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHasRestoredProgress(true);
        return { ...DEFAULT_ANSWERS, ...parsed };
      } catch { /* ignore */ }
    }
    return { ...DEFAULT_ANSWERS };
  });

  useEffect(() => {
    if (!token) { setPhase("invalid"); return; }
    let alive = true;
    setPhase("loading");
    (async () => {
      let data: any = null;
      let error: any = null;
      try {
        const result: any = await supabase.rpc("briefing_public_get" as any, { _token: token });
        data = result?.data;
        error = result?.error;
      } catch (err) {
        error = err;
      }
      if (!alive) return;
      if (error) {
        // Rede caiu ou servidor fora: NÃO é link inválido e o progresso salvo
        // fica intacto. A pessoa tenta de novo pelo botão.
        console.error("[briefing] falha ao carregar:", error);
        setPhase("load_error");
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.submitted) {
        // Só aqui, com resposta do servidor e sem linha válida, o link é
        // inválido de verdade e o progresso local deixa de fazer sentido.
        safeStorage.remove(answersKey(token));
        safeStorage.remove(idxKey(token));
        setPhase("invalid");
        return;
      }
      setBriefingId(row.id);
      const savedIdx = safeStorage.get(idxKey(token));
      if (savedIdx && parseInt(savedIdx, 10) > 0) {
        setHasRestoredProgress(true);
      }
      setPhase("questions");
    })();
    return () => { alive = false; };
  }, [token, loadAttempt]);

  // Salva no aparelho a cada resposta (mesma chave de antes): fechar o link
  // e voltar depois continua de onde parou.
  useEffect(() => {
    if (!token || phase === "complete" || phase === "invalid") return;
    safeStorage.set(answersKey(token), JSON.stringify(answers));
  }, [answers, token, phase]);

  const updateAnswer = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const faltando = useMemo(() => QUESTIONS.filter((q) => q.required && !respondida(q, answers)), [answers]);
  const respondidas = QUESTIONS.filter((q) => respondida(q, answers)).length;

  const handleComplete = async () => {
    if (!briefingId || !token) return;
    setPhase("submitting");

    let accepted = false;
    try {
      const { data, error } = await supabase.rpc("briefing_public_submit" as any, {
        _token: token,
        _responses: answers,
      });
      if (error) console.error("[briefing] falha ao enviar:", error);
      // O servidor devolve true quando gravou. Qualquer outra coisa (null,
      // false, erro) é "não foi": as respostas ficam e a pessoa tenta de novo.
      accepted = !error && data === true;
    } catch (err) {
      console.error("[briefing] falha ao enviar:", err);
    }

    if (!accepted) {
      setPhase("submit_error");
      return;
    }

    // Só com o envio confirmado o progresso salvo sai do aparelho.
    safeStorage.remove(answersKey(token));
    safeStorage.remove(idxKey(token));

    const { data: adminId } = await supabase.rpc("get_admin_user_id");
    if (adminId) {
      await supabase.from("notifications").insert({
        user_id: adminId,
        message: `Novo diagnóstico recebido: ${answers.companyName || "Sem nome"}`,
        notification_type: "system",
        link: "/briefings",
      });
    }

    // Fire webhook
    fireWebhook(webhooks.processDiagnostic, {
      diagnostic_id: briefingId,
      client_name: answers.companyName || "Sem nome",
      company: answers.companyName || "",
      answers,
    });

    setPhase("complete");
  };

  /** Enviar: confere o que é obrigatório, leva até a primeira pergunta sem resposta. */
  const enviar = () => {
    if (faltando.length > 0) {
      setMostrarErros(true);
      const alvo = document.getElementById(idDoCampo(faltando[0].key));
      if (alvo) {
        if (typeof alvo.scrollIntoView === "function") {
          try { alvo.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { alvo.scrollIntoView(); }
        }
        try { (alvo as HTMLElement).focus({ preventScroll: true } as FocusOptions); } catch { /* sem foco */ }
      }
      return;
    }
    void handleComplete();
  };

  if (phase === "loading") {
    return (
      <Casca>
        <Carregando forma="aba" rotulo="Abrindo o diagnóstico" />
      </Casca>
    );
  }

  if (phase === "load_error") {
    return (
      <Casca>
        <EstadoDeErro
          titulo="Não foi possível carregar."
          descricao="Confira a internet e tente de novo. O link continua valendo e o que você já respondeu está guardado."
          acao={<button type="button" onClick={() => setLoadAttempt(n => n + 1)} className={botao.primario}>Tentar de novo</button>}
        />
      </Casca>
    );
  }

  if (phase === "invalid") {
    return (
      <Casca>
        <EstadoVazio
          icone={<Link2Off className="h-5 w-5" />}
          titulo="Link inválido ou já utilizado"
          descricao="Este diagnóstico já foi enviado ou o link expirou."
        />
      </Casca>
    );
  }

  if (phase === "complete") {
    return (
      <Casca>
        <div className="flex flex-col items-center px-2 py-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className={texto.tituloPagina}>Diagnóstico enviado</h1>
          <p className={juntar(texto.corpo, "mt-2 max-w-md text-muted-foreground")}>
            Obrigado pelo tempo. Cada resposta ajuda a montar a melhor estratégia para o seu negócio.
          </p>
        </div>
        <Secao divisoria titulo="O que acontece agora">
          <ol className="divide-y divide-border">
            {PROXIMOS_PASSOS.map((p, i) => (
              <li key={p.titulo} className="flex min-w-0 items-start py-3">
                <span className={juntar("mr-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums", i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{p.titulo}</span>
                  <span className={juntar(texto.auxiliar, "block leading-5")}>{p.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </Secao>
      </Casca>
    );
  }

  const enviando = phase === "submitting";
  const pct = Math.round((respondidas / QUESTIONS.length) * 100);

  return (
    <Casca>
      <CabecalhoDePagina
        titulo="Diagnóstico da Aceleriq"
        descricao={`${QUESTIONS.length} perguntas · cerca de 8 minutos · confidencial`}
        ajuda={
          <>
            Como funciona: você responde sobre o seu negócio, a equipe analisa cada resposta e, em até 48h, você recebe um plano sob medida com o orçamento. As respostas ficam salvas neste aparelho enquanto você preenche.
          </>
        }
      />
      <p className={juntar(texto.corpo, "mt-2 text-muted-foreground")}>
        Conte um pouco sobre o seu negócio. Não existe resposta certa: quanto mais sincero, melhor a estratégia.
      </p>
      {hasRestoredProgress && (
        <p className={juntar(superficie.poco, texto.corpo, "mt-4 px-3 py-2")}>
          Você já tinha começado. As respostas salvas estão abaixo: continue de onde parou.
        </p>
      )}

      <div className="mt-6 space-y-8">
        {BLOCOS.map((bloco, i) => (
          <Secao key={bloco.label} divisoria={i > 0}>
            <GrupoDeCampos titulo={bloco.label}>
              {bloco.perguntas.map((q) => (
                <Pergunta key={q.key} q={q} valor={answers[q.key]} onMudar={(v) => updateAnswer(q.key, v)} mostrarErro={mostrarErros && q.required && !respondida(q, answers)} />
              ))}
            </GrupoDeCampos>
          </Secao>
        ))}
      </div>

      {phase === "submit_error" && (
        <EstadoDeErro
          className="mt-6"
          titulo="Não conseguimos enviar."
          descricao="Suas respostas continuam aqui, nada foi perdido. Confira a internet e envie de novo."
        />
      )}

      <BarraDeAcoes
        fixa
        className="mt-6"
        inicio={
          <span className="flex min-w-0 items-center">
            <span className="mr-2 hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </span>
            <span className="truncate tabular-nums">
              {respondidas} de {QUESTIONS.length} respondidas
              {mostrarErros && faltando.length > 0 ? <span className="text-destructive"> · faltam {faltando.length}</span> : null}
            </span>
          </span>
        }
      >
        <button type="button" onClick={enviar} disabled={enviando} className={botao.primario}>
          {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {enviando ? "Enviando..." : phase === "submit_error" ? "Enviar de novo" : "Enviar diagnóstico"}
        </button>
      </BarraDeAcoes>
    </Casca>
  );
}

/** A pergunta como rótulo: quebra linha (nunca corta) e um pouco maior que o rótulo comum. */
function Rotulo({ texto: t }: { texto: string }) {
  return <span className="whitespace-normal text-[13px] font-medium leading-5 text-foreground">{t}</span>;
}

/** Uma pergunta: rótulo em cima, o controle e a dica embaixo (ou o erro). */
function Pergunta({ q, valor, onMudar, mostrarErro }: { q: Question; valor: any; onMudar: (v: any) => void; mostrarErro: boolean }) {
  const id = idDoCampo(q.key);
  const erro = mostrarErro ? (q.type === "multi-chip" ? "Escolha pelo menos uma opção." : "Responda esta pergunta.") : undefined;

  if (q.type === "multi-chip") {
    const lista: string[] = Array.isArray(valor) ? valor : [];
    const cheio = !!q.maxSelect && lista.length >= q.maxSelect;
    const alternar = (op: string) => {
      if (lista.includes(op)) onMudar(lista.filter((v) => v !== op));
      else if (!cheio) onMudar([...lista, op]);
    };
    return (
      <CampoDeFormulario
        rotulo={<Rotulo texto={q.question} />}
        obrigatorio={q.required}
        largo
        erro={erro}
        apoio={q.maxSelect ? `${q.hint} ${lista.length} de ${q.maxSelect}.` : q.hint}
      >
        <div id={id} tabIndex={-1} role="group" className="-m-1 flex flex-wrap outline-none">
          {(q.options || []).map((op) => {
            const marcada = lista.includes(op);
            return (
              <button
                key={op}
                type="button"
                aria-pressed={marcada}
                disabled={!marcada && cheio}
                onClick={() => alternar(op)}
                className={juntar(
                  "m-1 inline-flex h-9 items-center rounded-md border px-3 text-[13px] transition-colors disabled:opacity-40",
                  marcada ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  foco,
                )}
              >
                {op}
              </button>
            );
          })}
        </div>
      </CampoDeFormulario>
    );
  }

  if (q.type === "single-chip") {
    return (
      <CampoDeFormulario rotulo={<Rotulo texto={q.question} />} obrigatorio={q.required} erro={erro} apoio={q.hint}>
        <select id={id} value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} className={campo}>
          <option value="">Escolha uma opção</option>
          {(q.options || []).map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </CampoDeFormulario>
    );
  }

  if (q.type === "textarea") {
    const txt = typeof valor === "string" ? valor : "";
    return (
      <CampoDeFormulario
        rotulo={<Rotulo texto={q.question} />}
        obrigatorio={q.required}
        erro={erro}
        apoio={q.maxChars ? <span className="flex min-w-0"><span className="mr-2 min-w-0 flex-1">{q.hint}</span><span className={juntar("shrink-0 tabular-nums", txt.length >= q.maxChars && "text-destructive")}>{txt.length}/{q.maxChars}</span></span> : q.hint}
      >
        <textarea
          id={id}
          value={txt}
          onChange={(e) => {
            const v = e.target.value;
            if (q.maxChars && v.length > q.maxChars) return;
            onMudar(v);
          }}
          placeholder={q.placeholder}
          rows={3}
          className={juntar(campoTexto, "resize-none")}
        />
      </CampoDeFormulario>
    );
  }

  return (
    <CampoDeFormulario rotulo={<Rotulo texto={q.question} />} obrigatorio={q.required} erro={erro} apoio={q.hint}>
      <input id={id} type="text" value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} placeholder={q.placeholder} className={campo} />
    </CampoDeFormulario>
  );
}
