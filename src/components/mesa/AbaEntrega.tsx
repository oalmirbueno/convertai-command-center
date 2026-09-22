import { ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import { dataCurta, rotuloDoMes, somarMeses, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ROTULO_DO_TRABALHO, ultimasVersoes, useItensDoMes } from "./useItensDoMes";

/**
 * Aba Entrega (SPEC seção 6, etapa 3 da construção): por enquanto mostra o
 * mês com o estado da arte de cada item. O envio em lote para aprovação
 * entra quando o backend estiver pronto; o botão já está no lugar, desligado.
 */
export default function AbaEntrega({ mes, onMes, onAbrir }: { mes: string; onMes: (m: string) => void; onAbrir: (taskId: string) => void }) {
  const { clientId } = useMesa();
  const dados = useItensDoMes(clientId, mes);
  const itens = dados.data?.itens || [];
  const entregues = itens.filter((i) => dados.data?.trabalhos.get(i.id)?.status === "entregue").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMes(somarMeses(mes, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-[13px] font-medium capitalize">{rotuloDoMes(mes)}</p>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMes(somarMeses(mes, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-[12px] text-muted-foreground">{entregues} de {itens.length} com arte entregue</span>
        <div className="flex w-full flex-col items-stretch gap-1 sm:ml-auto sm:w-auto sm:items-end">
          <Button type="button" disabled title="Em breve">
            <Send className="mr-1.5 h-4 w-4" /> Enviar tudo para aprovação
          </Button>
          <span className="text-center text-[11px] text-muted-foreground sm:text-right">em breve</span>
        </div>
      </div>

      {dados.isLoading && <p className="text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Lendo a agenda…</p>}
      {dados.isError && <p className="rounded-lg bg-destructive/10 p-3 text-[12.5px]">{textoDoErro(dados.error)}</p>}
      {dados.data && itens.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhum item com arte na agenda deste mês.</p>}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {itens.map((i) => {
          const t = dados.data?.trabalhos.get(i.id) || null;
          const capa = t ? ultimasVersoes(t.cards).get(1) || Array.from(ultimasVersoes(t.cards).values())[0] : null;
          const total = t?.direcao?.cards?.length || 0;
          const feitos = t ? ultimasVersoes(t.cards).size : 0;
          return (
            <li key={i.id}>
              <button type="button" onClick={() => onAbrir(i.id)} className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/30">
                <ImagemDaMesa caminho={capa?.storage_path} alt={i.title} className="h-14 w-11 shrink-0 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{i.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {dataCurta(i.due_date)} · {TASK_DELIVERY_TYPE_LABELS[i.delivery_type as TaskDeliveryType] || i.delivery_type}
                    {total ? ` · ${feitos}/${total} cards` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${
                    t?.status === "entregue" ? "bg-success/10 text-success" : t?.status === "erro" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {t ? ROTULO_DO_TRABALHO[t.status] || t.status : "sem arte"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
