import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Check } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, juntar } from "@/components/sistema/estilos";
import { hojeEmBrasilia, MAXIMO_DE_DIAS, PRESETS_DO_PERIODO, resolverPeriodo, somarDias, type EscolhaDoPeriodo, type PresetDoPeriodo } from "./periodoDaConta";

/**
 * O período da aba Conta (frente AD3): hoje, ontem, 7, 14, 30 e 90 dias, este mês, mês passado e
 * período livre. No período livre aparecem as duas datas e o Aplicar (até 180 dias).
 */
export default function SeletorDePeriodo({ valor, onMudar }: { valor: EscolhaDoPeriodo; onMudar: (e: EscolhaDoPeriodo) => void }) {
  const hoje = hojeEmBrasilia();
  const resolvido = resolverPeriodo(valor, hoje);
  const [livre, setLivre] = useState(valor.preset === "livre");
  const [inicio, setInicio] = useState(resolvido.inicio);
  const [fim, setFim] = useState(resolvido.fim);
  useEffect(() => {
    setLivre(valor.preset === "livre");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor.preset]);

  const escolher = (v: string) => {
    const preset = v as PresetDoPeriodo;
    if (preset === "livre") {
      setInicio(resolvido.inicio);
      setFim(resolvido.fim);
      setLivre(true);
      return;
    }
    setLivre(false);
    onMudar({ preset });
  };

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const valido = iso.test(inicio) && iso.test(fim) && inicio <= fim && fim <= hoje;
  const aplicar = (ev: FormEvent) => {
    ev.preventDefault();
    if (valido) onMudar({ preset: "livre", inicio, fim });
  };

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center">
      <SeletorCompacto
        rotulo="Período"
        icone={<CalendarDays className="h-3.5 w-3.5" />}
        modo="lista"
        opcoes={PRESETS_DO_PERIODO.map((p) => ({ valor: p.valor, rotulo: p.valor === "livre" && valor.preset === "livre" ? resolvido.rotulo : p.rotulo }))}
        valor={livre ? "livre" : valor.preset}
        onEscolher={escolher}
      />
      {livre && (
        <form onSubmit={aplicar} className="ml-1.5 inline-flex min-w-0 flex-wrap items-center" aria-label="Período livre">
          <input
            type="date"
            className={juntar(campo, "mr-1 h-9 w-[9.5rem] tabular-nums")}
            value={inicio}
            min={somarDias(hoje, -730)}
            max={hoje}
            onChange={(e) => setInicio(e.target.value)}
            aria-label="De"
            placeholder="AAAA-MM-DD"
          />
          <input
            type="date"
            className={juntar(campo, "mr-1 h-9 w-[9.5rem] tabular-nums")}
            value={fim}
            min={inicio || undefined}
            max={hoje}
            onChange={(e) => setFim(e.target.value)}
            aria-label="Até"
            placeholder="AAAA-MM-DD"
          />
          <button type="submit" className={juntar(botao.secundario, "h-9")} disabled={!valido} title={`Até ${MAXIMO_DE_DIAS} dias`}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Aplicar
          </button>
        </form>
      )}
    </span>
  );
}
