import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  BUILD_ID, hardRefresh, isChunkError, recordFatalCrash, refreshExhausted,
} from "@/lib/appRefresh";

/**
 * Última linha de defesa contra a tela branca. Qualquer erro de render (ou
 * pedaço de versão antiga que não carregou) cai aqui: primeiro o app tenta se
 * atualizar sozinho; se as tentativas automáticas esgotaram, a pessoa vê uma
 * tela clara com um botão que resolve, nunca uma página em branco.
 *
 * Estilos inline de propósito: esta tela precisa funcionar mesmo quando o CSS
 * ou os chunks do app falharam.
 */

interface State {
  failed: boolean;
  autoRecovering: boolean;
  detail: string | null;
}

export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, autoRecovering: false, detail: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : String(error || "");
    return { failed: true, detail: message.slice(0, 300) || null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A causa real precisa sobreviver à tela bonita: sem isto, todo crash
    // vira só "deu bug" e ninguém consegue investigar depois.
    console.error("[painel] erro fatal de render:", error, info?.componentStack);
    if (isChunkError(error) && !refreshExhausted()) {
      this.setState({ autoRecovering: true });
      hardRefresh();
      return;
    }

    // Soluço passageiro (dados no meio de uma publicação, estado velho): a
    // tela se recupera SOZINHA até duas vezes. Só o erro que insiste na mesma
    // versão vira tela manual, com o detalhe técnico à vista — e nunca em loop.
    const signature = `${BUILD_ID}:${error?.message || ""}`.slice(0, 200);
    if (recordFatalCrash(signature) <= 2) {
      this.setState({ autoRecovering: true });
      window.setTimeout(() => hardRefresh(true), 1_200);
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    if (this.state.autoRecovering) {
      return (
        <div style={styles.screen}>
          <p style={styles.title}>Atualizando o painel...</p>
          <p style={styles.text}>Uma versão nova acabou de sair. Só um instante.</p>
        </div>
      );
    }

    return (
      <div style={styles.screen}>
        <p style={styles.title}>Algo travou nesta tela</p>
        <p style={styles.text}>
          O painel tentou se recuperar sozinho e não conseguiu. Toque no botão abaixo para
          recarregar; se esta tela voltar, mande o detalhe técnico para a Aceleriq.
        </p>
        <button type="button" style={styles.button} onClick={() => hardRefresh(true)}>
          Recarregar agora
        </button>
        {this.state.detail && (
          <p style={styles.detail}>Detalhe técnico: {this.state.detail}</p>
        )}
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    textAlign: "center",
    background: "#0D0D0D",
    color: "#F5F5F5",
    fontFamily: "'Outfit', system-ui, sans-serif",
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
  },
  text: {
    fontSize: 14,
    lineHeight: 1.6,
    maxWidth: 420,
    margin: 0,
    color: "rgba(245,245,245,0.75)",
  },
  detail: {
    marginTop: 16,
    maxWidth: 420,
    fontSize: 11,
    lineHeight: 1.5,
    color: "rgba(245,245,245,0.45)",
    fontFamily: "'JetBrains Mono', monospace",
    wordBreak: "break-word",
  },
  button: {
    marginTop: 8,
    padding: "14px 28px",
    borderRadius: 12,
    border: "none",
    background: "hsl(145 100% 50%)",
    color: "#0D0D0D",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    minHeight: 48,
  },
};
