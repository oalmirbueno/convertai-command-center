import { useMemo, useState } from "react";
import { Check, Images, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useMesaFoto } from "./Comuns";
import { useKits } from "./fotoApi";
import { usePersonas } from "./modelosApi";
import { useClones } from "./clonesApi";
import { opcoesDeModelo } from "./EscolhaDoModeloDaFoto";
import { gravarModeloEscolhido, gravarPreenchimento } from "./escolhasDaLinha";
import { chipsDaIntencao, lerIntencaoDoDiretor, preenchimentoDaIntencao } from "./intencaoDoDiretor";

/**
 * A proposta do diretor enquanto a pessoa escreve (02/10): "8 fotos do
 * mouse de frente e de cima, na bancada, luz natural" já mostra o que vai
 * abrir preenchido. Confirmar abre Fotos do produto ou Foto com modelo com
 * tudo no lugar (o custo aparece lá, antes de gerar). Sem custo aqui.
 */
export default function PropostaAoVivo({ texto, onConfirmado }: { texto: string; onConfirmado?: () => void }) {
  const { clientId } = useMesa();
  const { kitId, irPara, escolherKit, escolherEnsaio, escolherObjetivo } = useMesaFoto();
  const kits = useKits(clientId);
  const personas = usePersonas(clientId);
  const clones = useClones(clientId);
  const [dispensado, setDispensado] = useState("");
  const produtos = useMemo(() => (kits.data || []).filter((k) => !!k.id && k.status !== "arquivado").map((k) => ({ id: String(k.id), nome: k.nome || "" })), [kits.data]);
  const modelos = useMemo(() => opcoesDeModelo(personas.data || [], clones.data || []).filter((o) => o.pronta).map((o) => ({ tipo: o.tipo, id: o.id, nome: o.nome })), [personas.data, clones.data]);
  const intencao = useMemo(() => lerIntencaoDoDiretor(texto, { produtos, modelos, produtoAberto: kitId }), [texto, produtos, modelos, kitId]);
  if (!intencao || dispensado === texto) return null;
  const chips = chipsDaIntencao(intencao);
  const Icone = intencao.objetivo === "modelo" ? Megaphone : Images;
  const confirmar = () => {
    gravarPreenchimento(clientId, preenchimentoDaIntencao(intencao, texto));
    if (intencao.modelo) gravarModeloEscolhido(clientId, intencao.modelo);
    if (intencao.produto) escolherKit(intencao.produto.id);
    if (escolherObjetivo) escolherObjetivo(intencao.objetivo);
    escolherEnsaio(null);
    irPara(intencao.objetivo === "modelo" ? "campanha" : "ensaio", { ensaio: null });
    if (onConfirmado) onConfirmado();
  };
  return (
    <div className="mb-1.5 min-w-0 rounded-lg border border-primary/40 px-2.5 py-2" data-proposta-ao-vivo={intencao.objetivo}>
      <div className="flex min-w-0 items-center">
        <Icone className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">Preencho assim?</span>
        <AjudaRecolhida rotulo="Sobre o preenchimento">
          Lido do que você escreveu, sem custo. Confirmar abre a ferramenta já preenchida (produto, quem aparece, quantas, ângulos, cenas e luz); lá aparece o custo antes de gerar as variações juntas.
        </AjudaRecolhida>
      </div>
      <ul className="mt-1.5 flex min-w-0 flex-wrap" aria-label="O que vai preenchido">
        {chips.map((c) => (
          <li key={c} className="mb-1 mr-1 rounded-full border border-border px-2 py-px text-[11px]" data-chip-da-proposta="">
            {c}
          </li>
        ))}
      </ul>
      {!intencao.produto && <p className="mb-1 text-[11px] text-muted-foreground">Sem produto citado: escolha lá.</p>}
      <div className="mt-1 flex min-w-0 items-center">
        <Button type="button" size="sm" className="mr-1.5 h-7 px-2.5 text-[12px]" onClick={confirmar} data-confirmar-proposta="">
          <Check className="mr-1 h-3.5 w-3.5" /> Confirmar
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setDispensado(texto)} aria-label="Dispensar a proposta">
          <X className="mr-1 h-3.5 w-3.5" /> Dispensar
        </Button>
      </div>
    </div>
  );
}
