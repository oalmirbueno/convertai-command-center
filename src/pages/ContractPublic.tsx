import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, FileSignature, CheckCircle2, Download, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import aceleriqLogo from "@/assets/logo-aceleriq.png";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contract-public`;

type Phase = "loading" | "invalid" | "ready" | "signing" | "done";

export default function ContractPublic() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [contract, setContract] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [signName, setSignName] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setPhase("invalid"); return; }
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
      headers: { "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "" },
    })
      .then(r => r.json())
      .then(({ contract, error }) => {
        if (error || !contract) return setPhase("invalid");
        setContract(contract);
        setClient(arguments[0]?.client);
        setSignName(arguments[0]?.client?.full_name || "");
        if (contract.client_signed_at) setPhase("done");
        else setPhase("ready");
      })
      .catch(() => setPhase("invalid"));
  }, [token]);

  // re-fetch with proper destructuring (the arguments[0] above is fragile)
  useEffect(() => {
    if (!token || phase !== "loading") return;
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
      headers: { "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "" },
    })
      .then(r => r.json())
      .then((res) => {
        if (res.error || !res.contract) return setPhase("invalid");
        setContract(res.contract);
        setClient(res.client);
        setSignName(res.client?.full_name || "");
        if (res.contract.client_signed_at) setPhase("done");
        else setPhase("ready");
      })
      .catch(() => setPhase("invalid"));
  }, [token, phase]);

  const handleSign = async () => {
    if (!signName.trim() || !accept) {
      setError("Preencha seu nome e marque a confirmação.");
      return;
    }
    setError(null);
    setPhase("signing");
    try {
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
        },
        body: JSON.stringify({ token, signature_name: signName.trim(), accept: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Erro ao assinar");
      setPhase("done");
      setContract((c: any) => ({ ...c, client_signed_at: new Date().toISOString(), client_signature_name: signName.trim(), status: "completed" }));
    } catch (e: any) {
      setError(e.message);
      setPhase("ready");
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-foreground">
      <header className="border-b border-border/40 bg-card/30 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <img src={aceleriqLogo} alt="Aceleriq" className="h-20 w-auto" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" /> Assinatura segura
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {phase === "loading" && (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {phase === "invalid" && (
          <div className="max-w-md mx-auto text-center py-20">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h1 className="text-xl font-semibold mb-2">Link inválido ou expirado</h1>
            <p className="text-sm text-muted-foreground">
              Este contrato não está disponível. Solicite um novo link com sua agência.
            </p>
          </div>
        )}

        {(phase === "ready" || phase === "signing") && contract && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24 }}>
            <div className="mb-6">
              <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-1">Contrato para assinatura</p>
              <h1 className="text-2xl md:text-3xl font-semibold mb-2">{contract.title}</h1>
              {contract.description && <p className="text-sm text-muted-foreground">{contract.description}</p>}
              {contract.admin_signature_name && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                  Já assinado por <strong className="text-foreground">{contract.admin_signature_name}</strong>
                </p>
              )}
            </div>

            <iframe
              src={`${contract.original_file_url}#toolbar=1&view=FitH`}
              className="w-full h-[60vh] rounded-xl border border-border bg-white mb-8"
              title={contract.title}
            />

            <div className="bg-card border border-border rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <FileSignature className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Assinatura digital</h2>
              </div>
              <div className="space-y-1.5">
                <Label>Seu nome completo</Label>
                <Input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  placeholder="Como deve aparecer na assinatura"
                  disabled={phase === "signing"}
                />
              </div>
              <div className="flex items-start gap-2 pt-1">
                <Checkbox id="client-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className="mt-0.5" disabled={phase === "signing"} />
                <Label htmlFor="client-accept" className="text-sm font-normal leading-relaxed cursor-pointer">
                  Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
                </Label>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                onClick={handleSign}
                disabled={phase === "signing"}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-11"
              >
                {phase === "signing" ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registrando assinatura...</>
                ) : (
                  <><FileSignature className="w-4 h-4 mr-2" /> Assinar contrato</>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Sua assinatura ficará registrada com data, hora e endereço IP.
              </p>
            </div>
          </motion.div>
        )}

        {phase === "done" && contract && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 22 }}
            className="max-w-md mx-auto text-center py-12"
          >
            <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-success" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Contrato assinado! 🎉</h1>
            <p className="text-sm text-muted-foreground mb-8">
              Sua assinatura foi registrada com sucesso. Uma cópia ficará disponível no seu portal, na pasta <strong className="text-foreground">Contratos</strong>.
            </p>
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <a href={contract.original_file_url} download={contract.original_file_name}>
                <Download className="w-4 h-4 mr-2" /> Baixar contrato
              </a>
            </Button>
          </motion.div>
        )}
      </main>
    </div>
  );
}
