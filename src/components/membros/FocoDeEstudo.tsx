import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Pause, Play, RotateCcw, Timer, Coffee, Check } from "lucide-react";
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
type Contexto = { abrir: () => void; restante: number; rodando: boolean };
const ContextoFoco = createContext<Contexto>({
  abrir: () => {},
  restante: 1500,
  rodando: false,
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
      {!compacto && (foco.rodando ? formatarTempo(foco.restante) : "Pomodoro")}
    </button>
  );
}
export function FocoDeEstudo({
  usuario,
  children,
}: {
  usuario: string;
  children: ReactNode;
}) {
  const chave = `membros:foco:${usuario}`;
  const [estado, setEstado] = useState<Estado>(() => ler(chave));
  const [agora, setAgora] = useState(Date.now());
  const [aberto, setAberto] = useState(false);
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
      }}
    >
      {children}
      {aberto && (
        <Dialog open onOpenChange={setAberto}>
          <DialogContent className="membros-pomodoro">
            <DialogTitle>Seu tempo de foco</DialogTitle>
            <DialogDescription>
              Uma coisa por vez. O temporizador continua enquanto você assiste à
              aula.
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
            </div>
            <p className="text-[12px] text-muted-foreground text-center mt-3 flex justify-center items-center gap-2">
              <Check size={15} />
              {estado.sessoes} sessões de foco concluídas neste navegador
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
