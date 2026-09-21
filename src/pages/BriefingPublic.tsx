import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { safeStorage } from "@/lib/safeStorage";
import WelcomeScreen from "@/components/briefing/WelcomeScreen";
import QuestionScreen from "@/components/briefing/QuestionScreen";
import CompletionScreen from "@/components/briefing/CompletionScreen";

/**
 * Fases da página pública do diagnóstico.
 *
 * "load_error" e "submit_error" são novas: antes, qualquer falha de rede ao
 * abrir virava "link inválido" (e apagava o progresso salvo), e qualquer
 * falha ao enviar mostrava a tela de sucesso com as respostas perdidas.
 */
type Phase =
  | "loading"
  | "load_error"
  | "invalid"
  | "welcome"
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

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const [hasRestoredProgress, setHasRestoredProgress] = useState(false);
  /** Incrementa para tentar carregar de novo depois de uma falha de rede. */
  const [loadAttempt, setLoadAttempt] = useState(0);

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
      setPhase("welcome");
    })();
    return () => { alive = false; };
  }, [token, loadAttempt]);

  const updateAnswer = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

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

  const handleStartQuestions = () => {
    setPhase("questions");
  };

  if (phase === "loading" || phase === "submitting") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: "#0D0D0D" }}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        {phase === "submitting" && (
          <p className="text-xs text-muted-foreground">Enviando suas respostas...</p>
        )}
      </div>
    );
  }

  if (phase === "load_error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0D0D0D" }}>
        <div className="text-center space-y-3 max-w-[420px]">
          <div className="mx-auto w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-warning" />
          </div>
          <p className="text-lg font-semibold text-foreground">Não foi possível carregar</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Não conseguimos falar com o servidor agora. Confira a internet e tente de novo:
            o link continua valendo e o que você já respondeu está guardado.
          </p>
          <button
            type="button"
            onClick={() => setLoadAttempt(n => n + 1)}
            className="mt-2 px-6 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (phase === "submit_error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0D0D0D" }}>
        <div className="text-center space-y-3 max-w-[420px]">
          <div className="mx-auto w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-warning" />
          </div>
          <p className="text-lg font-semibold text-foreground">Não conseguimos enviar</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Suas respostas continuam aqui, nada foi perdido. Confira a internet e toque em
            Enviar de novo; se preferir, volte e revise antes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => { void handleComplete(); }}
              className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
            >
              Enviar de novo
            </button>
            <button
              type="button"
              onClick={() => setPhase("questions")}
              className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-medium border border-[#2A2A2A] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer bg-transparent"
            >
              Voltar às respostas
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0D0D0D" }}>
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-foreground">Link inválido ou já utilizado</p>
          <p className="text-sm text-muted-foreground">Este diagnóstico já foi enviado ou o link expirou.</p>
        </div>
      </div>
    );
  }

  if (phase === "welcome") {
    return (
      <WelcomeScreen
        onStart={handleStartQuestions}
        hasRestoredProgress={hasRestoredProgress}
      />
    );
  }

  if (phase === "questions") {
    return (
      <QuestionScreen
        answers={answers}
        onUpdate={updateAnswer}
        onComplete={handleComplete}
        storageKey={token}
      />
    );
  }

  return <CompletionScreen />;
}
