import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMesa } from "./MesaContexto";
import { BotaoComCusto } from "./Custo";
import { SeletorDeModelo } from "./Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { campo } from "@/components/sistema/estilos";
import { acrescentarFotos, prepararFoto, partesDoPreparo, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import AcoesProDaFoto from "@/components/mesa-foto/AcoesProDaFoto";

export default function MelhorarFotoNaBancada({ foto, onPronta }: { foto: FotoDoAcervo; onPronta: (nova: FotoDoAcervo) => void | Promise<void> }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const cache = useQueryClient();
  const [escolha, setEscolha] = useState("");
  const [ajuste, setAjuste] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const motor = escolha || padraoPara(catalogo, "imagem")?.id || "";
  return <div className="space-y-3">
    <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={motor} onChange={setEscolha} />
    <label className="block text-[12px]">Ajuste opcional<input className={campo} value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="Ex.: suavizar reflexos, manter textura natural" /></label>
    <div className="flex flex-wrap gap-2">{([{ modo: "luz_cor", nome: "Luz e cor" }, { modo: "limpar", nome: "Limpar foto" }] as const).map(({ modo, nome }) => <BotaoComCusto key={modo} rotulo={nome} titulo={nome} descricao="Cria uma versão tratada e aplica nesta pauta." disabled={ocupado || !motor || foto.referencia_web} partes={() => partesDoPreparo(motor, "alta")} executar={async () => {
      setOcupado(true);
      try {
        const r = await prepararFoto({ clientId, imagemId: foto.id, modeloImagemId: motor, modo, areas: [], cenario: "", instrucao: ajuste });
        if (!r.imagem) throw new Error("A versão tratada ainda não foi confirmada.");
        acrescentarFotos(cache, clientId, [r.imagem]);
        try { await onPronta(r.imagem); } catch (e) { toast.error("Versão salva no acervo; confira o post", { description: e instanceof Error ? e.message : "Não foi possível aplicar a versão." }); }
        return r;
      } finally { setOcupado(false); atualizarCusto(); }
    }} />)}</div>
    <div className="border-t pt-3"><p className="mb-2 text-[12px] font-medium">Upscale e recorte</p><AcoesProDaFoto foto={foto} onPronta={onPronta} /></div>
  </div>;
}
