import { duracaoDoClipe, MODOS_DE_COMPARAR, ROTULO_DO_MODO_DE_COMPARAR, type ModoDeComparar } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { acharClipe } from "../operacoes";
import { arred } from "../tempo";
import { Montador, parametrosComPadrao, type Skill } from "./tipos";

/**
 * Montar antes e depois: dois clipes (ou duas imagens) viram UM clipe que
 * mostra os dois. O primeiro na linha do tempo é o "antes"; o segundo, o
 * "depois". Modos: cortina (a divisa atravessa a tela), lado a lado,
 * um em cima do outro, divisão fixa com rótulos e alternar. O clipe do depois
 * sai da trilha e o resto encosta. Se o depois for mais curto, o antes é
 * aparado para os dois acabarem juntos (imagem não tem limite).
 */

export const SKILL_ANTES_DEPOIS: Skill = {
  id: "antes_depois",
  rotulo: "Montar antes e depois",
  descricao: "Selecione dois clipes: o primeiro vira o antes, o segundo o depois.",
  referencia: "comparador antes e depois (CapCut) / hyperframes-animation (wipe)",
  precisaDeFala: false,
  parametros: [
    { chave: "modo", rotulo: "Modo", tipo: "escolha", padrao: "cortina", opcoes: MODOS_DE_COMPARAR.map((m) => ({ valor: m, rotulo: ROTULO_DO_MODO_DE_COMPARAR[m] })) },
    { chave: "rotulos", rotulo: "Rótulos Antes e Depois", tipo: "sim_nao", padrao: true },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_ANTES_DEPOIS, dados);
    const m = new Montador(p);
    const escolhidos = (ctx.selecionados || [])
      .map((id) => acharClipe(p, id))
      .filter((x): x is NonNullable<ReturnType<typeof acharClipe>> => !!x && !!x.clipe.fonte && (x.trilha.tipo === "video" || x.trilha.tipo === "sobreposicao"))
      .sort((a, b) => a.clipe.inicio_s - b.clipe.inicio_s);
    if (escolhidos.length < 2) return m.proposta("antes_depois", "Antes e depois", "Selecione dois clipes de vídeo ou imagem (Ctrl + clique).");
    if (escolhidos.length > 2) m.avisar("Mais de dois selecionados: valem os dois primeiros.");
    const a = escolhidos[0].clipe;
    const b = escolhidos[1].clipe;
    const fb = p.fontes[String(b.fonte)];
    const modo = String(params.modo) as ModoDeComparar;
    m.aplicar({
      op: "propriedades",
      clipe: a.id,
      campos: {
        comparar: { fonte_b: String(b.fonte), entrada_b_s: b.entrada_s, modo, rotulos: !!params.rotulos, rotulo_a: "Antes", rotulo_b: "Depois" },
        origem: { tipo: "skill", ref: "antes_depois" },
      },
    });
    const da = duracaoDoClipe(a);
    const db = duracaoDoClipe(b);
    if (fb && fb.midia !== "imagem" && db < da - 0.001) {
      m.aplicar({ op: "aparar", clipe: a.id, lado: "fim", tempo_s: arred(a.inicio_s + db) });
      m.avisar("O depois é mais curto: o antes foi aparado para acabarem juntos.");
    }
    m.aplicar({ op: "remover", clipe: b.id });
    if (escolhidos[0].trilha.id === escolhidos[1].trilha.id) m.aplicar({ op: "ondular", trilha: escolhidos[0].trilha.id });
    m.aplicar({ op: "registrar_skill", skill: "antes_depois", resumo: ROTULO_DO_MODO_DE_COMPARAR[modo], em: ctx.agora });
    return m.proposta("antes_depois", "Antes e depois", `${ROTULO_DO_MODO_DE_COMPARAR[modo]}: um clipe com os dois.`);
  },
};
