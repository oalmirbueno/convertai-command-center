import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { campo } from "@/components/sistema/estilos";
import { MiniaturaDaFoto } from "./Comuns";
import SeletorDeFotos from "./SeletorDeFotos";
import { chaveDosKits, kitVazio, partesDaLeitura, salvarKit, type FotoDoAcervo, type KitDeFoto } from "./fotoApi";
import { fotosJaCadastradas, guardarProdutoConfirmado } from "./cacheProdutos";
import { atualizarPublicoProduto, PUBLICOS_DO_PRODUTO, ROTULOS_PUBLICO } from "./produtoPublicoApi";

/** Cadastro em lote: uma foto principal por produto, sem repetir os já vinculados. */
export default function MarcarProdutos({ fotos, kits, onSalvo, onFechar, onOcupado }: {
  fotos: FotoDoAcervo[]; kits: KitDeFoto[]; onSalvo: (kit: KitDeFoto) => void; onFechar: () => void; onOcupado?: (v: boolean) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const cache = useQueryClient();
  const erro = useAvisarErro();
  const trava = useRef(false);
  const [ids, setIds] = useState<string[]>([]);
  const [publico, setPublico] = useState("automatico");
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState("");
  const selecionadas = fotos.filter((f) => ids.includes(f.id) && f.client_id === clientId && f.ativa && !f.referencia_web);
  const salvar = async () => {
    if (trava.current) throw new Error("O cadastro já está em andamento.");
    trava.current = true; setOcupado(true); onOcupado?.(true);
    let custo_usd = 0; let saldo_usd: number | undefined; let primeiro: KitDeFoto | undefined;
    const falhas: string[] = []; let feitas = 0;
    try {
      for (const foto of selecionadas) {
        setProgresso(`Salvando ${feitas + 1} de ${selecionadas.length}…`);
        try {
          const atuais = cache.getQueryData<KitDeFoto[]>(chaveDosKits(clientId)) || kits;
          // Vale também para uma nova tentativa depois de falha parcial.
          let salvo = atuais.find((k) => k.status !== "arquivado" && k.tipo !== "pessoa" && (k.frente_imagem_id === foto.id || k.refs.some((r) => r.imagem_id === foto.id)));
          if (!salvo) {
            salvo = await salvarKit(clientId, { ...kitVazio(clientId), nome: foto.nome || "Meu produto", frente_imagem_id: foto.id,
              atributos: { observado: [], informado: [], inferido: [], organizacao: { pasta: "", ...(publico !== "automatico" ? { publico: { valor: publico as typeof PUBLICOS_DO_PRODUTO[number], origem: "equipe", confianca: 1, evidencia: "Definido pela equipe" } } : {}) } },
              refs: [{ imagem_id: foto.id, papel: "identidade", vista: "frente", prioridade: 0 }] }, true);
          }
          await guardarProdutoConfirmado(cache, clientId, salvo);
          primeiro ||= salvo; feitas++;
          onSalvo(salvo);
          if (publico === "automatico" && !salvo.atributos.organizacao?.publico) {
            try {
              const resultado = await atualizarPublicoProduto(cache, clientId, salvo, "automatico");
              custo_usd += resultado.custo_usd || 0; saldo_usd = resultado.saldo_usd ?? saldo_usd;
            } catch { falhas.push(`${foto.nome}: salvo, público a identificar`); }
          }
        } catch { falhas.push(`${foto.nome}: cadastro não confirmado`); }
      }
      if (!feitas) throw new Error("Nenhum produto foi confirmado. Tente novamente.");
      if (falhas.length) toast.warning(`${feitas} produto(s) salvo(s). Confira as pendências.`, { description: falhas.slice(0, 3).join(" · ") });
      else toast.success(`${feitas} ${feitas === 1 ? "produto salvo" : "produtos salvos"}`);
      if (primeiro) onSalvo(primeiro);
      onFechar();
      return { custo_usd, saldo_usd };
    } finally { trava.current = false; setOcupado(false); onOcupado?.(false); }
  };
  if (!ids.length) return <SeletorDeFotos fotos={fotos.filter((f) => f.client_id === clientId && f.ativa && !f.referencia_web)} titulo="Uma foto principal por produto" produtosMarcados={fotosJaCadastradas(kits)} limiteSelecao={20} onUsar={setIds} onFechar={onFechar} />;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">{selecionadas.map((f) => <span key={f.id} className="w-20"><MiniaturaDaFoto foto={f} selo={false} /><span className="mt-1 block truncate text-[11px]">{f.nome}</span></span>)}</div>
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={ocupado} onClick={() => setIds([])}>Trocar seleção</Button><label className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">Público<select aria-label="Público dos produtos selecionados" className={campo} value={publico} disabled={ocupado} onChange={(e) => setPublico(e.target.value)}><option value="automatico">Identificar automaticamente</option>{PUBLICOS_DO_PRODUTO.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}</select></label></div>
    <p className="text-[12px] text-muted-foreground">{selecionadas.length} {selecionadas.length === 1 ? "foto → 1 produto" : "fotos → produtos separados"}. Para juntar vários ângulos do mesmo produto, use Adicionar fotos no organizador.</p>
    {publico === "automatico" ? <BotaoComCusto rotulo={`Marcar ${selecionadas.length} e identificar`} titulo="Produtos cadastrados" descricao="Salva os produtos e identifica o público comercial de cada um. Os já cadastrados são mantidos." partes={() => partesDaLeitura(catalogo, selecionadas.length)} executar={salvar} disabled={ocupado} /> : <Button disabled={ocupado} onClick={() => void salvar().catch((e) => erro(e, "Produtos não salvos"))}>Marcar {selecionadas.length} como produto</Button>}
    {ocupado && <p role="status" className="text-[12px]">{progresso}</p>}
  </div>;
}
