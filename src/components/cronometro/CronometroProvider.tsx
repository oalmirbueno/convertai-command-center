import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { clienteDaRota } from "@/lib/lancador";
import { BATIDA_MS, MotorDoCronometro, areaDaRota, type Armazenamento, type Instantaneo } from "@/lib/cronometro/motor";
import { enviarTrecho, lerTotalDoMes, prepararEnvio } from "@/lib/cronometro/envio";

/**
 * Cronômetro por cliente no painel inteiro (frente CR, 28/09).
 *
 * O provedor fica em volta das rotas (App.tsx), então vale também para o Ciclo,
 * que roda fora da casca. Ele descobre o cliente em foco por dois caminhos:
 * 1. o endereço (`?client=`, `?cliente=`, `/clientes/<id>`), que já cobre as
 *    mesas, a Agenda filtrada, Arquivos, Métricas, a revisão do Ciclo...;
 * 2. a tela avisa com `useClienteEmFoco(id)` quando escolhe o cliente sem mudar
 *    o endereço (perfil da Central, ficha em Clientes, Workspace, Ciclo).
 * O aviso da tela vence o endereço. Rota que não é de trabalho de cliente
 * (Dashboard, Financeiro, Config...) nunca conta, mesmo com cliente no endereço.
 */

const INATIVO: Instantaneo = {
  ativo: false,
  cliente: null,
  area: null,
  contando: false,
  motivo: "desligado",
  mes: "",
  segundosDoMes: 0,
  baseConhecida: false,
};

const PAPEIS_QUE_CONTAM = ["admin", "manager", "design", "traffic"];

interface ValorDoCronometro {
  motor: MotorDoCronometro | null;
  registrar: (cliente: string | null) => number;
  atualizar: (token: number, cliente: string | null) => void;
  remover: (token: number) => void;
}

const ContextoDoCronometro = createContext<ValorDoCronometro | null>(null);

function armazenamentoLocal(): Armazenamento | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const teste = "aceleriq:cronometro:teste";
    window.localStorage.setItem(teste, "1");
    window.localStorage.removeItem(teste);
    return window.localStorage;
  } catch {
    return null;
  }
}

function novoId(): string {
  try {
    const c = (typeof crypto !== "undefined" ? crypto : null) as Crypto | null;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* segue para o sorteio */
  }
  // uuid v4 sem crypto.randomUUID (o polyfills.ts já cobre; isto é só a rede).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Leituras do total do mês: no máximo uma por cliente a cada minuto (nada de laço). */
const RELER_BASE_MS = 60_000;

export function CronometroProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const location = useLocation();
  const usuario = (user && user.id) || null;
  const conta = PAPEIS_QUE_CONTAM.indexOf((profile && profile.role) || "") >= 0;

  const motor = useMemo(() => {
    if (!usuario || !conta) return null;
    return new MotorDoCronometro({
      agora: () => Date.now(),
      armazenamento: armazenamentoLocal(),
      enviar: enviarTrecho,
      gerarId: novoId,
      aba: novoId(),
      usuario,
    });
  }, [usuario, conta]);

  // Telas que escolhem o cliente sem mudar o endereço.
  const registros = useRef<Array<{ token: number; cliente: string | null }>>([]);
  const proximo = useRef(1);
  const [versaoDosRegistros, setVersaoDosRegistros] = useState(0);
  const valor = useMemo<ValorDoCronometro>(
    () => ({
      motor,
      registrar: (cliente) => {
        const token = proximo.current++;
        registros.current = registros.current.concat([{ token, cliente }]);
        setVersaoDosRegistros((v) => v + 1);
        return token;
      },
      atualizar: (token, cliente) => {
        registros.current = registros.current.map((r) => (r.token === token ? { token, cliente } : r));
        setVersaoDosRegistros((v) => v + 1);
      },
      remover: (token) => {
        registros.current = registros.current.filter((r) => r.token !== token);
        setVersaoDosRegistros((v) => v + 1);
      },
    }),
    [motor],
  );

  let explicito: string | null = null;
  for (const r of registros.current) if (r.cliente) explicito = r.cliente;
  const cliente = explicito || clienteDaRota(location.pathname, location.search);
  const area = areaDaRota(location.pathname);

  useEffect(() => {
    if (motor) motor.definirContexto({ ativo: true, cliente, area });
  }, [motor, cliente, area, versaoDosRegistros]);

  // Relógio, interação, aba escondida e saída da página.
  useEffect(() => {
    if (!motor) return;
    prepararEnvio();
    const visivel = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    motor.definirVisibilidade(visivel());
    const relogio = window.setInterval(() => motor.batida(), BATIDA_MS);
    const mexeu = () => motor.interacao();
    const mudouVisibilidade = () => motor.definirVisibilidade(visivel());
    const saindo = () => motor.sair();
    const opcoes: AddEventListenerOptions = { passive: true, capture: true };
    const eventos = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart", "focus"];
    for (const e of eventos) window.addEventListener(e, mexeu, opcoes);
    document.addEventListener("visibilitychange", mudouVisibilidade);
    window.addEventListener("pagehide", saindo);
    return () => {
      window.clearInterval(relogio);
      for (const e of eventos) window.removeEventListener(e, mexeu, opcoes);
      document.removeEventListener("visibilitychange", mudouVisibilidade);
      window.removeEventListener("pagehide", saindo);
      motor.sair();
    };
  }, [motor]);

  // Total do mês do cliente em foco (base do banco): pede quando falta, sem laço.
  const lidas = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!motor) return;
    let lendo = false;
    let vivo = true;
    const ler = async (forcar: boolean) => {
      if (lendo) return;
      const pedido0 = motor.pedidoDeBase();
      if (!pedido0) return;
      const chave = `${pedido0.cliente}|${pedido0.mes}`;
      const ultima = lidas.current[chave] || 0;
      if (!forcar && motor.baseConhecida(pedido0.cliente, pedido0.mes)) return;
      if (Date.now() - ultima < RELER_BASE_MS && (forcar || ultima > 0)) return;
      lendo = true;
      lidas.current[chave] = Date.now();
      try {
        for (let tentativa = 0; tentativa < 3 && vivo; tentativa++) {
          await motor.aguardarEnvios();
          const pedido = motor.pedidoDeBase();
          if (!pedido || pedido.cliente !== pedido0.cliente || pedido.mes !== pedido0.mes) break;
          const total = await lerTotalDoMes(pedido.cliente, pedido.desde, pedido.excluir);
          if (total === null || !vivo) break;
          if (motor.definirBase(pedido, total)) break;
        }
      } finally {
        lendo = false;
      }
    };
    const desliga = motor.assinar(() => {
      const i = motor.instantaneoEstavel();
      if (i.cliente && !i.baseConhecida) void ler(false);
    });
    const aoVoltar = () => {
      if (document.visibilityState !== "hidden") void ler(true);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      desliga();
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [motor]);

  return <ContextoDoCronometro.Provider value={valor}>{children}</ContextoDoCronometro.Provider>;
}

const semAssinatura = () => () => undefined;
const instantaneoInativo = () => INATIVO;

/** Estado do cronômetro para quem mostra (o topo). Sem provedor: desligado. */
export function useCronometro(): Instantaneo {
  const ctx = useContext(ContextoDoCronometro);
  const motor = ctx ? ctx.motor : null;
  const assinar = useMemo(() => (motor ? (ouvinte: () => void) => motor.assinar(ouvinte) : semAssinatura), [motor]);
  const ler = useMemo(() => (motor ? () => motor.instantaneoEstavel() : instantaneoInativo), [motor]);
  return useSyncExternalStore(assinar, ler, instantaneoInativo);
}

const semCliente = () => null;

/** Só o cliente em foco: não redesenha a cada segundo do relógio (o Voltar do topo). */
export function useClienteDoCronometro(): string | null {
  const ctx = useContext(ContextoDoCronometro);
  const motor = ctx ? ctx.motor : null;
  const assinar = useMemo(() => (motor ? (ouvinte: () => void) => motor.assinar(ouvinte) : semAssinatura), [motor]);
  const ler = useMemo(() => (motor ? () => motor.clienteEmFoco() : semCliente), [motor]);
  return useSyncExternalStore(assinar, ler, semCliente);
}

/**
 * A tela diz em que cliente a pessoa está trabalhando quando isso não está no
 * endereço. `null` = nenhum (a tela continua contando pelo endereço, se houver).
 * Sem provedor (testes, telas públicas), não faz nada.
 */
export function useClienteEmFoco(cliente: string | null | undefined) {
  const ctx = useContext(ContextoDoCronometro);
  const token = useRef<number | null>(null);
  const valor = cliente || null;
  useEffect(() => {
    if (!ctx) return;
    const t = ctx.registrar(null);
    token.current = t;
    return () => {
      ctx.remover(t);
      token.current = null;
    };
  }, [ctx]);
  useEffect(() => {
    if (ctx && token.current !== null) ctx.atualizar(token.current, valor);
  }, [ctx, valor]);
}
