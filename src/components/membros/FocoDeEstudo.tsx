import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Timer,
  Coffee,
  Check,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { AjudaRecolhida } from "@/components/sistema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
const DURACOES = { foco: 25 * 60, pausa: 5 * 60, descanso: 15 * 60 };
type Etapa = keyof typeof DURACOES;
type Estado = {
  etapa: Etapa;
  restante: number;
  termina: number | null;
  sessoes: number;
};
const inicial = (): Estado => ({
  etapa: "foco",
  restante: DURACOES.foco,
  termina: null,
  sessoes: 0,
});
function ler(chave: string): Estado {
  try {
    const e = JSON.parse(localStorage.getItem(chave) || "null");
    if (
      e &&
      ["foco", "pausa", "descanso"].includes(e.etapa) &&
      Number.isFinite(e.restante) &&
      e.restante >= 0 &&
      e.restante <= 3600 &&
      (e.termina === null || Number.isFinite(e.termina)) &&
      Number.isInteger(e.sessoes) &&
      e.sessoes >= 0
    )
      return e;
  } catch {
    /* Conteúdo local inválido volta ao relógio inicial. */
  }
  return inicial();
}
type Contexto = {
  abrir: () => void;
  restante: number;
  rodando: boolean;
  minimizar: boolean;
  alternar: () => void;
};
const ContextoFoco = createContext<Contexto>({
  abrir: () => {},
  restante: 1500,
  rodando: false,
  minimizar: false,
  alternar: () => {},
});
const formatarTempo = (segundos: number) =>
  `${Math.floor(segundos / 60)
    .toString()
    .padStart(2, "0")}:${(segundos % 60).toString().padStart(2, "0")}`;
export function BotaoPomodoro({ compacto = false }: { compacto?: boolean }) {
  const foco = useContext(ContextoFoco);
  return (
    <button
      className="membros-acao"
      onClick={foco.abrir}
      aria-label="Abrir Pomodoro"
      title="Pomodoro"
    >
      <Timer size={17} />
      {!compacto && (
        <span>{foco.rodando ? formatarTempo(foco.restante) : "Pomodoro"}</span>
      )}
    </button>
  );
}
export function PomodoroCompacto({
  flutuante = false,
}: {
  flutuante?: boolean;
}) {
  const foco = useContext(ContextoFoco);
  if (!foco.minimizar) return null;
  return (
    <aside
      className={`membros-foco-compacto ${flutuante ? "flutuante" : ""}`}
      aria-label="Pomodoro compacto"
    >
      <Timer size={16} className="text-primary" />
      <span
        role="timer"
        aria-label="Tempo restante no Pomodoro"
        className="tabular-nums text-[13px]"
      >
        {formatarTempo(foco.restante)}
      </span>
      <button
        className="membros-acao"
        aria-label={foco.rodando ? "Pausar Pomodoro" : "Continuar Pomodoro"}
        onClick={foco.alternar}
      >
        {foco.rodando ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        className="membros-acao"
        aria-label="Expandir Pomodoro"
        onClick={foco.abrir}
      >
        <Maximize2 size={15} />
      </button>
    </aside>
  );
}
export function FocoDeEstudo({
  usuario,
  children,
  leitorAberto = false,
}: {
  usuario: string;
  children: ReactNode;
  leitorAberto?: boolean;
}) {
  const chave = `membros:foco:${usuario}`;
  const [estado, setEstado] = useState<Estado>(() => ler(chave));
  const [agora, setAgora] = useState(Date.now());
  const [aberto, setAberto] = useState(false);
  const [minimizado, setMinimizado] = useState(false);
  const [aviso, setAviso] = useState("");
  const restante =
    estado.termina === null
      ? estado.restante
      : Math.max(0, Math.ceil((estado.termina - agora) / 1000));
  useEffect(() => {
    try {
      localStorage.setItem(chave, JSON.stringify(estado));
    } catch {
      /* O relógio continua mesmo se o navegador bloquear armazenamento. */
    }
  }, [chave, estado]);
  useEffect(() => {
    if (!estado.termina) return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    const atualizar = () => setAgora(Date.now());
    document.addEventListener("visibilitychange", atualizar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", atualizar);
    };
  }, [estado.termina]);
  useEffect(() => {
    if (estado.termina !== null && restante === 0) {
      setAviso(
        estado.etapa === "foco"
          ? "Sessão concluída. Hora de fazer uma pausa."
          : "Pausa concluída. Pronto para continuar?",
      );
      setEstado((e) => ({
        ...e,
        etapa: e.etapa === "foco" ? "pausa" : "foco",
        restante: e.etapa === "foco" ? DURACOES.pausa : DURACOES.foco,
        termina: null,
        sessoes: e.sessoes + (e.etapa === "foco" ? 1 : 0),
      }));
    }
  }, [restante, estado.termina, estado.etapa]);
  function alternar() {
    setAgora(Date.now());
    setAviso("");
    setEstado((e) =>
      e.termina === null
        ? { ...e, termina: Date.now() + e.restante * 1000 }
        : {
            ...e,
            restante: Math.max(0, Math.ceil((e.termina - Date.now()) / 1000)),
            termina: null,
          },
    );
  }
  return (
    <ContextoFoco.Provider
      value={{
        abrir: () => setAberto(true),
        restante,
        rodando: estado.termina !== null,
        minimizar: minimizado && !aberto,
        alternar,
      }}
    >
      {children}
      {!leitorAberto && <PomodoroCompacto flutuante />}
      {aberto && (
        <Dialog
          open
          onOpenChange={(v) => {
            setAberto(v);
            if (!v) setMinimizado(true);
          }}
        >
          <DialogContent className="membros-pomodoro">
            <div className="flex items-center gap-2 pr-6">
              <DialogTitle>Seu tempo de foco</DialogTitle>
              <AjudaRecolhida rotulo="Como usar o Pomodoro">
                O relógio continua durante a aula. Minimize para estudar e
                acompanhar o tempo. As sessões ficam neste navegador.
              </AjudaRecolhida>
            </div>
            <DialogDescription className="sr-only">
              Temporizador de estudo com pausas e modo compacto.
            </DialogDescription>
            <div className="flex flex-wrap gap-1 mt-2">
              {(["foco", "pausa", "descanso"] as Etapa[]).map((etapa) => (
                <button
                  key={etapa}
                  className={`membros-acao ${estado.etapa === etapa ? "bg-primary/10 text-primary" : ""}`}
                  aria-pressed={estado.etapa === etapa}
                  onClick={() => {
                    setEstado((e) => ({
                      ...e,
                      etapa,
                      restante: DURACOES[etapa],
                      termina: null,
                    }));
                    setAviso("");
                  }}
                >
                  {etapa === "foco"
                    ? "Foco · 25 min"
                    : etapa === "pausa"
                      ? "Pausa · 5 min"
                      : "Descanso · 15 min"}
                </button>
              ))}
            </div>
            <div
              className="membros-relogio"
              role="timer"
              aria-label="Tempo restante no Pomodoro"
            >
              {formatarTempo(restante)}
            </div>
            <div className="flex justify-center gap-2">
              <button
                className="membros-acao bg-primary text-primary-foreground"
                onClick={alternar}
              >
                {estado.termina === null ? (
                  <Play size={17} />
                ) : (
                  <Pause size={17} />
                )}{" "}
                {estado.termina === null ? "Começar" : "Pausar"}
              </button>
              <button
                className="membros-acao border border-border"
                onClick={() => {
                  setEstado((e) => ({
                    ...e,
                    restante: DURACOES[e.etapa],
                    termina: null,
                  }));
                  setAviso("");
                }}
              >
                <RotateCcw size={16} />
                Reiniciar
              </button>
              <button
                className="membros-acao"
                onClick={() => {
                  setMinimizado(true);
                  setAberto(false);
                }}
              >
                <Minimize2 size={16} />
                Minimizar
              </button>
            </div>
            <p className="text-[12px] text-muted-foreground text-center mt-3 flex justify-center items-center gap-2">
              <Check size={15} />
              {estado.sessoes} sessões concluídas
            </p>
            {aviso && (
              <p role="status" className="text-[13px] text-primary text-center">
                <Coffee size={16} className="inline mr-2" />
                {aviso}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </ContextoFoco.Provider>
  );
}
