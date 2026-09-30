import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, FileSignature, CheckCircle2, Download, ShieldCheck, AlertCircle, ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CampoDeFormulario, EstadoDeErro, EstadoVazio, Painel, botao, juntar, texto, toqueCompacto } from "@/components/sistema";
import CascaPublica, { campoPublico } from "@/components/publico/CascaPublica";
import { useLarguraMinima } from "@/hooks/useLarguraMinima";

// Frente CON (30/09): contrato montado por modelo mostra o texto congelado com o código SHA-256.
const DocumentoDoContrato = lazy(() => import("@/components/contratos/DocumentoDoContrato"));

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contract-public`;
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// UXS (30/09): "erro" é falha de rede, resposta sem JSON ou 5xx (tem "Tentar de novo");
// "invalid" fica só para a resposta do servidor (400, 404, link que não existe).
type Phase = "loading" | "invalid" | "replaced" | "erro" | "ready" | "signing" | "done";

export default function ContractPublic() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [contract, setContract] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [signName, setSignName] = useState("");
  const [signEmail, setSignEmail] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfFinal, setPdfFinal] = useState<string | null>(null);
  // Frente CON2: link de uma pessoa da lista de quem assina (outro signatário do cliente ou testemunha).
  const [signatario, setSignatario] = useState<{ papel: string; nome: string; email: string; assinado_em: string | null } | null>(null);
  const [assinaturas, setAssinaturas] = useState<Array<{ papel: string; nome: string; assinado: boolean }>>([]);
  const [faltam, setFaltam] = useState(0);
  const [tentativa, setTentativa] = useState(0);
  // Abaixo de 640 px o iframe do PDF não é montado (no iPhone ele mostra só a primeira página).
  const pdfNaPagina = useLarguraMinima(640);

  useEffect(() => {
    if (!token) { setPhase("invalid"); return; }
    let vivo = true;
    setPhase("loading");
    fetch(`${FN_URL}?token=${encodeURIComponent(token)}`, {
      headers: { "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "" },
    })
      .then(async (r) => {
        let corpo: any = null;
        try {
          corpo = await r.json();
        } catch {
          corpo = null;
        }
        return { status: r.status, res: corpo };
      })
      .then(({ status, res }) => {
        if (!vivo) return;
        if (status === 410 || (res && res.error === "substituido")) return setPhase("replaced");
        if (status === 400 || status === 404) return setPhase("invalid");
        if (status >= 500 || !res) return setPhase("erro");
        if (res.error || !res.contract) return setPhase("invalid");
        setContract(res.contract);
        setClient(res.client);
        setSignatario(res.signatario || null);
        setAssinaturas(Array.isArray(res.assinaturas) ? res.assinaturas : []);
        setSignName(res.signatario ? res.signatario.nome : res.client?.full_name || "");
        setSignEmail(res.signatario ? res.signatario.email : res.client?.email || "");
        if (res.contract.client_signed_at || (res.signatario && res.signatario.assinado_em)) setPhase("done");
        else setPhase("ready");
      })
      .catch(() => {
        if (vivo) setPhase("erro");
      });
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  const modelo = !!contract && contract.origem === "modelo";

  const handleSign = async () => {
    // Diz exatamente o que falta (UXS), na linha logo acima do botão.
    const falta = !signName.trim()
      ? "Escreva seu nome completo."
      : modelo && !EMAIL_VALIDO.test(signEmail.trim())
        ? "Escreva um e-mail válido."
        : !accept
          ? "Para assinar, marque a confirmação de leitura."
          : null;
    if (falta) {
      setError(falta);
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
        body: JSON.stringify(
          modelo
            ? { token, signature_name: signName.trim(), email: signEmail.trim(), accept: true, hash: contract.documento_hash }
            : { token, signature_name: signName.trim(), accept: true },
        ),
      });
      // Resposta sem JSON (queda no meio do caminho) vira frase, não "Unexpected token".
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.error) throw new Error((data && (data.mensagem || data.error)) || "Não deu para registrar a assinatura agora. Tente de novo.");
      if (data.pdf_url) setPdfFinal(String(data.pdf_url));
      setPhase("done");
      if (signatario && !data.concluido) {
        // Assinou; o contrato fecha quando todos assinarem.
        setFaltam(Number(data.faltam) || 0);
        setSignatario((x) => (x ? { ...x, assinado_em: new Date().toISOString() } : x));
      } else setContract((c: any) => ({ ...c, client_signed_at: new Date().toISOString(), client_signature_name: signName.trim(), status: "completed" }));
    } catch (e: any) {
      // Queda de rede chega como TypeError em inglês ("Failed to fetch").
      setError(e instanceof TypeError ? "A conexão falhou. Confira a internet e tente de novo." : e.message);
      setPhase("ready");
    }
  };

  const pronto = (phase === "ready" || phase === "signing") && !!contract;
  const baixarUrl = modelo ? pdfFinal || contract?.pdf_url : contract?.original_file_url;

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

      {phase === "erro" && (
        <EstadoDeErro
          titulo="Não deu para abrir o contrato agora."
          acao={
            <button type="button" className={botao.secundario} onClick={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </button>
          }
        />
      )}

      {phase === "replaced" && (
        <EstadoVazio
          icone={<AlertCircle className="h-5 w-5 text-warning" />}
          titulo="Este link foi substituído"
          descricao="Há uma versão nova do contrato. Peça o link novo para a sua agência."
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

          {assinaturas.length > 1 && (
            <p className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center [&>*]:mr-3")}>
              {assinaturas.map((a, i) => (
                <span key={i} className="inline-flex items-center">
                  {a.assinado ? <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-success" aria-hidden="true" /> : null}
                  {a.nome}
                  {a.papel === "testemunha" ? " (testemunha)" : ""}
                </span>
              ))}
            </p>
          )}
          {modelo ? (
            <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-lg bg-muted/70" aria-busy="true" />}>
              <DocumentoDoContrato texto={contract.documento_texto || ""} hash={contract.documento_hash} />
            </Suspense>
          ) : (
            <div className="min-w-0 space-y-3">
              {/* O link fica em todas as larguras; no celular é o único jeito de ler o PDF inteiro. */}
              <a href={contract.original_file_url} target="_blank" rel="noopener noreferrer" className={botao.secundario}>
                <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir o contrato completo (PDF)
              </a>
              {pdfNaPagina && (
                <iframe
                  src={`${contract.original_file_url}#toolbar=1&view=FitH`}
                  className="h-[60vh] w-full rounded-lg border border-border bg-white"
                  title={contract.title}
                />
              )}
            </div>
          )}

          <Painel
            titulo="Assinatura digital"
            rodape={
              <>
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
              <CampoDeFormulario rotulo="Seu nome completo" obrigatorio apoio="Como deve aparecer na assinatura.">
                <input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  disabled={phase === "signing"}
                  autoComplete="name"
                  className={campoPublico}
                />
              </CampoDeFormulario>
              {modelo && (
                <CampoDeFormulario rotulo="Seu e-mail" obrigatorio apoio={signatario ? "O e-mail cadastrado para esta assinatura." : "Vai para a página de carimbo do contrato."}>
                  <input
                    value={signEmail}
                    onChange={(e) => setSignEmail(e.target.value)}
                    disabled={phase === "signing"}
                    type="email"
                    autoComplete="email"
                    className={campoPublico}
                  />
                </CampoDeFormulario>
              )}
              <div className="flex items-start">
                <Checkbox id="client-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className={juntar(toqueCompacto, "mr-2 mt-0.5")} disabled={phase === "signing"} />
                <label htmlFor="client-accept" className={juntar(texto.corpo, "cursor-pointer")}>
                  Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
                </label>
              </div>
              {/* Uma linha só sobre o registro, em todas as larguras. */}
              <p className={texto.auxiliar}>
                {modelo ? "Seu nome, e-mail, IP, data e hora ficam no contrato como prova da assinatura (LGPD)." : "Seu nome, IP, data e hora ficam registrados como prova da assinatura."}
              </p>
              {/* O erro num lugar só: logo acima do botão Assinar (validação e resposta do servidor). */}
              {error && (
                <p role="alert" className={juntar(texto.corpo, "text-destructive")} data-erro-da-assinatura="">
                  {error}
                </p>
              )}
            </div>
          </Painel>
        </div>
      )}

      {phase === "done" && contract && signatario && !contract.client_signed_at && (
        <EstadoVazio
          icone={<CheckCircle2 className="h-5 w-5 text-success" />}
          titulo="Sua assinatura está registrada"
          descricao={faltam ? `Faltam ${faltam} ${faltam === 1 ? "assinatura" : "assinaturas"}. O contrato final sai quando todos assinarem.` : "O contrato final sai quando todos assinarem."}
        />
      )}

      {phase === "done" && contract && (!signatario || contract.client_signed_at) && (
        <EstadoVazio
          icone={<CheckCircle2 className="h-5 w-5 text-success" />}
          titulo="Contrato assinado"
          descricao="Sua assinatura foi registrada. Uma cópia fica no seu portal, na pasta Contratos."
          acao={
            baixarUrl ? (
              <a href={baixarUrl} download={contract.original_file_name} className={botao.primario} target={modelo ? "_blank" : undefined} rel="noreferrer">
                <Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> Baixar contrato
              </a>
            ) : undefined
          }
        />
      )}
    </CascaPublica>
  );
}
