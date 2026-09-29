import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { rolagem } from "@/components/sistema/estilos";
import EstudioDeNomes from "./EstudioDeNomes";

/**
 * O criador de nomes aberto da Mesa → Campanhas (nome de campanha). Mesma
 * função e mesmo estúdio da Mesa Identidade, com alvo "campanha": o contexto
 * da campanha aberta entra na geração e a rodada fica ligada a ela.
 */
export default function NamingDaCampanha({ aberto, onOpenChange, campanhaId, nomeDaCampanha }: { aberto: boolean; onOpenChange: (v: boolean) => void; campanhaId: string | null; nomeDaCampanha?: string | null }) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogTitle>{nomeDaCampanha ? `Nomes para ${nomeDaCampanha}` : "Nome de campanha"}</DialogTitle>
        <div className={rolagem.janela}>
          <EstudioDeNomes alvo="campanha" campanhaId={campanhaId} pedidoInicial={campanhaId ? "" : "Nome para uma campanha nova"} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
