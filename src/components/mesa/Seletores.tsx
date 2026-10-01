import { useEffect, useRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Brain, Check, Eye, Wrench } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
// Pelo caminho próprio, nunca pelo índice "@/components/sistema": o índice exporta o PreencherComIA,
// que importa este arquivo, e o ciclo travava a Mesa Proposta nos testes (01/10).
import { etiqueta, juntar } from "@/components/sistema/estilos";
import {
  capacidadesDoModeloNaTela,
  contextoCurto,
  modeloLancadoHaPouco,
  modelosAtivos,
  nomeDoModelo,
  precoDoModelo,
  QUALIDADES,
  type ModeloIa,
  type Qualidade,
} from "@/lib/mesa/api";
import { ORDEM_DO_RACIOCINIO, raciocinioQueVale } from "@/lib/mesa/recursos-na-tela";

/**
 * Item do seletor de modelo (frente MOD, 30/09): nome e preço por 1M (o que
 * aparece no campo fechado) e, só na lista, "novo" para o lançado há menos de
 * 30 dias e o que o modelo faz: vê imagem, usa ferramentas, raciocina.
 */
function ItemDoModelo({ m, qualidade }: { m: ModeloIa; qualidade: Qualidade }) {
  const cap = capacidadesDoModeloNaTela(m);
  const novo = modeloLancadoHaPouco(m);
  const contexto = m.tipo === "texto" ? contextoCurto(m) : "";
  const dica = [
    cap.visao ? "vê imagem" : "",
    cap.ferramentas ? "usa ferramentas" : "",
    cap.raciocinio ? "raciocina" : "",
    cap.json ? "responde em JSON" : "",
    contexto ? `contexto de ${contexto} tokens` : "",
  ].filter(Boolean).join(", ");
  return (
    <SelectPrimitive.Item
      value={m.id}
      title={dica || undefined}
      className="relative flex w-full min-w-0 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-[13px] outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
      data-modelo-novo={novo ? "sim" : undefined}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">
        <SelectPrimitive.ItemText>
          {nomeDoModelo(m)} <span className="text-muted-foreground">· {precoDoModelo(m, qualidade)}</span>
        </SelectPrimitive.ItemText>
      </span>
      {m.tipo === "texto" && (
        <span className="ml-2 flex shrink-0 items-center text-muted-foreground" aria-label={dica || undefined}>
          {cap.visao && <Eye className="ml-1 h-3.5 w-3.5" aria-hidden="true" />}
          {cap.ferramentas && <Wrench className="ml-1 h-3.5 w-3.5" aria-hidden="true" />}
          {cap.raciocinio && <Brain className="ml-1 h-3.5 w-3.5" aria-hidden="true" />}
        </span>
      )}
      {novo && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>novo</span>}
    </SelectPrimitive.Item>
  );
}

/** Seletor de modelo: só modelos ativos do tipo, com o preço por 1M, "novo" e o que cada um faz. */
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
        <SelectTrigger className="h-9 min-w-0 text-[13px]">
          <SelectValue placeholder={opcoes.length ? "Escolher modelo" : "Nenhum modelo ativo"} />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((m) => <ItemDoModelo key={m.id} m={m} qualidade={qualidade} />)}
        </SelectContent>
      </Select>
    </Campo>
  );
}

export function SeletorDeQualidade({ valor, onChange, disabled }: { valor: Qualidade; onChange: (q: Qualidade) => void; disabled?: boolean }) {
  return (
    <Campo rotulo="Qualidade">
      <Select value={valor} onValueChange={(v) => onChange(v as Qualidade)} disabled={disabled}>
        <SelectTrigger className="h-9 min-w-0 text-[13px]"><SelectValue /></SelectTrigger>
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

/**
 * Nível de raciocínio do modelo escolhido, do menor para o maior, com o
 * "(padrão)" do provedor. Trocou para um modelo que não aceita o nível
 * escolhido (ex.: "Sem raciocínio" no Claude 5.5 ou no GPT-6.1 Sol, que
 * sempre raciocinam): o nível passa sozinho para o mais perto aceito, em vez
 * de o pedido voltar com "raciocínio não aceito".
 */
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
