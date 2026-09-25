import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cartao } from "./Comuns";
import { gravarNaSessao, lerDaSessao } from "./sessao";
import { periodoDaCampanha, useCampanhasDaMesa, type CampanhaDaMesa } from "./fotoApi";

/**
 * A campanha da Mesa dentro da Mesa Foto (pedido do dono, 25/09: "na
 * campanha não dá para eu escolher a campanha; tem que reconhecer a campanha
 * do mês, o calendário"). Lista as campanhas que a Mesa usa (mesa_campanhas,
 * pela ação campanhas_listar, sem IA) com a do mês já marcada pelo
 * calendário editorial. A escolha vale para Variações e Campanha (fica na
 * sessão do navegador) e vai como campanha_id no planejamento: o diretor usa
 * tema, período, oferta e identidade dela, sempre dentro da marca.
 */

/** Sem campanha: o plano segue só a marca (a função não usa nem a do mês). */
export const SEM_CAMPANHA = "nenhuma";

/**
 * A campanha escolhida: a da sessão (inclusive "nenhuma") ou, sem escolha,
 * a do mês. Devolve o id para mandar (null quando nenhuma) e a campanha.
 */
export function useCampanhaEscolhida() {
  const { clientId } = useMesa();
  const q = useCampanhasDaMesa(clientId);
  const [escolha, setEscolhaNaTela] = useState<string | null>(() => lerDaSessao<string>(clientId, "campanha"));
  const lista = q.data ? q.data.campanhas : [];
  const valida = escolha === SEM_CAMPANHA || (!!escolha && lista.some((c) => c.id === escolha));
  const efetiva = valida ? escolha : q.data ? q.data.campanhaDoMesId : null;
  const campanha: CampanhaDaMesa | null = efetiva && efetiva !== SEM_CAMPANHA ? lista.find((c) => c.id === efetiva) || null : null;
  const escolher = (id: string) => {
    setEscolhaNaTela(id);
    gravarNaSessao(clientId, "campanha", id);
  };
  return {
    consulta: q,
    campanhas: lista,
    /** O que vai em campanha_id: o id, "nenhuma" (só a marca) ou null (a função usa a do mês). */
    campanhaId: efetiva === SEM_CAMPANHA ? (escolha === SEM_CAMPANHA ? SEM_CAMPANHA : null) : campanha ? campanha.id : null,
    semCampanha: efetiva === SEM_CAMPANHA,
    campanha,
    valor: efetiva || SEM_CAMPANHA,
    escolher,
  };
}

export type CampanhaEscolhida = ReturnType<typeof useCampanhaEscolhida>;

function DetalheDaCampanha({ c }: { c: CampanhaDaMesa }) {
  return (
    <div className="mt-2 min-w-0 space-y-1.5 rounded-lg border border-border bg-background p-2.5" data-campanha-escolhida={c.id}>
      <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">
        {c.nome}
        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{periodoDaCampanha(c)}</span>
      </p>
      {c.objetivo && <p className="text-[11.5px] leading-snug [overflow-wrap:anywhere]">Objetivo: {c.objetivo}</p>}
      {c.tema_visual && <p className="text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">Tema visual: {c.tema_visual}</p>}
      {c.paleta_apoio.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center">
          <span className="mr-1.5 text-[11px] text-muted-foreground">Cores de apoio:</span>
          {c.paleta_apoio.map((p) => (
            <span key={p.hex} className="mb-0.5 mr-1.5 inline-flex items-center text-[11px]" title={p.nome || p.hex}>
              <span className="mr-1 inline-block h-3 w-3 rounded-full border border-border" style={{ backgroundColor: p.hex }} />
              {p.nome || p.hex}
            </span>
          ))}
        </div>
      )}
      {c.pautas_no_mes.length > 0 && (
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">No calendário deste mês</p>
          <ul className="mt-0.5 space-y-0.5">
            {c.pautas_no_mes.slice(0, 4).map((t) => (
              <li key={t} className="truncate text-[11.5px]" title={t}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.motivo && <p className="text-[11px] text-muted-foreground">{c.motivo}</p>}
    </div>
  );
}

/** Escolher a campanha da Mesa (pílulas; a do mês vem marcada). */
export function SeletorDaCampanha({ escolhida, titulo = "Campanha da Mesa" }: { escolhida: CampanhaEscolhida; titulo?: string }) {
  const { clientId } = useMesa();
  const { consulta, campanhas, campanha, valor, escolher } = escolhida;
  const ativas = campanhas.filter((c) => c.status !== "encerrada" || c.id === valor);
  return (
    <Cartao
      titulo={titulo}
      dica="A Mesa é a principal: as fotos nascem dentro da campanha que ela usa. A do mês vem marcada pelo calendário editorial."
    >
      {consulta.isLoading && (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo as campanhas da Mesa...
        </p>
      )}
      {consulta.isError && <p className="text-[12px] text-muted-foreground">Não deu para ler as campanhas agora. O plano segue com a marca e a campanha do mês, se houver.</p>}
      {consulta.isSuccess && ativas.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          Nenhuma campanha na Mesa deste cliente: as fotos seguem a marca.{" "}
          <Link to={`/mesa?client=${clientId}&aba=campanhas`} className="font-medium text-primary hover:underline">
            Criar campanha na Mesa
          </Link>
        </p>
      )}
      {ativas.length > 0 && (
        <>
          <div role="radiogroup" aria-label="Campanha da Mesa" className="flex max-h-32 min-w-0 flex-wrap overflow-y-auto" data-campanhas-da-mesa="">
            {ativas.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={valor === c.id}
                onClick={() => escolher(c.id)}
                title={c.motivo}
                className={`mb-1.5 mr-1.5 inline-flex h-7 max-w-full items-center rounded-full border px-2.5 text-[12px] transition-colors ${
                  valor === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50"
                }`}
                data-campanha-da-mesa-item={c.id}
              >
                <span className="truncate">{c.nome}</span>
                {c.do_mes && (
                  <span className={`ml-1.5 inline-flex shrink-0 items-center rounded-full px-1.5 text-[10px] font-semibold ${valor === c.id ? "bg-primary-foreground/20" : "bg-primary/10 text-primary"}`} data-do-mes="">
                    <CalendarDays className="mr-0.5 h-2.5 w-2.5" /> do mês
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={valor === SEM_CAMPANHA}
              onClick={() => escolher(SEM_CAMPANHA)}
              className={`mb-1.5 mr-1.5 h-7 rounded-full border px-2.5 text-[12px] ${valor === SEM_CAMPANHA ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}
            >
              Sem campanha
            </button>
          </div>
          {campanha ? <DetalheDaCampanha c={campanha} /> : <p className="mt-1 text-[11.5px] text-muted-foreground">Sem campanha: o diretor segue só a marca e o brief do cliente.</p>}
        </>
      )}
    </Cartao>
  );
}
