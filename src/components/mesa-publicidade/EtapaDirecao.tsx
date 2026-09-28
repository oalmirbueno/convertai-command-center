import { useState } from "react";
import { ArrowRight, Check, Compass, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { partesDoPlanejamento } from "@/components/mesa-foto/fotoApi";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campoTexto, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { AvisoDoRascunho, CabecalhoDaEtapa, RotuloLargo, SemCampanha, useMesaPublicidade } from "./Comuns";
import { aprovarTerritorio, lacunasDoBriefing, proporTerritorios, type Territorio } from "./publicidadeApi";

/**
 * Passo 2: o diretor de campanha (IA do motor do painel, com o conhecimento
 * de publicidade e a receita da categoria como dado) propõe três territórios
 * realmente diferentes. A equipe aprova um: só então as tomadas saem.
 */

const HEX = /^#[0-9a-f]{6}$/i;

function CartaoDoTerritorio({ t, podeAprovar, onAprovar, aprovando }: { t: Territorio; podeAprovar: boolean; onAprovar: () => void; aprovando: boolean }) {
  const aprovado = t.status === "aprovado";
  const linha = (rotulo: string, valor: string) =>
    valor ? (
      <div>
        <dt className="inline font-medium text-foreground">{rotulo}: </dt>
        <dd className="inline text-muted-foreground">{valor}</dd>
      </div>
    ) : null;
  return (
    <article
      className={juntar(superficie.painel, "flex min-w-0 flex-col p-4", aprovado && "border-primary ring-1 ring-primary/30")}
      data-territorio={t.id}
      data-aprovado={aprovado ? "" : undefined}
    >
      <div className="flex min-w-0 items-start">
        <h3 className="mr-2 min-w-0 flex-1 text-[14px] font-semibold leading-5 [overflow-wrap:anywhere]">{t.nome}</h3>
        {aprovado ? (
          <span className={juntar(etiqueta, "bg-success/15 text-foreground")}>
            <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Aprovado
          </span>
        ) : (
          <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} disabled={!podeAprovar || aprovando} onClick={onAprovar} aria-label="Aprovar este território">
            {aprovando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            Aprovar
          </button>
        )}
      </div>
      <p className={juntar(texto.corpo, "mt-1.5 leading-relaxed [overflow-wrap:anywhere]")}>{t.conceito}</p>
      <dl className="mt-2 space-y-1 text-[12px] leading-snug [overflow-wrap:anywhere]">
        {linha("Tensão humana", t.tensao_humana)}
        {linha("Promessa", t.promessa)}
        {linha("Razão para acreditar", t.razao_para_acreditar)}
        {linha("Casting", `${[t.casting.perfil, `${t.casting.idade_aprox} anos`, t.casting.estilo, t.casting.figurino].filter(Boolean).join(", ")} (pessoa sintética)`)}
        {linha("Ambiente", t.ambiente)}
        {linha("Luz e tratamento", [t.direcao_de_arte.luz, t.direcao_de_arte.tratamento, t.direcao_de_arte.enquadramentos].filter(Boolean).join("; "))}
        {linha("Por que combina", t.por_que_combina)}
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
            ),
          )}
        </div>
      )}
      {t.riscos.length > 0 && <p className={juntar(texto.auxiliar, "mt-1.5 leading-5 [overflow-wrap:anywhere]")}>Riscos: {t.riscos.join("; ")}</p>}
      <p className="mt-auto pt-2 text-[11px] text-muted-foreground">Briefing versão {t.briefing_versao}</p>
    </article>
  );
}

export default function EtapaDirecao() {
  const { clientId, catalogo } = useMesa();
  const { campanha, banco, aplicar, irPara } = useMesaPublicidade();
  const avisarErro = useAvisarErro();
  const [pedido, setPedido] = useEstadoDaTela<string>(`mesa-publicidade:pedido-ao-diretor:${clientId}:${campanha ? campanha.id || "rascunho" : "nenhuma"}`, "");
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

  const estado = travado
    ? "Tomadas já pedidas com o território aprovado. Outra direção pede campanha nova."
    : lacunas.length
      ? `O briefing tem ${lacunas.length} ${lacunas.length === 1 ? "lacuna" : "lacunas"}. O diretor aponta, não inventa.`
      : `${campanha.territorios.length} ${campanha.territorios.length === 1 ? "território" : "territórios"}`;

  return (
    <div className="min-w-0 space-y-6" data-etapa-publicidade="direcao">
      <CabecalhoDaEtapa
        titulo="Direção"
        ajuda="Três territórios criativos com conceito, direção de arte, casting, ambiente e luz. A equipe aprova um; só então as tomadas saem."
        estado={estado}
        acoes={
          <>
            {!travado && (
              <BotaoComCusto
                rotulo={
                  <>
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                    {campanha.territorios.length ? "Propor 3 novos" : "Propor 3 territórios"}
                  </>
                }
                titulo="Territórios propostos"
                variant={campanha.territorio_id ? "outline" : "default"}
                className="h-9"
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
            )}
            {campanha.territorio_id && (
              <button type="button" className={botao.primario} onClick={() => irPara("tomadas")} aria-label="Seguir para as tomadas">
                <ArrowRight className="h-3.5 w-3.5" />
                <RotuloLargo>Seguir para as tomadas</RotuloLargo>
              </button>
            )}
          </>
        }
      />
      {!banco && <AvisoDoRascunho />}

      {!travado && (
        <CampoDeFormulario rotulo="Pedido ao diretor" ajuda="Opcional. Entra na próxima proposta de territórios." className="max-w-3xl">
          <textarea
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            rows={2}
            maxLength={1500}
            placeholder="Ex.: fugir do clichê de praia; público de 30 a 45 anos"
            className={juntar(campoTexto, "min-h-[64px]")}
          />
        </CampoDeFormulario>
      )}

      {campanha.territorios.length > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-territorios="">
          {campanha.territorios.map((t) => (
            <CartaoDoTerritorio key={t.id} t={t} podeAprovar={!travado} aprovando={aprovando === t.id} onAprovar={() => void aprovar(t)} />
          ))}
        </div>
      ) : (
        <EstadoVazio compacto icone={<Compass className="h-4 w-4" />} titulo="Nenhum território ainda." descricao="Peça ao diretor os três caminhos." />
      )}
    </div>
  );
}
