import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { isChunkError } from "@/lib/appRefresh";

/**
 * Barreira de erro POR TELA.
 *
 * Antes, qualquer erro de render em uma página subia até a barreira do boot
 * (AppErrorBoundary), que recarrega o app inteiro. Uma tela com defeito
 * derrubava o painel todo, com a pessoa perdendo o que estava fazendo nas
 * outras. Aqui o erro fica contido na rota: a pessoa vê o aviso, volta para
 * o painel ou tenta a mesma tela de novo, sem recarregar nada.
 *
 * Pedaço de versão antiga que não baixou (chunk) NÃO é tratado aqui: esse
 * precisa da recarga forçada do boot, então é relançado para a barreira de
 * cima.
 */

interface Props {
  children: ReactNode;
  /** Muda a cada navegação: navegar para outra tela limpa o erro sozinho. */
  resetKey: string;
}

interface State {
  error: Error | null;
  resetKey: string;
}

class RouteErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error || "erro")) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Trocou de rota: a tela nova começa limpa.
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[painel] erro de render na rota:", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Chunk faltando é problema de versão, não da tela: sobe para o boot.
    if (isChunkError(error)) throw error;

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <p className="text-lg font-semibold text-foreground">Algo travou nesta tela</p>
        <p className="max-w-[420px] text-sm leading-relaxed text-muted-foreground">
          O resto do painel continua funcionando. Você pode tentar abrir esta tela de novo
          ou voltar para o início.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
          >
            Tentar de novo
          </button>
          <Link
            to="/dashboard"
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:border-primary/50 transition-colors"
          >
            Voltar para o painel
          </Link>
        </div>
        {error.message && (
          <p className="mt-4 max-w-[420px] break-words font-mono text-[11px] leading-relaxed text-muted-foreground/60">
            Detalhe técnico: {error.message.slice(0, 300)}
          </p>
        )}
      </div>
    );
  }
}

export default function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundaryInner resetKey={location.pathname + location.search}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
