import { useState } from "react";
import { Check, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { partesDoPlanejamento } from "@/components/mesa-foto/fotoApi";
import { AvisoDoRascunho, CabecalhoDaEtapa, SemCampanha, useMesaPublicidade } from "./Comuns";
import { aprovarTerritorio, lacunasDoBriefing, proporTerritorios, type Territorio } from "./publicidadeApi";

/**
 * Passo 2: o diretor de campanha (IA do motor do painel, com o conhecimento
 * de publicidade e a receita da categoria como dado) propõe três territórios
 * realmente diferentes. A equipe aprova um: só então as tomadas saem.
 */

const HEX = /^#[0-9a-f]{6}$/i;

function CartaoDoTerritorio({ t, podeAprovar, onAprovar, aprovando }: { t: Territorio; podeAprovar: boolean; onAprovar: () => void; aprovando: boolean }) {
  const aprovado = t.status === "aprovado";
  return (
    <article className={`flex min-w-0 flex-col rounded-xl border bg-card p-3.5 ${aprovado ? "border-primary ring-1 ring-primary/30" : "border-border"}`} data-territorio={t.id} data-aprovado={aprovado ? "" : undefined}>
      <div className="flex min-w-0 items-start">
        <h3 className="mr-2 min-w-0 flex-1 text-[14px] font-semibold leading-tight [overflow-wrap:anywhere]">{t.nome}</h3>
        {aprovado && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-2 py-0.5 text-[10.5px] font-medium">
            <Check className="mr-1 h-3 w-3" /> Aprovado
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{t.conceito}</p>
      <dl className="mt-2 space-y-1 text-[11.5px] leading-snug">
        {t.tensao_humana && (
          <div>
            <dt className="inline font-medium">Tensão humana: </dt>
            <dd className="inline text-muted-foreground">{t.tensao_humana}</dd>
          </div>
        )}
        {t.promessa && (
          <div>
            <dt className="inline font-medium">Promessa: </dt>
            <dd className="inline text-muted-foreground">{t.promessa}</dd>
          </div>
        )}
        {t.razao_para_acreditar && (
          <div>
            <dt className="inline font-medium">Razão para acreditar: </dt>
            <dd className="inline text-muted-foreground">{t.razao_para_acreditar}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium">Casting: </dt>
          <dd className="inline text-muted-foreground">
            {[t.casting.perfil, `${t.casting.idade_aprox} anos`, t.casting.estilo, t.casting.figurino].filter(Boolean).join(", ")} (pessoa sintética)
          </dd>
        </div>
        {t.ambiente && (
          <div>
            <dt className="inline font-medium">Ambiente: </dt>
            <dd className="inline text-muted-foreground">{t.ambiente}</dd>
          </div>
        )}
        {(t.direcao_de_arte.luz || t.direcao_de_arte.tratamento) && (
          <div>
            <dt className="inline font-medium">Luz e tratamento: </dt>
            <dd className="inline text-muted-foreground">{[t.direcao_de_arte.luz, t.direcao_de_arte.tratamento, t.direcao_de_arte.enquadramentos].filter(Boolean).join("; ")}</dd>
          </div>
        )}
        {t.por_que_combina && (
          <div>
            <dt className="inline font-medium">Por que combina: </dt>
            <dd className="inline text-muted-foreground">{t.por_que_combina}</dd>
          </div>
        )}
      </dl>
      {t.direcao_de_arte.paleta.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center" aria-label="Paleta">
          {t.direcao_de_arte.paleta.map((c) =>
            HEX.test(c) ? (
              <span key={c} title={c} className="mb-1 mr-1 inline-block h-5 w-5 rounded-full border border-border" style={{ backgroundColor: c }} />
            ) : (
              <span key={c} className="mb-1 mr-1 rounded-full bg-muted px-1.5 py-px text-[10.5px]">
                {c}
              </span>
            )
          )}
        </div>
      )}
      {t.riscos.length > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">Riscos: {t.riscos.join("; ")}</p>}
      <p className="mt-1 text-[10.5px] text-muted-foreground">Feito com o briefing versão {t.briefing_versao}.</p>
      <div className="mt-auto pt-2.5">
        {!aprovado && (
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={!podeAprovar || aprovando} onClick={onAprovar}>
            {aprovando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            Aprovar este território
          </Button>
        )}
      </div>
    </article>
  );
}

export default function EtapaDirecao() {
  const { catalogo } = useMesa();
  const { campanha, banco, aplicar, irPara } = useMesaPublicidade();
  const avisarErro = useAvisarErro();
  const [pedido, setPedido] = useState("");
  const [aprovando, setAprovando] = useState<string | null>(null);
  if (!campanha) return <SemCampanha etapa="a direção" />;
  const travado = !!campanha.ensaio_id;
  const lacunas = lacunasDoBriefing(campanha.briefing);

  const aprovar = async (t: Territorio) => {
    if (aprovando) return;
    setAprovando(t.id);
    try {
      const r = await aprovarTerritorio(campanha, t.id);
      aplicar(r.campanha);
      toast.success(`Território aprovado: ${t.nome}`, { description: "O plano de seis tomadas já está pronto para ajustar." });
    } catch (e) {
      avisarErro(e, "Território não aprovado");
    } finally {
      setAprovando(null);
    }
  };

  return (
    <div className="space-y-4" data-etapa-publicidade="direcao">
      <CabecalhoDaEtapa
        titulo="Direção"
        descricao="Três territórios criativos com conceito, direção de arte, casting, ambiente e luz. A equipe aprova um."
        acoes={
          campanha.territorio_id ? (
            <Button type="button" size="sm" className="h-8" onClick={() => irPara("tomadas")}>
              Seguir para as tomadas
            </Button>
          ) : null
        }
      />
      {!banco && <AvisoDoRascunho />}
      {lacunas.length > 0 && <p className="text-[12px] text-muted-foreground">O briefing tem {lacunas.length} {lacunas.length === 1 ? "lacuna" : "lacunas"}. O diretor não inventa o que falta: ele aponta.</p>}

      {!travado && (
        <section className="rounded-xl border border-border bg-card p-3.5">
          <label className="block">
            <span className="text-[12px] font-medium">Pedido ao diretor (opcional)</span>
            <Textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={2} maxLength={1500} placeholder="Ex.: fugir do clichê de praia; público de 30 a 45 anos" className="mt-1 text-[12.5px]" />
          </label>
          <div className="mt-2">
            <BotaoComCusto
              rotulo={
                <>
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  {campanha.territorios.length ? "Propor 3 territórios novos" : "Propor 3 territórios"}
                </>
              }
              titulo="Territórios propostos"
              partes={() => partesDoPlanejamento(catalogo)}
              disabled={!campanha.kit_id}
              executar={async () => {
                const r = await proporTerritorios(campanha, pedido);
                aplicar(r.campanha);
                const avisos: string[] = (r.bruto && Array.isArray(r.bruto.avisos) ? r.bruto.avisos : []).concat(r.bruto && Array.isArray(r.bruto.lacunas) ? r.bruto.lacunas : []);
                if (avisos.length) toast.message("Do diretor", { description: avisos.slice(0, 3).join(" ") });
                return r.bruto;
              }}
            />
          </div>
        </section>
      )}
      {travado && <p className="text-[12px] text-muted-foreground">As tomadas já foram pedidas à Mesa Foto com o território aprovado. Para outra direção, abra uma campanha nova.</p>}

      {campanha.territorios.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-territorios="">
          {campanha.territorios.map((t) => (
            <CartaoDoTerritorio key={t.id} t={t} podeAprovar={!travado} aprovando={aprovando === t.id} onAprovar={() => void aprovar(t)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">Nenhum território ainda. Peça ao diretor os três caminhos.</div>
      )}
    </div>
  );
}
