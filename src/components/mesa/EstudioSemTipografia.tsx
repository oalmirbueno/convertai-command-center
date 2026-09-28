import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida } from "@/components/sistema";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { arquivoDoProprioCliente, gerarAmostrasDaTipografia } from "@/lib/mesa/amostraDaFonte";
import { chamarFuncao, padraoDoContexto, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { depsDaAmostraNoSupabase, fontesDaMarcaNaTela, lerFontesComMarca, useSemTipografia, useTipografiaDaMarca } from "@/lib/mesa/tipografiaDoCliente";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { chaveDasFontes, useInvalidarContexto } from "./contextoDoCliente";

/**
 * Estúdio sem tipografia no kit (frente T2, 26/09/2026). Regra do dono: "não
 * inventar". Sem fonte no kit da marca aberta, a geração fica bloqueada (o
 * servidor também recusa com sem_tipografia) e aparece o aviso curto com duas
 * saídas:
 * - "Sugerir da biblioteca": o Jev escolhe um par (título e texto) da
 *   biblioteca da agência pelo contexto da marca (agente-contexto, ação
 *   fontes_da_biblioteca com previa); a equipe vê o par e confirma; só então
 *   ele é gravado no kit desta marca, com a amostra da tipografia, e dá para
 *   desfazer;
 * - "Definir no Contexto": abre o Contexto do cliente.
 * Troca a decisão anterior ("usando a da referência").
 */

export const TEXTO_SEM_TIPOGRAFIA = "Defina a tipografia do cliente";
export const AJUDA_SEM_TIPOGRAFIA =
  "Sem fonte no kit, o Estúdio não gera a arte: a letra não é inventada nem copiada da referência. Sugira um par da biblioteca da agência (você confirma antes de gravar) ou defina no Contexto, em Fontes.";

/** O Jev escolhe entre cerca de 40 pares com o contexto da marca (mesma conta do Contexto). */
const TOKENS_DA_SUGESTAO = { entrada: 6000, saida: 100 };

export { useSemTipografia };

type Sugestao = { titulo: string; texto: string; titulo_id: string; texto_id: string; porque?: string | null };

function lerSugestao(data: any): Sugestao | null {
  const s = data && data.sugestao;
  if (!s || typeof s.titulo_id !== "string" || typeof s.texto_id !== "string") return null;
  return { titulo: String(s.titulo || ""), texto: String(s.texto || ""), titulo_id: s.titulo_id, texto_id: s.texto_id, porque: s.porque ? String(s.porque) : null };
}

/**
 * Frente AE (28/09): a outra marca (ex.: CME) não usa mais a letra da
 * principal sem pedir. Um clique explícito copia as fontes do cliente para
 * ela (linhas novas com marca_id dela; as da principal ficam como estão).
 */
export function linhasCopiadasParaAMarca(fontes: Record<string, unknown>[], marcaId: string): Record<string, unknown>[] {
  return fontes
    .filter((f) => !f.marca_id)
    .map((f) => {
      const copia: Record<string, unknown> = {};
      Object.keys(f).forEach((k) => {
        if (k !== "id" && k !== "criado_em" && k !== "atualizado_em") copia[k] = f[k];
      });
      copia.marca_id = marcaId;
      return copia;
    });
}

export default function EstudioSemTipografia({ clientId }: { clientId: string }) {
  const { catalogo, atualizarCusto } = useMesa();
  const { marca, marcas } = useMarcaDaMesa();
  const tipografia = useTipografiaDaMarca(clientId, marca);
  const [copiando, setCopiando] = useState(false);
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const avisarErro = useAvisarErro();
  const semTipografia = useSemTipografia(clientId, marca);
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [gravando, setGravando] = useState(false);
  const modelo = padraoDoContexto(catalogo);

  if (!semTipografia) return null;

  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
    invalidar(clientId);
  };

  /** Desfazer: as linhas gravadas saem do kit (e a amostra desenhada para o cliente). */
  const desfazer = async (ids: string[], amostras: string[]) => {
    try {
      const { error } = await (supabase as any).from("cliente_fontes").delete().in("id", ids).eq("client_id", clientId);
      if (error) throw error;
      const doCliente = amostras.filter((c) => arquivoDoProprioCliente(c, clientId));
      if (doCliente.length) await supabase.storage.from("mesa").remove(doCliente).catch(() => null);
      toast.success("Tipografia desfeita");
    } catch (e) {
      toast.error("Não foi possível desfazer", { description: textoDoErro(e) });
    } finally {
      reler();
    }
  };

  const principal = marcas.filter((m) => m.principal)[0] || null;
  const podeCopiar = !!(marca && !marca.principal && tipografia.data && tipografia.data.usaDoCliente);
  const copiarDaPrincipal = async () => {
    if (!marca || marca.principal) return;
    setCopiando(true);
    try {
      const { data, error } = await (supabase as any).from("cliente_fontes").select("*").eq("client_id", clientId).is("marca_id", null);
      if (error) throw error;
      const linhas = linhasCopiadasParaAMarca((data || []) as Record<string, unknown>[], marca.id);
      if (!linhas.length) throw new Error("O cliente não tem fontes para copiar.");
      const { data: novas, error: erroNovas } = await (supabase as any).from("cliente_fontes").insert(linhas).select("id");
      if (erroNovas) throw erroNovas;
      const ids = ((novas || []) as { id: string }[]).map((n) => n.id);
      toast.success(`Fontes copiadas para a ${marca.nome}`, {
        description: "Agora elas são da marca também. Dá para trocar no Contexto, em Fontes.",
        action: ids.length ? { label: "Desfazer", onClick: () => void desfazer(ids, []) } : undefined,
      });
    } catch (e) {
      avisarErro(e, "Fontes não copiadas");
    } finally {
      setCopiando(false);
      reler();
    }
  };

  const confirmar = async () => {
    if (!sugestao) return;
    setGravando(true);
    try {
      await chamarFuncao<any>("agente-contexto", {
        acao: "fontes_da_biblioteca",
        client_id: clientId,
        gravar: { titulo_id: sugestao.titulo_id, texto_id: sugestao.texto_id },
      });
      // As linhas novas desta marca (pela família da biblioteca), para a amostra e o desfazer.
      const todas = await lerFontesComMarca(clientId);
      const novas = fontesDaMarcaNaTela(todas, marca).filter((f) => f.biblioteca_id === sugestao.titulo_id || f.biblioteca_id === sugestao.texto_id);
      const r = novas.length ? await gerarAmostrasDaTipografia(clientId, novas, depsDaAmostraNoSupabase(clientId)) : { feitas: 0, falhas: [] };
      const depois = novas.length ? await lerFontesComMarca(clientId) : [];
      const amostras = depois.filter((f) => novas.some((n) => n.id === f.id)).map((f) => f.amostra_path || "").filter(Boolean);
      const ids = novas.map((f) => f.id);
      toast.success(`Tipografia definida: ${sugestao.titulo} e ${sugestao.texto}`, {
        description: r.falhas.length ? "A amostra da tipografia não foi gerada; gere no Contexto, em Fontes." : "Com a amostra da tipografia. Já dá para gerar.",
        action: ids.length ? { label: "Desfazer", onClick: () => void desfazer(ids, amostras) } : undefined,
      });
      setSugestao(null);
    } catch (e) {
      avisarErro(e, "Tipografia não gravada");
    } finally {
      setGravando(false);
      reler();
    }
  };

  return (
    <div className="mb-3 min-w-0 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2" role="alert" data-aviso="sem-tipografia">
      <div className="flex min-w-0 flex-wrap items-center">
        <Type className="mr-2 h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="mr-auto flex min-w-0 items-center text-[12.5px] font-medium text-foreground">
          <span className="min-w-0 truncate">{TEXTO_SEM_TIPOGRAFIA}</span>
          <AjudaRecolhida className="ml-1.5" rotulo="Por que a geração está parada">{AJUDA_SEM_TIPOGRAFIA}</AjudaRecolhida>
        </p>
        {podeCopiar && !sugestao && marca && (
          <Button type="button" size="sm" variant="outline" className="my-0.5 ml-2 h-8 shrink-0 text-[12px]" onClick={() => void copiarDaPrincipal()} disabled={copiando} data-copiar-fontes-da-principal="">
            {copiando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Usar as fontes {principal ? `da ${principal.nome}` : "do cliente"} na {marca.nome}
          </Button>
        )}
        {!sugestao && (
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" />Sugerir da biblioteca</>}
            titulo="Sugerir a tipografia da biblioteca"
            descricao="O Jev escolhe um par de título e texto da biblioteca da agência pelo contexto da marca. Você vê o par e confirma antes de gravar."
            variant="outline"
            className="my-0.5 ml-2 h-8 shrink-0 text-[12px]"
            fecharAoConfirmar
            partes={(): ParteDaEstimativa[] => [{ modeloId: modelo ? modelo.id : undefined, tipo: "texto", tokensEntrada: TOKENS_DA_SUGESTAO.entrada, tokensSaida: TOKENS_DA_SUGESTAO.saida }]}
            executar={() => chamarFuncao<any>("agente-contexto", { acao: "fontes_da_biblioteca", client_id: clientId, previa: true })}
            aoConcluir={(data) => {
              atualizarCusto();
              const s = lerSugestao(data);
              if (!s) {
                toast.error("A biblioteca não sugeriu um par agora. Defina no Contexto.");
                return;
              }
              setSugestao(s);
            }}
          />
        )}
        <a
          href={`/mesa?client=${encodeURIComponent(clientId)}&aba=contexto`}
          className="my-0.5 ml-2 inline-flex h-8 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
        >
          Definir no Contexto
        </a>
      </div>
      {sugestao && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center border-t border-warning/30 pt-2" data-sugestao-da-tipografia="">
          <p className="mr-auto min-w-0 text-[12px] leading-snug [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Título:</span> <strong>{sugestao.titulo}</strong>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">Texto:</span> <strong>{sugestao.texto}</strong>
            {sugestao.porque ? <span className="block text-[11px] text-muted-foreground">{sugestao.porque}</span> : null}
          </p>
          <Button type="button" size="sm" variant="ghost" className="my-0.5 ml-2 h-8 text-[12px]" onClick={() => setSugestao(null)} disabled={gravando}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="my-0.5 ml-2 h-8 text-[12px]" onClick={() => void confirmar()} disabled={gravando}>
            {gravando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Confirmar e gravar no kit
          </Button>
        </div>
      )}
    </div>
  );
}
