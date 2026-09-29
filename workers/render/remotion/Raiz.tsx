import { Composition } from "remotion";
import { ComposicaoDoProjeto, quadrosDoProjeto, type PropsDaComposicao } from "../../../src/components/mesa-edicao/editor/Composicao";

/**
 * Raiz do render (frente EDT): uma composição só, "ComposicaoDoProjeto", com o
 * tamanho, o fps e a duração tirados do projeto que vem nos props (o mesmo
 * projeto que a pessoa viu na prévia do editor).
 */
const VAZIO = { projeto: { fps: 25, largura: 1080, altura: 1920, duracao_s: 1, trilhas: [], fontes: {} }, urls: {} } as unknown as PropsDaComposicao;

export function Raiz() {
  return (
    <Composition
      id="ComposicaoDoProjeto"
      component={ComposicaoDoProjeto}
      durationInFrames={25}
      fps={25}
      width={1080}
      height={1920}
      defaultProps={VAZIO}
      calculateMetadata={({ props }) => {
        const p = (props as PropsDaComposicao).projeto;
        return { fps: p.fps, width: p.largura, height: p.altura, durationInFrames: quadrosDoProjeto(p) };
      }}
    />
  );
}
