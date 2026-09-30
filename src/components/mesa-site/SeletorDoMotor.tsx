import { Gauge, Rocket } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { nomeDoModelo, padraoPara, usd } from "@/lib/mesa/api";
import { modeloServeParaCodigo } from "../../../supabase/functions/_shared/motor-codigo";
import { custoPorSecao, presetsDoMotor } from "../../../supabase/functions/_shared/site-biblioteca";

const preco = (v: number | null) => (v == null ? "?" : v < 1 ? v.toFixed(3).replace(".", ",") : v.toFixed(2).replace(".", ","));

/**
 * O modelo do motor de código na hora: qualquer modelo ativo do catálogo
 * (Anthropic, OpenAI, OpenRouter...) com preço e contexto grande. Vazio =
 * o padrão do papel `site` (ou o do estrategista). SIT2: os atalhos "Rápido e
 * barato" e "Premium" escolhem do catálogo, com o custo previsto por seção.
 */
export default function SeletorDoMotor({ valor, onChange, rotulo = "Modelo do motor de código" }: { valor: string; onChange: (id: string) => void; rotulo?: string }) {
  const { catalogo } = useMesa();
  const opcoes = catalogo.filter((m) => m.tipo === "texto" && m.ativo && modeloServeParaCodigo(m as never));
  const padrao = padraoPara(catalogo, "site");
  const { rapido, premium } = presetsDoMotor(opcoes as never);
  const atual = opcoes.find((m) => m.id === valor) || padrao;
  const atalho = (m: { id: string } | null, icone: JSX.Element, nome: string) =>
    m ? (
      <button
        type="button"
        className={juntar("toque-compacto mr-3 inline-flex items-center text-[12px] underline-offset-2 hover:underline", valor === m.id ? "font-medium text-primary" : "text-muted-foreground")}
        onClick={() => onChange(m.id)}
        aria-pressed={valor === m.id}
        data-preset-do-motor={nome}
      >
        {icone}
        {nome} · ~{usd(custoPorSecao(m as never))}/seção
      </button>
    ) : null;
  return (
    <div className="block min-w-0">
      <label className="block min-w-0">
        <span className={juntar(texto.rotulo, "mb-1 block")}>{rotulo}</span>
        <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo} data-seletor-do-motor="">
          <option value="">Padrão{padrao ? `: ${nomeDoModelo(padrao)}` : ""}</option>
          {/* UXS 30/09: o preço por seção (estimativa, sempre com "~"); o preço por 1M de tokens fica no title. */}
          {opcoes.map((m) => (
            <option key={m.id} value={m.id} title={`US$ ${preco(m.preco_entrada_1m)} entrada / ${preco(m.preco_saida_1m)} saída por 1M de tokens`}>
              {nomeDoModelo(m)} · ~{usd(custoPorSecao(m as never))} por seção
            </option>
          ))}
        </select>
      </label>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
        {atalho(rapido, <Gauge className="mr-1 h-3.5 w-3.5" aria-hidden="true" />, "Rápido e barato")}
        {atalho(premium, <Rocket className="mr-1 h-3.5 w-3.5" aria-hidden="true" />, "Premium")}
        {atual && !rapido && !premium ? <span className={texto.auxiliar}>~{usd(custoPorSecao(atual as never))} por seção</span> : null}
      </div>
    </div>
  );
}
