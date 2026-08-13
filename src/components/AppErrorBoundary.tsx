import { Component, type ErrorInfo, type ReactNode } from "react";
import { hardRefresh, isChunkError, refreshExhausted } from "@/lib/appRefresh";

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
}

export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, autoRecovering: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (isChunkError(error) && !refreshExhausted()) {
      this.setState({ autoRecovering: true });
      hardRefresh();
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
        <p style={styles.title}>O painel foi atualizado</p>
        <p style={styles.text}>
          Saiu uma versão nova enquanto esta tela estava aberta. Toque no botão abaixo para
          continuar de onde parou.
        </p>
        <button type="button" style={styles.button} onClick={() => hardRefresh(true)}>
          Recarregar agora
        </button>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: "100vh",
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
