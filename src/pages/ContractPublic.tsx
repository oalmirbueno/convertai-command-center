import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, FileSignature, CheckCircle2, Download, ShieldCheck, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CampoDeFormulario, EstadoVazio, Painel, botao, campo, juntar, texto } from "@/components/sistema";
import CascaPublica from "@/components/publico/CascaPublica";

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
      .then((res) => {
        if (res.error || !res.contract) return setPhase("invalid");
        setContract(res.contract);
        setClient(res.client);
        setSignName(res.client?.full_name || "");
        if (res.contract.client_signed_at) setPhase("done");
        else setPhase("ready");
      })
      .catch(() => setPhase("invalid"));
  }, [token]);

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

  const pronto = (phase === "ready" || phase === "signing") && !!contract;

  // A casca das páginas públicas (logo, título numa linha, uma linha de apoio),
  // na largura de documento para o PDF caber.
  return (
    <CascaPublica
      largura="documento"
      centralizar={false}
      aoLadoDaMarca={
        <span className={juntar(texto.auxiliar, "inline-flex items-center")}>
          <ShieldCheck className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" /> Assinatura segura
        </span>
      }
      acimaDoTitulo={pronto ? <p className={juntar(texto.rotulo, "mb-1")}>Contrato para assinatura</p> : undefined}
      titulo={pronto ? contract.title : undefined}
      descricao={pronto && contract.description ? contract.description : undefined}
    >
      {phase === "loading" && (
        <div className="space-y-4" aria-busy="true" aria-label="Carregando contrato">
          <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted sm:w-1/3" />
          <div className="h-[60vh] animate-pulse rounded-lg bg-muted/70" />
        </div>
      )}

      {phase === "invalid" && (
        <EstadoVazio
          icone={<AlertCircle className="h-5 w-5 text-destructive" />}
          titulo="Link inválido ou expirado"
          descricao="Este contrato não está disponível. Peça um novo link para a sua agência."
        />
      )}

      {(phase === "ready" || phase === "signing") && contract && (
        <div className="space-y-5">
          {contract.admin_signature_name && (
            <p className={juntar(texto.auxiliar, "-mt-4 flex items-center")}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-success" aria-hidden="true" />
              Já assinado por <strong className="ml-1 text-foreground">{contract.admin_signature_name}</strong>
            </p>
          )}

          <iframe
            src={`${contract.original_file_url}#toolbar=1&view=FitH`}
            className="h-[60vh] w-full rounded-lg border border-border bg-white"
            title={contract.title}
          />

          <Painel
            titulo="Assinatura digital"
            rodape={
              <>
                <span className={juntar(texto.auxiliar, "mr-auto hidden sm:inline")}>Fica registrada com data, hora e endereço IP.</span>
                <button type="button" onClick={handleSign} disabled={phase === "signing"} className={juntar(botao.primario, "h-10 w-full sm:w-auto")}>
                  {phase === "signing" ? (
                    <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> Registrando assinatura...</>
                  ) : (
                    <><FileSignature className="mr-1.5 h-4 w-4" aria-hidden="true" /> Assinar contrato</>
                  )}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <CampoDeFormulario rotulo="Seu nome completo" obrigatorio apoio="Como deve aparecer na assinatura." erro={error || undefined}>
                <input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  disabled={phase === "signing"}
                  autoComplete="name"
                  className={juntar(campo, "text-[16px] sm:text-[13px]")}
                />
              </CampoDeFormulario>
              <div className="flex items-start">
                <Checkbox id="client-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className="mr-2 mt-0.5" disabled={phase === "signing"} />
                <label htmlFor="client-accept" className={juntar(texto.corpo, "cursor-pointer")}>
                  Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
                </label>
              </div>
              <p className={juntar(texto.auxiliar, "sm:hidden")}>Fica registrada com data, hora e endereço IP.</p>
            </div>
          </Painel>
        </div>
      )}

      {phase === "done" && contract && (
        <EstadoVazio
          icone={<CheckCircle2 className="h-5 w-5 text-success" />}
          titulo="Contrato assinado"
          descricao="Sua assinatura foi registrada. Uma cópia fica no seu portal, na pasta Contratos."
          acao={
            <a href={contract.original_file_url} download={contract.original_file_name} className={botao.primario}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Baixar contrato
            </a>
          }
        />
      )}
    </CascaPublica>
  );
}
