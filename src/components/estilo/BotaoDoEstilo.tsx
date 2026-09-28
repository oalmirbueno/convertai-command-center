import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Palette } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { botao, juntar } from "@/components/sistema";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarEstilo, chaveDoEstiloLeve } from "./estiloApi";
import InterruptorDoEstilo from "./InterruptorDoEstilo";
import SeletorDeTemplate from "./SeletorDeTemplate";

const PainelDoEstilo = lazy(() => import("./PainelDoEstilo"));

/**
 * Botão discreto "Estilo" (frente S2) para dentro de qualquer estúdio que gera
 * imagem: abre o agente de estilo do cliente e, quando recebe os trabalhos da
 * tela, mostra ao lado o interruptor "Usar estilo do cliente" desta geração.
 * Montagem numa linha: <BotaoDoEstilo trabalhoIds={[trabalho.id]} modeloImagemId={...} />.
 * Nada muda na geração enquanto o interruptor estiver desligado (o padrão).
 */
export default function BotaoDoEstilo({
  trabalhoIds = [],
  modeloImagemId,
  compacto = false,
  className = "",
}: {
  /** Trabalhos do estúdio que o interruptor liga ou desliga (vazio: só o botão). */
  trabalhoIds?: Array<string | null | undefined>;
  /** Gerador escolhido no Estúdio: os testes usam o mesmo. */
  modeloImagemId?: string | null;
  /**
   * Frente AE-3 (dono, 28/09: "só a chave Estilo do cliente com o ?"): o botão do agente vira só o
   * ícone da paleta e a chave fica "Estilo do cliente". Nada muda na função.
   */
  compacto?: boolean;
  className?: string;
}) {
  const { clientId, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const [aberto, setAberto] = useState(false);
  const leve = useQuery({
    queryKey: chaveDoEstiloLeve(clientId, marcaId),
    queryFn: async () => {
      const d = await chamarEstilo<{ ativo?: boolean; versao_atual?: number }>("estado", clientId, marcaId, { leve: true });
      return { ativo: !!(d && d.ativo), versao_atual: (d && d.versao_atual) || 0 };
    },
    staleTime: 60_000,
    retry: 1,
  });
  const ativo = !!(leve.data && leve.data.ativo);
  const ids = trabalhoIds.filter((x): x is string => typeof x === "string" && !!x);

  return (
    <span className={juntar("inline-flex min-w-0 items-center", className)} data-botao-do-estilo="">
      <button
        type="button"
        className={compacto ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" : juntar(botao.barra, "h-10 md:h-8")}
        onClick={() => setAberto(true)}
        aria-label="Abrir o agente de estilo do cliente"
        title={compacto ? "Abrir o agente de estilo do cliente" : "Estilo do cliente"}
      >
        <Palette className={juntar(compacto ? "h-4 w-4" : "mr-1.5 h-4 w-4", ativo ? "text-primary" : "")} aria-hidden="true" />
        {compacto ? null : "Estilo"}
      </button>
      {ids.length > 0 && <InterruptorDoEstilo clientId={clientId} marcaId={marcaId} trabalhoIds={ids} estiloAtivo={ativo} rotulo={compacto ? "Estilo do cliente" : undefined} className={compacto ? "ml-1" : "ml-2"} />}
      {ids.length > 0 && <SeletorDeTemplate clientId={clientId} marcaId={marcaId} trabalhoIds={ids} className="ml-2" />}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)] [&_[data-cabecalho-do-agente]]:pr-12">
          <DialogTitle className="sr-only">Estilo do cliente</DialogTitle>
          <DialogDescription className="sr-only">Converse com o agente de estilo, veja o guia do cliente e gere imagens de teste.</DialogDescription>
          {aberto && (
            <Suspense
              fallback={
                <p className="flex items-center p-4 text-[12px] text-muted-foreground">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Abrindo...
                </p>
              }
            >
              <PainelDoEstilo modeloImagemId={modeloImagemId} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}
