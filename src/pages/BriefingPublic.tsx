import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import WelcomeScreen from "@/components/briefing/WelcomeScreen";
import QuestionScreen from "@/components/briefing/QuestionScreen";
import CompletionScreen from "@/components/briefing/CompletionScreen";

type Phase = "loading" | "invalid" | "welcome" | "questions" | "complete";

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

  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    if (!token) return { ...DEFAULT_ANSWERS };
    const saved = localStorage.getItem(`briefing_answers_${token}`);
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
    supabase
      .rpc("briefing_public_get", { _token: token })
      .then(({ data }: any) => {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || row.submitted) {
          localStorage.removeItem(`briefing_answers_${token}`);
          localStorage.removeItem(`briefing_idx_${token}`);
          setPhase("invalid");
        } else {
          setBriefingId(row.id);
          const savedIdx = localStorage.getItem(`briefing_idx_${token}`);
          if (savedIdx && parseInt(savedIdx, 10) > 0) {
            setHasRestoredProgress(true);
          }
          setPhase("welcome");
        }
      });
  }, [token]);

  const updateAnswer = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const handleComplete = async () => {
    if (!briefingId) return;
    await supabase.from("briefings").update({ responses: answers, submitted: true }).eq("id", briefingId);
    
    // Clean up saved progress
    if (token) {
      localStorage.removeItem(`briefing_answers_${token}`);
      localStorage.removeItem(`briefing_idx_${token}`);
    }

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

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0D0D0D" }}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
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
