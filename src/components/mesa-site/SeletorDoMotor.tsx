import { useMesa } from "@/components/mesa/MesaContexto";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { nomeDoModelo, padraoPara } from "@/lib/mesa/api";
import { modeloServeParaCodigo } from "../../../supabase/functions/_shared/motor-codigo";

const preco = (v: number | null) => (v == null ? "?" : v < 1 ? v.toFixed(3).replace(".", ",") : v.toFixed(2).replace(".", ","));

/**
 * O modelo do motor de código na hora: qualquer modelo ativo do catálogo
 * (Anthropic, OpenAI, OpenRouter...) com preço e contexto grande. Vazio =
 * o padrão do papel `site` (ou o do estrategista).
 */
export default function SeletorDoMotor({ valor, onChange, rotulo = "Modelo do motor de código" }: { valor: string; onChange: (id: string) => void; rotulo?: string }) {
  const { catalogo } = useMesa();
  const opcoes = catalogo.filter((m) => m.tipo === "texto" && m.ativo && modeloServeParaCodigo(m as never));
  const padrao = padraoPara(catalogo, "site");
  return (
    <label className="block min-w-0">
      <span className={juntar(texto.rotulo, "mb-1 block")}>{rotulo}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo} data-seletor-do-motor="">
        <option value="">Padrão{padrao ? `: ${nomeDoModelo(padrao)}` : ""}</option>
        {opcoes.map((m) => (
          <option key={m.id} value={m.id}>
            {nomeDoModelo(m)} · US$ {preco(m.preco_entrada_1m)}/{preco(m.preco_saida_1m)} por 1M
          </option>
        ))}
      </select>
    </label>
  );
}
