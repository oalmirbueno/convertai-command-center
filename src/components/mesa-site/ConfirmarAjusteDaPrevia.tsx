import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hammer, Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import SeletorDoMotor from "./SeletorDoMotor";
import { chamarMotor } from "./siteApi";

/**
 * O que mexe no código pede Confirmar (SPV, 30/09): texto que não é da copy
 * (está escrito no componente da seção) ou um pedido livre na seção. A
 * janela mostra a instrução que vai ao motor (dá para ajustar), o modelo, o
 * teto e o custo antes; só o Confirmar põe o trabalho "ajustar" na fila.
 */
export type PedidoDeAjuste = { secao: string; instrucao: string; origem: "texto" | "pedido"; edicao: Record<string, unknown> };

export default function ConfirmarAjusteDaPrevia({
  pedido,
  modeloDoSite,
  enviando,
  onConfirmar,
  onFechar,
}: {
  pedido: PedidoDeAjuste | null;
  modeloDoSite: string | null;
  enviando: boolean;
  onConfirmar: (p: { instrucao: string; teto_usd: number; modelo_id: string | null }) => void;
  onFechar: () => void;
}) {
  const { clientId } = useMesa();
  const [instrucao, setInstrucao] = useState(() => (pedido ? pedido.instrucao : ""));
  const [modelo, setModelo] = useState(modeloDoSite || "");
  const [teto, setTeto] = useState("");
  useEffect(() => {
    if (!pedido) return;
    setInstrucao(pedido.instrucao);
    setModelo(modeloDoSite || "");
    setTeto("");
  }, [pedido, modeloDoSite]);

  const estimativa = useQuery({
    queryKey: ["mesa-site", "estimativa-ajuste", clientId, modelo],
    enabled: !!pedido,
    queryFn: () => chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number; livre_usd: number }>("estimar", { client_id: clientId, tipo: "ajustar", modelo_id: modelo || undefined }),
  });
  const tetoUsd = teto.trim() ? Number(teto.replace(",", ".")) : estimativa.data ? estimativa.data.teto_sugerido_usd : 0;
  const passaDoLivre = !!estimativa.data && tetoUsd > estimativa.data.livre_usd;
  const valido = instrucao.trim().length >= 3 && tetoUsd > 0 && !passaDoLivre;
  const nome = pedido ? rotuloDaSecao(pedido.secao) : "";

  return (
    <JanelaCentral
      aberta={!!pedido}
      onMudar={(a) => !a && onFechar()}
      titulo={pedido && pedido.origem === "texto" ? `Este texto está no código: ${nome}` : `Pedir ajuste: ${nome}`}
      icone={<Hammer className="h-4 w-4" />}
      largura="md"
      descricao={estimativa.isLoading ? "Estimando" : estimativa.data ? `estimativa ${usd(estimativa.data.estimativa_usd)} · teto ${usd(tetoUsd)} · livre ${usd(estimativa.data.livre_usd)}` : estimativa.isError ? "Sem estimativa agora" : undefined}
      ajuda="Mudança que mexe no código da seção vira um trabalho do motor (ajustar), com o custo reservado pelo teto. O que é conteúdo (texto da copy, imagem, cor, fonte, esconder ou mover seção) já vale na hora, sem custo. O Desfazer da prévia para o trabalho na fila ou volta o commit depois."
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={onFechar} disabled={enviando}>
            Descartar
          </button>
          <button type="button" className={juntar(botao.primario, "ml-2")} disabled={enviando || !valido} onClick={() => onConfirmar({ instrucao: instrucao.trim(), teto_usd: tetoUsd, modelo_id: modelo || null })} data-confirmar-ajuste="">
            {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            Confirmar · teto {usd(tetoUsd)}
          </button>
        </>
      }
      data-confirmar-ajuste-da-previa=""
    >
      <label className="block min-w-0">
        <span className={juntar(texto.rotulo, "mb-1 block")}>{pedido && pedido.origem === "pedido" ? "O que mudar nesta seção" : "O que vai ao motor"}</span>
        <textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} className={campoTexto} maxLength={1500} placeholder="Ex.: deixe os cartões em duas colunas no celular e o título maior." aria-label="Instrução do ajuste" autoFocus={!!pedido && pedido.origem === "pedido"} />
      </label>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <SeletorDoMotor valor={modelo} onChange={setModelo} />
        <label className="block min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Teto (US$)</span>
          <input value={teto} onChange={(e) => setTeto(e.target.value)} inputMode="decimal" placeholder={estimativa.data ? String(estimativa.data.teto_sugerido_usd) : "0,50"} className={campo} aria-label="Teto do ajuste em dólar" />
        </label>
      </div>
      {passaDoLivre && <p className={juntar(texto.auxiliar, "mt-2 text-destructive")}>O teto passa do que está livre na carteira. Baixe o teto ou peça a recarga.</p>}
    </JanelaCentral>
  );
}
