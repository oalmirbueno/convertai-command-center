import { chaveDaFonte, clipeNovo, normalizarProjeto, type ClipeDoProjeto, type FonteDoProjeto, type ProjetoDeEdicao } from "../../../../../supabase/functions/_shared/projeto-de-edicao";
import { lerCamada, type CamadaDoQuadro, type QuadroAnimado } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Do Quadro animado para a Mesa Edição e o render (frente CNV, 30/09).
 *
 * O Quadro vira um projeto de edição com UMA trilha de sobreposição ("Quadro
 * do Canvas"): o fundo e cada camada visível são clipes dela, na ordem da
 * pilha (o de cima por último), com a camada inteira em `estilo.camada`. A
 * composição do render desenha pela mesma conta do palco
 * (CamadaNaComposicao). Toda mídia é fonte do projeto: o worker baixa só o
 * que um clipe usa, e só da pasta do cliente.
 *
 * Puro (sem "@/" e sem rede): a tela, os testes e o roteiro de prova do render usam.
 */

export const FPS_DO_QUADRO = 30;

export function quadroParaProjeto(q: QuadroAnimado, titulo: string): ProjetoDeEdicao {
  const fontes: Record<string, FonteDoProjeto> = {};
  const clipes: ClipeDoProjeto[] = [];
  const estilo = (c: CamadaDoQuadro) => ({ camada: c, quadro_duracao_s: q.duracao_s });
  const fundo = lerCamada({ id: "fundo", tipo: "forma", nome: "Fundo", forma: "retangulo", cor: q.fundo, x: 0, y: 0, l: 1, a: 1, inicio_s: 0, fim_s: q.duracao_s }, q.duracao_s) as CamadaDoQuadro;
  clipes.push(clipeNovo({ id: "q-fundo", inicio_s: 0, entrada_s: 0, saida_s: q.duracao_s, estilo: estilo(fundo), origem: { tipo: "manual", ref: "canvas:quadro" } }));
  q.camadas.forEach((c, i) => {
    if (!c.visivel) return;
    let fonte: string | null = null;
    if (c.midia) {
      let chave = chaveDaFonte(`q${i + 1}-${c.midia.nome}`);
      let n = 2;
      while (fontes[chave] && fontes[chave].storage_path !== c.midia.caminho) chave = chaveDaFonte(`q${i + 1}-${n++}-${c.midia.nome}`);
      fontes[chave] = {
        chave,
        arquivo_id: c.midia.arquivo_id,
        nome: c.midia.nome,
        tipo: c.tipo === "video" ? "gerado" : "imagem",
        storage_bucket: c.midia.bucket,
        storage_path: c.midia.caminho,
        duracao_s: null,
        largura: null,
        altura: null,
        midia: c.tipo === "video" ? "video" : "imagem",
      };
      fonte = chave;
    }
    const dur = Math.max(0.1, c.fim_s - c.inicio_s);
    clipes.push(clipeNovo({ id: `q-${c.id}`.slice(0, 40), fonte, inicio_s: c.inicio_s, entrada_s: 0, saida_s: Math.round(dur * 1000) / 1000, texto: c.tipo === "texto" ? c.texto.slice(0, 500) : null, estilo: estilo(c), nota: c.nome, origem: { tipo: "manual", ref: "canvas:quadro" } }));
  });
  const p = normalizarProjeto({
    titulo: titulo.slice(0, 120) || "Quadro do Canvas",
    formato: q.formato,
    fps: FPS_DO_QUADRO,
    fps_informado: true,
    direcao: "Quadro animado montado no Canvas da Mesa Foto. Edite as camadas no Canvas; aqui dá para somar trilha, legenda e outros clipes.",
    fontes,
    trilhas: [{ id: "quadro-1", tipo: "sobreposicao", nome: "Quadro do Canvas", clipes }],
  });
  if (!p) throw new Error("O quadro não virou projeto de edição.");
  return p;
}

