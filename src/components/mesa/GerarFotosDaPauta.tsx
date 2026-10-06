import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BotaoComCusto } from "./Custo";
import { AcoesDaBancada } from "./BancadaDaPauta";
import { useMesa } from "./MesaContexto";
import { SeletorDeModelo } from "./Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { acrescentarFotos, invalidarFotos, partesDoPreparo, prepararFoto, useFotos } from "@/components/mesa-foto/fotoApi";
import { linhasDaDirecaoDeFoto, normalizarDirecaoDeFoto } from "../../../supabase/functions/agente-calendario/modulos/peca-de-foto";

/** Gera derivadas no acervo com os mesmos custos e aprovações da Mesa Fotos. */
export default function GerarFotosDaPauta({ taskId, titulo, direcao, ids, onFotos }: {
  taskId: string; titulo: string; direcao?: Record<string, unknown>; ids: string[]; onFotos: (ids: string[]) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const cache = useQueryClient();
  const fotos = useFotos(clientId);
  const inicial = normalizarDirecaoDeFoto(direcao, { tema: titulo });
  const [instrucao, setInstrucao] = useEstadoDaTela(`mesa:foto:gerar:${clientId}:${taskId}`, linhasDaDirecaoDeFoto(inicial).join("\n"));
  const [motor, setMotor] = useState("");
  const modelo = motor || padraoPara(catalogo, "imagem")?.id || "";
  const [quantidade, setQuantidade] = useState(direcao ? inicial.quantidade : 1);
  const [progresso, setProgresso] = useState("");
  const fontes = ids.map((id) => fotos.data?.find((f) => f.id === id && f.client_id === clientId && f.ativa && !f.referencia_web)).filter((f) => !!f);
  return <section aria-label="Gerar fotos da pauta" className="mb-4 space-y-3 border-b pb-4">
    <p className="text-[13px] font-semibold">Direção da foto</p>
    <textarea aria-label="Direção para gerar as fotos" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} className="min-h-32 w-full rounded-lg border bg-background p-3 text-[13px]" />
    <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setMotor} />
    <label className="flex items-center justify-between text-[12px]">Fotos a gerar<select aria-label="Quantidade de fotos a gerar" className="rounded border bg-background p-2" value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
    <AcoesDaBancada><BotaoComCusto rotulo={progresso || `Gerar fotos (${quantidade})`} titulo="Gerar fotos da pauta" descricao="Cria novas versões no acervo, usando as fotos escolhidas como base. Confira o resultado antes de preparar e enviar."
      disabled={!fontes.length || !modelo || !instrucao.trim() || !!progresso} partes={() => Array.from({ length: quantidade }, () => partesDoPreparo(modelo, "alta")).flat()}
      executar={async () => {
        const geradas: string[] = []; let custo = 0;
        try {
          for (let n = 0; n < quantidade; n++) {
            setProgresso(`Gerando ${n + 1} de ${quantidade}…`);
            const fonte = fontes[n % fontes.length]!;
            const angulo = inicial.angulos[n % Math.max(1, inicial.angulos.length)] || "";
            const r = await prepararFoto({ clientId, imagemId: fonte.id, modeloImagemId: modelo, modo: "cenario", areas: [], cenario: inicial.cenario || instrucao,
              instrucao: `${instrucao}\nFoto ${n + 1} de ${quantidade}.${angulo ? ` Ângulo: ${angulo}.` : ""} Preserve a identidade, o produto e os materiais reais da referência.` });
            if (!r.imagem) throw new Error(`A foto ${n + 1} não foi confirmada. As versões já concluídas continuam no acervo.`);
            acrescentarFotos(cache, clientId, [r.imagem]); geradas.push(r.imagem.id); custo += r.custo_usd || 0;
            onFotos([...geradas]);
          }
          return { custo_usd: custo };
        } finally { setProgresso(""); invalidarFotos(cache, clientId); }
      }} /></AcoesDaBancada>
    {!fontes.length && <p className="text-[12px] text-muted-foreground">Escolha uma foto real na prancheta. A direção já está preenchida.</p>}
    {progresso && <p role="status" className="text-[12px] text-primary">{progresso}</p>}
  </section>;
}
