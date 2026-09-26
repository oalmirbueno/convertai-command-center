import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { CampoDeFormulario, Carregando, GrupoDeCampos, botao, juntar, superficie, texto } from "@/components/sistema";
import CascaPublica, { CampoDeSenha, campoPublico } from "@/components/publico/CascaPublica";

function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (pw.length < 12) return { level: 0, label: "Muito curta", color: "#FF3B3B" };
  const checks = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^A-Za-z0-9]/.test(pw),
  ];
  const score = checks.filter(Boolean).length;
  if (score <= 2) return { level: 33, label: "Fraca", color: "#FF3B3B" };
  if (score === 3) return { level: 66, label: "Média", color: "#FFB800" };
  return { level: 100, label: "Forte", color: "#00FF66" };
}

type Phase = "loading" | "form" | "invalid" | "used" | "done" | "slow";

/**
 * Nenhuma espera desta tela fica sem saida. Cliente novo via a roda girando
 * para sempre ao criar a senha: a chamada travava (rede ruim, navegador
 * antigo, funcao fria) e nada avisava. Agora toda espera tem prazo, e quando
 * estoura a pessoa ve o que houve e um botao para tentar de novo.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (reason) => { clearTimeout(timer); reject(reason); },
    );
  });
}

const VALIDATE_TIMEOUT_MS = 20_000;
const SUBMIT_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 12_000;

export default function FirstAccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithCredentials } = useAuth();
  // Link copiado do WhatsApp ou do e-mail pode chegar com espaco, quebra de
  // linha ou maiuscula no meio: limpa antes de validar.
  const token = (params.get("token") || "").replace(/\s+/g, "").toLowerCase();

  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Onde o erro aparece: no lugar do apoio do campo da senha ou da confirmação.
  const [errorField, setErrorField] = useState<"senha" | "confirmar">("confirmar");
  const [accountEmail, setAccountEmail] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [resendEmail, setResendEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // Sem beco sem saida: quem cai em "link invalido", "ja usado" ou "demorou"
  // pede o link de novo aqui mesmo, sem depender da equipe. O servidor
  // responde sempre igual e reenvia o MESMO link enquanto ele vale.
  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = resendEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setResendState("error"); return; }
    setResendState("sending");
    try {
      const { error } = await withTimeout(
        supabase.functions.invoke("client-first-access", { body: { action: "resend", email } }),
        VALIDATE_TIMEOUT_MS,
      );
      if (error) throw error;
      setResendState("sent");
    } catch {
      setResendState("error");
    }
  };

  // Um primário por área: no "link inválido" o reenvio é a saída principal;
  // em "demorou" e "já usado" o principal é outro e o reenvio fica secundário.
  const reenvioPrincipal = phase === "invalid";
  const reenviar = (
    <form onSubmit={handleResend} className={juntar(superficie.divisoria, "mt-8 min-w-0 pt-6")}>
      {resendState === "sent" ? (
        <p className={juntar(texto.corpo, "text-muted-foreground")} role="status">
          Se este e-mail estiver cadastrado, o link chega em instantes. Confira também a caixa de spam.
        </p>
      ) : (
        <>
          <label htmlFor="primeiro-acesso-reenvio" className={juntar(texto.rotulo, "mb-1.5 block")}>Receber o link de novo</label>
          <div className="flex min-w-0 items-start">
            <input
              id="primeiro-acesso-reenvio"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={resendEmail}
              onChange={(e) => { setResendEmail(e.target.value); if (resendState === "error") setResendState("idle"); }}
              placeholder="Seu e-mail cadastrado"
              aria-invalid={resendState === "error" || undefined}
              aria-describedby={resendState === "error" ? "primeiro-acesso-reenvio-erro" : undefined}
              className={juntar(campoPublico, "flex-1")}
            />
            <button type="submit" disabled={resendState === "sending"}
              className={juntar(reenvioPrincipal ? botao.primario : botao.secundario, "ml-2")}>
              {resendState === "sending" ? "Enviando..." : "Enviar link"}
            </button>
          </div>
          {resendState === "error" && (
            <p id="primeiro-acesso-reenvio-erro" role="alert" className="mt-1.5 text-[12px] leading-4 text-destructive">Confira o e-mail e tente de novo.</p>
          )}
        </>
      )}
    </form>
  );

  const strength = getPasswordStrength(password);

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      return;
    }
    let alive = true;
    setPhase("loading");
    (async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("client-first-access", {
            body: { action: "validate", token },
          }),
          VALIDATE_TIMEOUT_MS,
        );
        if (!alive) return;
        if (error) throw error;
        if (data?.valid) {
          if (typeof data.email === "string") setAccountEmail(data.email);
          setPhase("form");
        } else if (data?.error === "used") {
          setPhase("used");
        } else {
          setPhase("invalid");
        }
      } catch (err) {
        if (!alive) return;
        // Demorou ou a rede caiu: nao e link invalido, e espera que estourou.
        const message = err instanceof Error ? err.message : "";
        const isNetwork = message === "timeout" || /fetch|network|Failed to send/i.test(message);
        setPhase(isNetwork ? "slow" : "invalid");
      }
    })();
    return () => { alive = false; };
  }, [token, attempt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (
      password.length < 12
      || !/[a-z]/.test(password)
      || !/[A-Z]/.test(password)
      || !/[0-9]/.test(password)
      || !/[^A-Za-z0-9]/.test(password)
    ) {
      setErrorField("senha");
      setError("Use ao menos 12 caracteres, com maiúscula, minúscula, número e símbolo.");
      return;
    }
    setErrorField("confirmar");
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("client-first-access", {
          body: { action: "set_password", token, password },
        }),
        SUBMIT_TIMEOUT_MS,
      );
      if (error) throw error;
      if (data?.error) {
        setError(data.message || data.error);
        setSubmitting(false);
        return;
      }
      const email = typeof data?.email === "string" && data.email ? data.email : accountEmail;
      setAccountEmail(email);
      setPhase("done");

      // A senha JA existe a partir daqui. Entrar sozinho e cortesia: se nao
      // der em alguns segundos, a pessoa vai para o login com a senha valendo,
      // em vez de ficar olhando a roda girar.
      try {
        if (!email) throw new Error("Email unavailable");
        await withTimeout(loginWithCredentials(email, password), LOGIN_TIMEOUT_MS);
        navigate("/dashboard", { replace: true });
      } catch {
        navigate("/login", { replace: true, state: { email, passwordJustCreated: true } });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message === "timeout"
          ? "A conexão demorou demais. Confira a internet e toque em Criar senha de novo."
          : message || "Não foi possível criar a senha. Tente novamente.",
      );
      setSubmitting(false);
    }
  };

  const textos: Record<Phase, { titulo: string; descricao: string }> = {
    loading: { titulo: "Primeiro acesso", descricao: "Validando seu acesso..." },
    form: { titulo: "Bem-vindo", descricao: "Crie a senha que você vai usar no portal Aceleriq." },
    invalid: { titulo: "Link inválido ou expirado", descricao: "Peça o link de novo abaixo ou entre, se já tem senha." },
    slow: { titulo: "A conexão demorou demais", descricao: "Confira a internet e tente de novo. O link continua valendo." },
    used: { titulo: "Senha já criada", descricao: "É só entrar com seu e-mail e a senha que você escolheu." },
    done: { titulo: "Tudo pronto", descricao: "Senha criada. Entrando no portal..." },
  };
  const erroDaSenha = error && errorField === "senha" ? error : undefined;
  const erroDaConfirmacao = error && errorField === "confirmar" ? error : undefined;
  const linkDiscreto = "rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <CascaPublica titulo={textos[phase].titulo} descricao={textos[phase].descricao}>
      {phase === "loading" && <Carregando linhas={3} rotulo="Validando seu acesso" />}

      {phase === "invalid" && (
        <div className="min-w-0">
          <button type="button" onClick={() => navigate("/login")} className={linkDiscreto}>
            Ir para o login
          </button>
          {reenviar}
        </div>
      )}

      {phase === "slow" && (
        <div className="min-w-0">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={botao.primario}>
            Tentar novamente
          </button>
          {reenviar}
        </div>
      )}

      {phase === "used" && (
        <div className="min-w-0">
          <button type="button" onClick={() => navigate("/login")} className={botao.primario}>
            Fazer login
          </button>
          {reenviar}
        </div>
      )}

      {phase === "done" && (
        <div className="min-w-0">
          <button type="button" onClick={() => navigate("/login", { replace: true, state: { email: accountEmail, passwordJustCreated: true } })}
            className={linkDiscreto}>
            Ir para o login agora
          </button>
        </div>
      )}

      {phase === "form" && (
        <form onSubmit={handleSubmit} className="min-w-0">
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario
              rotulo="Crie sua senha"
              erro={erroDaSenha}
              apoio={password.length > 0 ? (
                <span className="flex min-w-0 items-center">
                  <span className="mr-2 block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${strength.level}%`, backgroundColor: strength.color }} />
                  </span>
                  <span className="shrink-0" style={{ color: strength.color }}>{strength.label}</span>
                </span>
              ) : "Maiúscula, minúscula, número e símbolo."}
            >
              <CampoDeSenha value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 12 caracteres" autoFocus autoComplete="new-password"
                mostrar={showPw} aoAlternar={() => setShowPw(!showPw)} />
            </CampoDeFormulario>

            <CampoDeFormulario rotulo="Confirme a senha" erro={erroDaConfirmacao}>
              <CampoDeSenha value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a senha" autoComplete="new-password"
                mostrar={showPw} aoAlternar={() => setShowPw(!showPw)} />
            </CampoDeFormulario>
          </GrupoDeCampos>

          <button type="submit" disabled={submitting} className={juntar(botao.primario, "mt-6 w-full")}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitting ? "Criando a senha..." : "Criar senha e entrar"}
          </button>
        </form>
      )}
    </CascaPublica>
  );
}
