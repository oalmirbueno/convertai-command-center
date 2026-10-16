import { CalendarCheck, Loader2, Lock, Undo2, Wand2, X } from "lucide-react";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { dataCurtaOuSem, type Planejamento } from "./usePlanejamento";

/**
 * Antes e depois das datas, com Confirmar (pelo mesmo caminho do "Publicar
 * em") e Descartar. O mesmo bloco no simulador e no calendário.
 */
export default function PainelDeMudancas({ plano, podePublicar, compacto = false }: { plano: Planejamento; podePublicar: boolean; compacto?: boolean }) {
  const { mudancas, pendentes, aplicando } = plano;
  const aplicaveis = mudancas.filter((m) => m.agenda).length + pendentes.length;
  return (
    <div className="min-w-0 space-y-2" data-painel-de-mudancas="">
      <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
        {/* 16/10/2026 (dono: "texto + ícone vira só o ícone, sem bordas"): o nome fica no title e no leitor de tela. */}
        <button type="button" className={botao.icone} onClick={plano.automatico} aria-label="Trocar datas automaticamente" title={`Trocar datas automaticamente: ordem intercalada e o melhor horário do cliente${plano.fonteDoHorario === "historico" ? " (pelo histórico de alcance)" : ""}`}>
          <Wand2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {mudancas.length > 0 && (
          <button type="button" className={botao.icone} onClick={plano.descartar} aria-label="Descartar as mudanças" title="Descartar as mudanças">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {mudancas.length === 0 && pendentes.length === 0 ? (
        <div className="flex min-w-0 items-center">
          <p className={juntar(texto.auxiliar, "min-w-0 truncate")}>Nenhuma data para confirmar</p>
          <AjudaRecolhida className="ml-1" rotulo="Como mudar as datas">
            Arraste um post, mude a data dele ou peça a troca automática.
          </AjudaRecolhida>
        </div>
      ) : (
        <div className="min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="flex min-w-0 items-center">
            <p className="text-[13px] font-medium text-foreground">Antes e depois</p>
            <AjudaRecolhida className="ml-1" rotulo="Como confirmar as datas">
              Publica só com aprovação do cliente e data confirmada.
              {mudancas.some((m) => !m.agenda) ? " Com cadeado: só simulação ou sem peça do Estúdio (a data desses muda na Agenda ou no post)." : ""}
            </AjudaRecolhida>
          </div>
          {/* Rola por dentro só de 1024 px para cima (no celular a página rola). */}
          <ul className={juntar("mt-1 space-y-1 text-[12px] leading-4", compacto ? "lg:max-h-[220px] lg:overflow-y-auto lg:overscroll-contain" : "")}>
            {mudancas.map((m) => (
              <li key={m.id} className="flex min-w-0 items-center" title={m.motivo || undefined}>
                <span className="mr-2 min-w-0 flex-1 truncate text-foreground">{m.titulo}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground line-through">{dataCurtaOuSem(m.de)}</span>
                <span className="mx-1 shrink-0 text-muted-foreground">para</span>
                <strong className="shrink-0 tabular-nums text-foreground">{dataCurtaOuSem(m.para)}</strong>
                {!m.agenda && <Lock className="ml-1.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label={m.motivo || "Não agenda por aqui"} />}
                <button type="button" className={juntar(botao.icone, "ml-1 h-6 w-6")} onClick={() => plano.desfazerUm(m.id)} aria-label={`Desfazer a mudança de ${m.titulo}`} title={`Desfazer a mudança de ${m.titulo}`}>
                  <Undo2 className="h-3 w-3" />
                </button>
              </li>
            ))}
            {pendentes.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center">
                <span className="mr-2 min-w-0 flex-1 truncate text-foreground">{p.titulo}</span>
                <span className={juntar(etiqueta, "mr-1 bg-secondary text-muted-foreground")}>confirmar a proposta</span>
                <strong className="shrink-0 tabular-nums text-foreground">{dataCurtaOuSem(p.data)}</strong>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            {podePublicar ? (
              <button
                type="button"
                className={juntar(botao.primario, "mr-2 h-8 gap-0 px-3 text-[12px]")}
                onClick={() => void plano.aplicar()}
                disabled={!!aplicando || !aplicaveis}
                title={aplicando ? `Confirmando ${aplicando.feitos + 1} de ${aplicando.total}` : `Confirmar ${aplicaveis} ${aplicaveis === 1 ? "data" : "datas"}`}
              >
                {aplicando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
                <span className="ml-1.5 tabular-nums" aria-hidden="true">{aplicando ? `${aplicando.feitos + 1}/${aplicando.total}` : aplicaveis}</span>
                <span className="sr-only">{aplicando ? `Confirmando ${aplicando.feitos + 1} de ${aplicando.total}` : `Confirmar ${aplicaveis} ${aplicaveis === 1 ? "data" : "datas"}`}</span>
              </button>
            ) : (
              <p className={juntar(texto.auxiliar, "mr-2")}>Só admin ou gestor confirma as datas.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
