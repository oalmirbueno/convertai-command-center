import type { AdsOAuthResult, CompleteMetaOAuthResult } from "@/lib/socialMetaOAuth";
import {
  completeAdsOAuth,
  ehLoginDeAnuncios,
  esquecerLoginDeAnuncios,
} from "@/lib/socialMetaOAuth";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  completeMetaOAuth,
  META_OAUTH_CALLBACK_PATH,
  META_OAUTH_MESSAGE_TYPE,
  safeMetaOAuthError,
  type MetaOAuthPopupMessage,
} from "@/lib/socialMetaOAuth";

type CallbackStatus = "loading" | "success" | "error";

/** O que cada caminho devolve, já com a etiqueta de quem é o dono. */
type RetornoDoLogin =
  | ({ ok: true; alvo: "social" } & CompleteMetaOAuthResult)
  | ({ ok: true; alvo: "anuncios" } & AdsOAuthResult);

const metaOAuthCompletions = new Map<string, Promise<RetornoDoLogin>>();

/**
 * O retorno do login sabe de onde veio pela marca presa ao `state`.
 *
 * Conexão de anúncios e conexão de rede social voltam pela MESMA rota de
 * callback, mas terminam em lugares diferentes: uma guarda o acesso de
 * anúncios, a outra grava as contas de Instagram. Mandar o retorno de
 * anúncios pelo caminho social faria a sessão não bater e a pessoa veria
 * "expirou" sem ter expirado nada.
 */
function completeMetaOAuthOnce(code: string, state: string) {
  const existing = metaOAuthCompletions.get(state);
  if (existing) return existing;
  const completion: Promise<RetornoDoLogin> = ehLoginDeAnuncios(state)
    ? completeAdsOAuth({ code, state })
      .finally(() => esquecerLoginDeAnuncios(state))
      .then((r) => ({ ...r, alvo: "anuncios" as const }))
    : completeMetaOAuth({ code, state })
      .then((r) => ({ ...r, ok: true as const, alvo: "social" as const }));
  metaOAuthCompletions.set(state, completion);
  return completion;
}

function sameOriginOpener() {
  const opener = window.opener;
  if (!opener || opener.closed) return null;

  try {
    return opener.location.origin === window.location.origin ? opener : null;
  } catch {
    return null;
  }
}

function notifySameOriginOpener(message: MetaOAuthPopupMessage) {
  const opener = sameOriginOpener();
  if (!opener) return false;
  opener.postMessage(message, window.location.origin);
  return true;
}

export default function MetaOAuthCallback() {
  const [status, setStatus] = useState<CallbackStatus>("loading");
  const [message, setMessage] = useState(
    "Validando a conexão oficial com a Meta…",
  );
  const callbackParamsRef = useRef<{
    code: string;
    state: string;
    providerError: string;
  } | null>(null);

  if (!callbackParamsRef.current) {
    const params = new URLSearchParams(window.location.search);
    callbackParamsRef.current = {
      code: params.get("code") || "",
      state: params.get("state") || "",
      providerError:
        params.get("error_description") || params.get("error") || "",
    };
  }

  useEffect(() => {
    let active = true;
    const { code, state, providerError } = callbackParamsRef.current!;

    window.history.replaceState(null, document.title, META_OAUTH_CALLBACK_PATH);

    const finish = (result: MetaOAuthPopupMessage) => {
      if (!active) return;
      const delivered = notifySameOriginOpener(result);
      setStatus(result.ok === true ? "success" : "error");
      setMessage(
        result.ok === true
          ? "Conexão confirmada. Você já pode voltar ao painel."
          : result.error,
      );
      if (delivered) window.close();
    };

    if (providerError || !code || !state) {
      finish({
        type: META_OAUTH_MESSAGE_TYPE,
        ok: false,
        error: providerError
          ? safeMetaOAuthError(providerError)
          : "A resposta da Meta está incompleta. Inicie a conexão novamente.",
      });
      return () => {
        active = false;
      };
    }

    void completeMetaOAuthOnce(code, state)
      .then((result) => {
        finish({ type: META_OAUTH_MESSAGE_TYPE, ...result });
      })
      .catch((error: unknown) => {
        finish({
          type: META_OAUTH_MESSAGE_TYPE,
          ok: false,
          error: safeMetaOAuthError(
            error instanceof Error ? error.message : error,
          ),
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        {status === "loading" ? (
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        ) : status === "success" ? (
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
        ) : (
          <XCircle className="mx-auto h-8 w-8 text-destructive" />
        )}
        <h1 className="mt-4 text-base font-semibold text-foreground">
          Conexão Meta
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground" role="status">
          {message}
        </p>
      </div>
    </main>
  );
}
