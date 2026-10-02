import { useMemo } from "react";
import { Check, Sparkles, UserRound, UsersRound } from "lucide-react";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { Moldura, useMesaFoto } from "./Comuns";
import { usePersonas, useImagensDaPersona, type Persona } from "./modelosApi";
import { useClones, type Clone } from "./clonesApi";
import type { ModeloEscolhido } from "./escolhasDaLinha";

/**
 * Quem aparece na foto com modelo (02/10, dono: "escolher o modelo ou clone
 * de uma lista pronta, ali mesmo, sem pedir para abrir campanha"): as pessoas
 * prontas de Modelos (personas com a folha) e de Clones (pessoa real com
 * autorização válida), em cartões com rosto e nome, mais "Pessoa nova pela
 * IA" (o perfil decide). A escolha volta pelo `onEscolher`.
 */

export interface OpcaoDeModelo extends ModeloEscolhido {
  /** Pronta para usar (persona com âncora; clone com autorização válida). */
  pronta: boolean;
  motivo: string | null;
}

/** As pessoas que servem para a foto com modelo, prontas primeiro. Pura: os testes usam. */
export function opcoesDeModelo(personas: Persona[], clones: Clone[]): OpcaoDeModelo[] {
  const ps: OpcaoDeModelo[] = personas
    .filter((p) => p.status !== "arquivada")
    .map((p) => ({ tipo: "persona" as const, id: p.id, nome: p.nome || "Persona sem nome", pronta: !!p.ancora_imagem_id, motivo: p.ancora_imagem_id ? null : "Falta escolher o retrato (âncora) em Modelos." }));
  const cs: OpcaoDeModelo[] = clones
    .filter((c) => c.status !== "arquivado")
    .map((c) => ({
      tipo: "clone" as const,
      id: c.id,
      nome: c.nome || "Clone sem nome",
      pronta: c.autorizacao_valida.ok && c.identidade_real.length > 0,
      motivo: !c.autorizacao_valida.ok ? c.autorizacao_valida.motivo || "Autorização vencida ou faltando." : !c.identidade_real.length ? "Faltam as fotos reais." : null,
    }));
  return ps.concat(cs).sort((a, b) => Number(b.pronta) - Number(a.pronta));
}

function RostoDaPersona({ persona }: { persona: Persona }) {
  const imagens = useImagensDaPersona(persona.id);
  const ancora = (imagens.data || []).find((i) => i.id === persona.ancora_imagem_id) || (imagens.data || []).find((i) => i.papel === "ancora") || null;
  if (!ancora) return <span className="flex h-full w-full items-center justify-center text-muted-foreground"><UserRound className="h-5 w-5" /></span>;
  return ancora.storage_path ? <ImagemDaMesa caminho={ancora.storage_path} bucket={ancora.storage_bucket || "mesa"} alt={persona.nome} className="h-full w-full object-cover" /> : <img src={ancora.url} alt={persona.nome} className="h-full w-full object-cover" />;
}

export default function EscolhaDoModeloDaFoto({ valor, onEscolher }: { valor: ModeloEscolhido | null; onEscolher: (m: ModeloEscolhido | null) => void }) {
  const { clientId } = useMesa();
  const { irPara } = useMesaFoto();
  const personas = usePersonas(clientId);
  const clones = useClones(clientId);
  const opcoes = useMemo(() => opcoesDeModelo(personas.data || [], clones.data || []), [personas.data, clones.data]);
  const carregando = personas.isLoading || clones.isLoading;

  return (
    <div className="min-w-0" data-escolha-do-modelo="" data-modelo-escolhido={valor ? `${valor.tipo}:${valor.id}` : "ia"}>
      <ul className="grid min-w-0 grid-cols-3 gap-2 scrollbar-hidden sm:grid-cols-4 lg:max-h-[280px] lg:overflow-y-auto lg:overscroll-contain" role="listbox" aria-label="Quem aparece na foto" data-lista-de-modelos="">
        <li className="min-w-0">
          <button
            type="button"
            role="option"
            aria-selected={!valor}
            onClick={() => onEscolher(null)}
            className={juntar("w-full min-w-0 rounded-lg border p-1 text-left", !valor ? "border-primary bg-primary/[0.06]" : "border-border hover:border-primary/50", foco)}
            data-modelo-opcao="ia"
          >
            <Moldura proporcao={1}>
              <span className="flex h-full w-full items-center justify-center text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
            </Moldura>
            <span className="mt-1 block truncate text-[12px] font-medium">Pessoa nova</span>
          </button>
        </li>
        {opcoes.map((o) => {
          const ativo = !!valor && valor.tipo === o.tipo && valor.id === o.id;
          const persona = o.tipo === "persona" ? (personas.data || []).find((p) => p.id === o.id) || null : null;
          const clone = o.tipo === "clone" ? (clones.data || []).find((c) => c.id === o.id) || null : null;
          return (
            <li key={`${o.tipo}-${o.id}`} className="min-w-0">
              <button
                type="button"
                role="option"
                aria-selected={ativo}
                disabled={!o.pronta}
                title={o.motivo || undefined}
                onClick={() => onEscolher({ tipo: o.tipo, id: o.id, nome: o.nome })}
                className={juntar("relative w-full min-w-0 rounded-lg border p-1 text-left disabled:opacity-50", ativo ? "border-primary bg-primary/[0.06]" : "border-border hover:border-primary/50", foco)}
                data-modelo-opcao={`${o.tipo}:${o.id}`}
              >
                <Moldura proporcao={1}>
                  {persona ? <RostoDaPersona persona={persona} /> : clone && clone.capa_url ? <img src={clone.capa_url} alt={o.nome} className="h-full w-full object-cover" /> : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <UsersRound className="h-5 w-5" />
                    </span>
                  )}
                </Moldura>
                {ativo && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <span className="mt-1 flex min-w-0 items-center text-[12px] font-medium">
                  {o.tipo === "persona" ? <UserRound className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : <UsersRound className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className="min-w-0 truncate">{o.nome}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
        <span className="mr-2">
          {carregando ? "Lendo os modelos" : opcoes.length ? `${opcoes.filter((o) => o.pronta).length} prontos` : "Nenhum modelo ainda"}
        </span>
        <button type="button" className={juntar("mr-3 font-medium text-primary hover:underline", foco)} onClick={() => irPara("modelos")}>
          Criar modelo
        </button>
        <button type="button" className={juntar("mr-1 font-medium text-primary hover:underline", foco)} onClick={() => irPara("clones")}>
          Criar clone
        </button>
        <AjudaRecolhida rotulo="Sobre o modelo">
          Modelo pronto mantém o mesmo rosto em todas as fotos (a folha das 6 vistas vai junto como referência). Clone é pessoa real, só com autorização válida. Pessoa nova é criada pela IA pelo perfil.
        </AjudaRecolhida>
      </div>
    </div>
  );
}
