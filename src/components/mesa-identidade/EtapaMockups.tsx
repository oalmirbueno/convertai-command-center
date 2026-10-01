import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import { botao, espaco, juntar, texto } from "@/components/sistema/estilos";
import { CabecalhoDaEtapa, useProjetoDaMesa } from "./Comuns";
import EstudioDeMockups from "./EstudioDeMockups";
import PecasDaMarca from "./PecasDaMarca";

/**
 * Etapa Aplicações (IDV2; o valor da etapa segue "mockups"): primeiro as
 * peças da marca por código (redes, papelaria e assinatura de e-mail) e
 * depois o estúdio de mockups da frente MCK, que abre com as cores, as logos
 * e a tipografia DO PROJETO (não as do kit) e lembra onde parou em cada
 * projeto. A logo entra pelo arquivo real, nunca redesenhada pelo gerador.
 */
export default function EtapaMockups() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte, irPara } = useProjetoDaMesa();
  const marcaId = projeto.marca_id || (marca ? marca.id : null);
  const sistema = (projeto.dados.sistema || {}) as Record<string, any>;
  const cores = (Array.isArray(sistema.cores) ? (sistema.cores as Array<{ hex: string; papel: string }>) : [])
    .slice()
    .sort((a, b) => (a.papel === "primaria" ? -1 : b.papel === "primaria" ? 1 : 0))
    .map((c) => String(c.hex || "").toLowerCase());
  const logos = sistema.logos || {};
  const logosDoProjeto = [
    logos.principal && logos.principal.previa_png ? { id: "principal", path: String(logos.principal.previa_png) } : null,
    logos.secundario && logos.secundario.previa_png ? { id: "alternativa", path: String(logos.secundario.previa_png) } : null,
  ].filter((l): l is { id: string; path: string } => !!l);
  const tipos = (Array.isArray(sistema.tipografia) ? sistema.tipografia : []) as Array<{ familia: string; uso: string }>;
  const titulo = (tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || null) as { familia: string } | null;
  const assinatura = String((projeto.dados.naming && (projeto.dados.naming.slogan || projeto.dados.naming.nome)) || "");
  return (
    <div className={espaco.pagina} data-etapa-mockups="">
      <CabecalhoDaEtapa etapa="mockups" ajuda="As aplicações mostram a marca no mundo: peças de redes e papelaria montadas por código e os mockups (fachada, embalagem, telas). Tudo usa a logo real, as cores e a tipografia do Sistema deste projeto." />
      {!logosDoProjeto.length && (
        <p className={juntar(texto.auxiliar, "text-warning")}>
          O Sistema ainda não tem a logo principal.{" "}
          <button type="button" className={juntar(botao.discreto, "h-7 px-2")} onClick={() => irPara("sistema")}>
            Abrir o Sistema
          </button>
        </p>
      )}
      <PecasDaMarca />
      <Secao titulo="Estúdio de mockups" divisoria recolher={`mesa-identidade:${projeto.id}:aplicacoes:mockups`} descricao={`${Array.isArray(projeto.dados.mockups) ? projeto.dados.mockups.length : 0} na apresentação`}>
        <EstudioDeMockups
          clientId={clientId}
          marcaId={marcaId}
          coresDaMarca={cores.length ? cores : null}
          logosDaMarca={logosDoProjeto.length ? logosDoProjeto : null}
          tipografia={titulo && titulo.familia ? { familia: titulo.familia, texto: assinatura } : null}
          chaveDaMemoria={`mesa-identidade:mockups:projeto:${projeto.id}`}
          onEnviados={(itens) => {
            salvarParte("mockups", { itens }).then(
              () => toast.success(itens.length === 1 ? "Mockup na apresentação e no brandbook" : `${itens.length} mockups na apresentação e no brandbook`),
              (e) => toast.error(`Os mockups foram para Arquivos, mas não entraram na apresentação: ${e instanceof Error ? e.message : String(e)}`),
            );
          }}
        />
      </Secao>
    </div>
  );
}
