import { useEffect, useRef, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import {
  modelosAtivos,
  nomeDoModelo,
  precoDoModelo,
  QUALIDADES,
  type ModeloIa,
  type Qualidade,
} from "@/lib/mesa/api";
import { ORDEM_DO_RACIOCINIO, raciocinioQueVale } from "@/lib/mesa/recursos-na-tela";

/** Seletor de modelo: só modelos ativos do tipo, com o preço ao lado do nome. */
export function SeletorDeModelo({
  catalogo,
  tipo,
  valor,
  onChange,
  rotulo = "Modelo",
  qualidade = "media",
  disabled,
}: {
  catalogo: ModeloIa[];
  tipo: "texto" | "imagem";
  valor: string;
  onChange: (id: string) => void;
  rotulo?: string;
  qualidade?: Qualidade;
  disabled?: boolean;
}) {
  const opcoes = modelosAtivos(catalogo, tipo);
  return (
    <Campo rotulo={rotulo}>
      <Select value={valor || ""} onValueChange={onChange} disabled={disabled || opcoes.length === 0}>
        <SelectTrigger className="h-9 min-w-0 text-[12.5px]">
          <SelectValue placeholder={opcoes.length ? "Escolher modelo" : "Nenhum modelo ativo"} />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {nomeDoModelo(m)} <span className="text-muted-foreground">· {precoDoModelo(m, qualidade)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
}

export function SeletorDeQualidade({ valor, onChange, disabled }: { valor: Qualidade; onChange: (q: Qualidade) => void; disabled?: boolean }) {
  return (
    <Campo rotulo="Qualidade">
      <Select value={valor} onValueChange={(v) => onChange(v as Qualidade)} disabled={disabled}>
        <SelectTrigger className="h-9 min-w-0 text-[12.5px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {QUALIDADES.map((q) => <SelectItem key={q.valor} value={q.valor}>{q.rotulo}</SelectItem>)}
        </SelectContent>
      </Select>
    </Campo>
  );
}

const ROTULO_RACIOCINIO: Record<string, string> = {
  none: "Sem raciocínio",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

export function SeletorDeRaciocinio({ modelo, valor, onChange }: { modelo: ModeloIa | null; valor: string; onChange: (v: string) => void }) {
  const niveis = (modelo?.raciocinio || []).slice().sort((a, b) => ORDEM_DO_RACIOCINIO.indexOf(a) - ORDEM_DO_RACIOCINIO.indexOf(b));
  const padrao = (modelo && modelo.recursos && modelo.recursos.raciocinio_padrao) || "";
  const chave = niveis.join(",");
  // Corrige uma vez por combinação (modelo, nível, alvo): uma tela que recalcula o valor a cada
  // render não entra em laço de onChange (visto na Proposta em 01/10).
  const corrigido = useRef("");
  useEffect(() => {
    // Sem modelo (catálogo ainda carregando), nada muda: a escolha guardada não se perde.
    if (!valor || !modelo) return;
    const alvo = !niveis.length ? "" : niveis.indexOf(valor) < 0 ? raciocinioQueVale(modelo, valor) : valor;
    if (alvo === valor) return;
    const marca = modelo.id + "|" + valor + "|" + alvo;
    if (corrigido.current === marca) return;
    corrigido.current = marca;
    onChange(alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo ? modelo.id : "", chave, valor]);
  return (
    <Campo rotulo="Raciocínio">
      <Select value={niveis.indexOf(valor) >= 0 ? valor : ""} onValueChange={onChange} disabled={niveis.length === 0}>
        <SelectTrigger className="h-9 min-w-0 text-[13px]"><SelectValue placeholder={niveis.length ? "Escolher" : "Este modelo não tem níveis"} /></SelectTrigger>
        <SelectContent>
          {niveis.map((n) => (
            <SelectItem key={n} value={n}>
              {ROTULO_RACIOCINIO[n] || n}
              {n === padrao ? " (padrão)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
}

/** Campo das mesas: rótulo em cima (padrão do sistema, docs/design/SISTEMA.md). */
export function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label className="block text-[12px] font-medium leading-4 text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}

/** Título de seção da Mesa: o título de seção do sistema (15 px), ação à direita. */
export function TituloDeSecao({ children, acao, ajuda }: { children: ReactNode; acao?: ReactNode; ajuda?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between">
      <div className="mr-3 flex min-w-0 items-center">
        <h2 className="min-w-0 text-[15px] font-semibold leading-[22px] text-foreground">{children}</h2>
        {/* A explicação mora no "?" (docs/design/SISTEMA.md, regra de texto). */}
        {ajuda && <AjudaRecolhida className="ml-1.5">{ajuda}</AjudaRecolhida>}
      </div>
      {acao}
    </div>
  );
}
