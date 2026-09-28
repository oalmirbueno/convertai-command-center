import { useEstadoDaTela } from "@/components/central/useEstadoDaTela";
import { campo, juntar, texto } from "@/components/sistema";
import {
  ESCOLHA_PADRAO,
  type EscolhaDoModelo,
  escolhaValida,
  MODELOS_DA_CENTRAL,
  RACIOCINIOS_DA_CENTRAL,
} from "./modeloDaCentral";

/**
 * A escolha do modelo que escreve na Central e na Esteira, lembrada neste
 * navegador (a mesma chave nas duas telas). Padrão: GPT-6 Luna, raciocínio
 * máximo (pedido do dono, 28/09).
 */
export function useModeloDaCentral(): [EscolhaDoModelo, (e: EscolhaDoModelo) => void] {
  const [escolha, setEscolha] = useEstadoDaTela<EscolhaDoModelo>("central:modelo", ESCOLHA_PADRAO, escolhaValida);
  return [escolhaValida(escolha) ? escolha : ESCOLHA_PADRAO, (e) => setEscolha(e)];
}

export default function SeletorDeModelo({ escolha, onMudar, compacto = false }: { escolha: EscolhaDoModelo; onMudar: (e: EscolhaDoModelo) => void; compacto?: boolean }) {
  const atual = MODELOS_DA_CENTRAL.find((m) => m.id === escolha.modelo) ?? MODELOS_DA_CENTRAL[0];
  const legado = escolha.modelo.startsWith("legado:");
  return (
    <div className="min-w-0">
      <div className={juntar("grid min-w-0 gap-2", compacto ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Modelo que escreve</span>
          <select
            value={escolha.modelo}
            onChange={(e) => onMudar({ ...escolha, modelo: e.target.value })}
            className={campo}
            aria-label="Modelo que escreve"
          >
            {MODELOS_DA_CENTRAL.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Raciocínio</span>
          <select
            value={escolha.raciocinio}
            onChange={(e) => onMudar({ ...escolha, raciocinio: e.target.value })}
            className={campo}
            disabled={legado}
            aria-label="Raciocínio"
          >
            {RACIOCINIOS_DA_CENTRAL.map((r) => <option key={r.id} value={r.id}>{r.rotulo}</option>)}
          </select>
        </label>
      </div>
      {!compacto && <p className={juntar(texto.auxiliar, "mt-1")}>{atual.ajuda}{escolha.raciocinio === "max" && !legado ? " Com raciocínio máximo cada mensagem leva de 30 segundos a 2 minutos." : ""}</p>}
    </div>
  );
}
