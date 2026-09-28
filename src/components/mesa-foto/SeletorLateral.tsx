import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AjudaRecolhida, EstadoVazio, botao, foco, juntar, texto } from "@/components/sistema";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";

/**
 * Seletor lateral compacto das personas (Modelos), dos clones e dos books
 * (pedido do dono, 26/09: "o seletor lateral das imagens nos modelos está
 * muito grande, toma espaço; deixar pequeno, minimalista, com seletor").
 *
 * Sistema de design (docs/design/SISTEMA.md): sem caixa (a coluna já está na
 * área de trabalho), título curto com a contagem e a ação "Novo" na mesma
 * linha. No celular e no tablet, um seletor (lista que abre); de 1024 px para
 * cima, a lista curta com miniatura pequena, nome e o estado em ponto de cor.
 * A explicação vai no "?" (ajuda).
 *
 * 28/09 (dono: "tudo organizado para recolher"): com `recolher` (chave por
 * cliente), o título recolhe a lista e deixa à vista só o escolhido; a lista
 * longa rola por dentro no computador (RegiaoRolavel, nada disso no celular).
 */

export interface ItemDoSeletor {
  id: string;
  nome: string;
  /** Miniatura (32 px) já montada por quem chama (imagem do Storage ou URL). */
  miniatura: ReactNode;
  /** Ponto de cor do estado: classe de fundo (bg-success, bg-primary, bg-muted-foreground/40). */
  estado: { rotulo: string; ponto: string };
  /** Texto curto depois do estado ("da agência", "autorização inválida"). */
  nota?: string | null;
  alerta?: boolean;
}

export default function SeletorLateral({
  titulo,
  itens,
  escolhido,
  onEscolher,
  onNovo,
  novoRotulo,
  novoAberto,
  vazio,
  filtro,
  ajuda,
  recolher,
}: {
  titulo: string;
  itens: ItemDoSeletor[];
  escolhido: string | null;
  onEscolher: (id: string) => void;
  onNovo: () => void;
  novoRotulo: string;
  novoAberto: boolean;
  vazio: string;
  /** Filtro (opcional), já montado (SeletorCompacto). */
  filtro?: ReactNode;
  /** O que é esta lista, no "?" ao lado do título. */
  ajuda?: ReactNode;
  /** Chave para lembrar a lista recolhida (com o cliente). Sem ela, a lista fica sempre aberta. */
  recolher?: string;
}) {
  const atual = itens.find((i) => i.id === escolhido) || null;
  const [recolhidoGuardado, setRecolhido] = useRecolhido(recolher || "mesa-foto:seletor-lateral:sem-chave");
  const recolhido = !!recolher && recolhidoGuardado;
  return (
    <section className="min-w-0" aria-label={titulo} data-seletor-lateral="" data-recolhido={recolher ? (recolhido ? "sim" : "nao") : undefined}>
      <div className={juntar("flex min-w-0 items-center", recolhido ? "" : "mb-2")}>
        {recolher ? (
          <h2 className="min-w-0">
            <TituloRecolhivel titulo={titulo} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={atual ? atual.nome : undefined} />
          </h2>
        ) : (
          <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{titulo}</h2>
        )}
        <span className={juntar(texto.auxiliar, "ml-1.5 shrink-0 tabular-nums")}>{itens.length}</span>
        {ajuda && !recolhido && <AjudaRecolhida className="ml-1">{ajuda}</AjudaRecolhida>}
        <button type="button" className={juntar(botao.secundario, "ml-auto h-8 px-2.5 text-[12px]")} onClick={onNovo} disabled={novoAberto}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {novoRotulo}
        </button>
      </div>
      {recolhido ? null : filtro && <div className="mb-2 min-w-0">{filtro}</div>}
      {recolhido ? null : itens.length === 0 ? (
        <EstadoVazio compacto titulo={vazio} />
      ) : (
        <>
          <div className="min-w-0 lg:hidden">
            <Select value={atual ? atual.id : ""} onValueChange={onEscolher}>
              <SelectTrigger className="h-9 min-w-0 text-[13px]" aria-label={`Escolher em ${titulo}`}>
                <SelectValue placeholder={novoAberto ? "Criando novo" : "Escolha"} />
              </SelectTrigger>
              <SelectContent>
                {itens.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="hidden min-w-0 lg:block">
          <RegiaoRolavel modo="lg" memoria={recolher ? `${recolher}:rolagem` : undefined} classeDeFora="lg:max-h-[60vh]">
          <ul className="min-w-0 space-y-0.5" aria-label={titulo}>
            {itens.map((i) => {
              const ativo = i.id === escolhido;
              return (
                <li key={i.id} className="min-w-0" data-item-do-seletor={i.id}>
                  <button
                    type="button"
                    onClick={() => onEscolher(i.id)}
                    aria-pressed={ativo}
                    aria-label={`Abrir ${i.nome}`}
                    className={juntar("flex w-full min-w-0 items-center rounded-md px-1.5 py-1 text-left transition-colors", ativo ? "bg-primary/10" : "hover:bg-muted", foco)}
                  >
                    <span className="relative mr-2 block h-8 w-8 shrink-0 overflow-hidden rounded-md bg-muted">{i.miniatura}</span>
                    <span className="min-w-0 flex-1">
                      <span className={juntar("block truncate text-[13px]", ativo ? "font-semibold" : "font-medium")}>{i.nome}</span>
                      <span className="flex min-w-0 items-center text-[11px] text-muted-foreground">
                        <span className={`mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${i.estado.ponto}`} aria-hidden="true" />
                        <span className="truncate">
                          {i.estado.rotulo}
                          {i.nota ? ` · ${i.nota}` : ""}
                        </span>
                      </span>
                    </span>
                    {i.alerta && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Atenção" />}
                  </button>
                </li>
              );
            })}
          </ul>
          </RegiaoRolavel>
          </div>
        </>
      )}
    </section>
  );
}
