import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Secao, botao, foco, juntar, texto } from "@/components/sistema";
import {
  EXPLICACAO_DO_MODO,
  MODOS_DE_APROVACAO,
  ROTULO_DO_MODO,
  lerModoDeAprovacao,
  salvarModoDeAprovacao,
  type ModoDeAprovacao,
} from "@/lib/clientes/modoDeAprovacao";

/**
 * "Como este cliente aprova as peças", na aba Cadastro da ficha (14/11/2026).
 * Mostra a regra gravada em profiles.modo_aprovacao_do_cliente: pelo portal
 * (todos) ou a revisão interna basta (exceção). Só o admin altera; a equipe
 * lê. Salva sozinho, sem depender do "Salvar" do cadastro.
 *
 * É o registro da regra. A agenda e a publicação não leem este campo.
 */
export default function ModoDeAprovacaoNoCadastro({ clientId, admin }: { clientId: string; admin: boolean }) {
  const queryClient = useQueryClient();
  const chave = ["modo-de-aprovacao-do-cliente", clientId];
  const { data: atual, isLoading, isError } = useQuery({
    queryKey: chave,
    queryFn: () => lerModoDeAprovacao(clientId),
    enabled: Boolean(clientId),
    retry: false,
  });
  const [escolha, setEscolha] = useState<ModoDeAprovacao | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setEscolha(atual ?? null);
  }, [atual, clientId]);

  const mudou = Boolean(atual) && escolha !== null && escolha !== atual;

  const salvar = async () => {
    if (!admin || !escolha || !mudou) return;
    setSalvando(true);
    try {
      await salvarModoDeAprovacao(clientId, escolha);
      queryClient.setQueryData(chave, escolha);
      // A Esteira mostra a regra ao lado do cliente: relê na próxima visita.
      void queryClient.invalidateQueries({ queryKey: ["esteira-linha-modo-aprovacao"] });
      toast.success(`Aprovação das peças: ${ROTULO_DO_MODO[escolha]}`, {
        description: "A regra ficou registrada no cadastro. Nada foi agendado nem publicado.",
      });
    } catch (e) {
      toast.error("Não salvou", { description: e instanceof Error ? e.message : "Tente de novo." });
    } finally {
      setSalvando(false);
    }
  };

  const descricao = isLoading ? "Lendo" : isError || !atual ? "Não foi possível ler agora" : ROTULO_DO_MODO[atual];

  return (
    <Secao
      titulo="Como este cliente aprova as peças"
      divisoria
      descricao={descricao}
      ajuda="A regra combinada com o cliente. Pelo portal: a peça só segue depois que ele aprova. A revisão interna basta: exceção, a agência revisa e a peça segue. É só o registro da regra; a agenda e a publicação ainda não leem este campo."
    >
      <div className="min-w-0 space-y-2" data-modo-de-aprovacao-cadastro="">
        {isError && <p className={texto.auxiliar}>A regra deste cliente não pôde ser lida agora. O resto do cadastro funciona normalmente.</p>}
        {!isError && (
          <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="Como este cliente aprova as peças">
            {MODOS_DE_APROVACAO.map((modo) => {
              const escolhido = escolha === modo;
              return (
                <button
                  key={modo}
                  type="button"
                  role="radio"
                  aria-checked={escolhido}
                  disabled={!admin || isLoading || salvando || !atual}
                  onClick={() => setEscolha(modo)}
                  className={juntar(
                    "min-w-0 flex-1 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-default",
                    escolhido ? "border-primary bg-primary/10" : "border-border bg-background",
                    admin ? "hover:bg-muted" : "disabled:opacity-80",
                    foco,
                  )}
                >
                  <span className={juntar(texto.corpo, "block font-medium")}>{ROTULO_DO_MODO[modo]}</span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block")}>{EXPLICACAO_DO_MODO[modo]}</span>
                </button>
              );
            })}
          </div>
        )}
        {!admin && !isError && <p className={texto.auxiliar}>Só o administrador altera esta regra.</p>}
        {admin && mudou && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={salvar} disabled={salvando} className={juntar(botao.primario, "h-9 px-3")}>
              {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Salvar regra
            </button>
            <button type="button" onClick={() => setEscolha(atual ?? null)} disabled={salvando} className={juntar(botao.discreto, "h-9 px-3")}>
              Desfazer
            </button>
            <p className={texto.auxiliar}>Mudar a regra não agenda nem publica nada.</p>
          </div>
        )}
      </div>
    </Secao>
  );
}
