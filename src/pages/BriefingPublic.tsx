import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import WelcomeScreen from "@/components/briefing/WelcomeScreen";
import QuestionScreen from "@/components/briefing/QuestionScreen";
import CompletionScreen from "@/components/briefing/CompletionScreen";

type Phase = "loading" | "invalid" | "welcome" | "questions" | "complete";

export default function BriefingPublic() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [briefingId, setBriefingId] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, any>>({
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
  });

  useEffect(() => {
    if (!token) { setPhase("invalid"); return; }
    supabase
      .from("briefings")
      .select("id, submitted")
      .eq("token", token)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || data.submitted) setPhase("invalid");
        else { setBriefingId(data.id); setPhase("welcome"); }
      });
  }, [token]);

  const updateAnswer = (key: string, value: any) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const handleComplete = async () => {
    if (!briefingId) return;
    await supabase.from("briefings").update({ responses: answers, submitted: true }).eq("id", briefingId);
    const { data: adminId } = await supabase.rpc("get_admin_user_id");
    if (adminId) {
      await supabase.from("notifications").insert({
        user_id: adminId,
        message: `Novo diagnóstico recebido: ${answers.companyName || "Sem nome"}`,
        notification_type: "system",
        link: "/briefings",
      });
    }
    setPhase("complete");
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
    return <WelcomeScreen onStart={() => setPhase("questions")} />;
  }

  if (phase === "questions") {
    return (
      <QuestionScreen
        answers={answers}
        onUpdate={updateAnswer}
        onComplete={handleComplete}
      />
    );
  }

  return <CompletionScreen />;
}
