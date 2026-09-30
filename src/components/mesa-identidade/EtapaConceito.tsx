import { useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA } from "@/components/sistema";
import { avisarFimDaAcao, BotaoComCusto, situacaoDaResposta, useAvisarErro } from "@/components/mesa/Custo";
import { usd } from "@/lib/mesa/api";
import Painel from "@/components/sistema/Painel";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, espaco, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoSobre } from "../../../supabase/functions/_shared/cores-da-marca";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, contextoParaPreencher, ImagemInteira, Pastilha, partesDaImagem, partesDoCusto, RotuloComModelo, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";

type Caminho = {
  id: string;
  nome: string;
  ideia: string;
  palavras: string[];
  arquetipo: string;
  paleta: Array<{ nome: string; hex: string; papel: string }>;
  tipografia: { titulo: string; texto: string };
  grafismos: string;
  tom: string[];
  referencias_visuais: string[];
  riscos: string;
  imagem?: string | null;
};

/**
 * Etapa 5, Conceito: 2 ou 3 caminhos criativos em pranchas. A IA propõe
 * (custo antes); a recomendação vem do conselho de agentes quando ele existir
 * e, hoje, do Jev, sempre como aviso: a equipe escolhe. A imagem de cada
 * caminho é inspiração, nunca a logo (logo pelo código).
 *
 * UXS 30/09: "Gerar de novo" diz quantos caminhos substitui e o aviso do fim
 * traz Desfazer por 10 s (volta caminhos, escolhido, recomendação e imagens
 * de antes, pela mesma gravação da mesa; o gasto não volta).
 */
export default function EtapaConceito() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, guardar, salvarParte } = useProjetoDaMesa();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const avisarErro = useAvisarErro();
  const conceito = (projeto.dados.conceito || {}) as { caminhos?: Caminho[]; escolhido?: string | null; recomendacao?: { id: string; confianca: number | null; fonte: string } | null };
  const caminhos = Array.isArray(conceito.caminhos) ? conceito.caminhos : [];
  const [quantos, setQuantos] = useState<2 | 3>(3);
  const [pedido, setPedido] = useState("");
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  /** O conceito de antes de "Gerar de novo" (para o Desfazer do aviso). */
  const antesDeGerar = useRef<Record<string, unknown> | null>(null);

  const escolher = async (id: string) => {
    setEscolhendo(id);
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("conceito_escolher", { projeto_id: projeto.id, caminho_id: id });
      guardar(r.projeto);
      toast.success("Caminho escolhido");
    } catch (e) {
      avisarErro(e, "O caminho não foi escolhido");
    } finally {
      setEscolhendo(null);
    }
  };

  const rec = conceito.recomendacao || null;

  return (
    <div className={espaco.pagina} data-etapa-conceito="">
      <CabecalhoDaEtapa
        etapa="conceito"
        ajuda="Os caminhos saem do briefing e da pesquisa, bem diferentes entre si. A recomendação é só um aviso (hoje do Jev; do conselho de agentes quando ele entrar): quem escolhe é a equipe. Gerar de novo substitui os caminhos; o aviso traz Desfazer por alguns segundos."
        acoes={<SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} className="max-w-[180px]" />}
      />
      <Secao titulo="Gerar caminhos" recolher={`mesa-identidade:${projeto.id}:conceito:gerar`} recolhidaDeInicio={caminhos.length > 0} data-bloco-da-etapa="gerar">
        <div className="grid min-w-0 grid-cols-1 items-end gap-4 md:grid-cols-[minmax(0,1fr)_120px_auto]">
          <CampoDeFormulario
            rotulo={
              <span className="flex min-w-0 items-center">
                <span className="mr-1 truncate">Pedido da equipe</span>
                <PreencherComIA
                  papel="identidade"
                  clientId={mesa.clientId}
                  marcaId={projeto.marca_id || (marca && !marca.principal ? marca.id : null)}
                  compacto
                  rotulo="Preencher o pedido com IA"
                  campos={[{ chave: "pedido", rotulo: "Pedido para os caminhos", tipo: "texto_longo", valorAtual: pedido, dica: "Direção curta para os caminhos criativos, a partir da estratégia e do moodboard (ex.: um sóbrio, um ousado).", maximo: 600 }]}
                  contexto={contextoParaPreencher(projeto)}
                  onAplicar={(v) => setPedido(String(v.pedido || ""))}
                  onDesfazer={(a) => setPedido(String(a.pedido || ""))}
                />
              </span>
            }
            apoio="Opcional"
          >
            <textarea className={juntar(campoTexto, "min-h-[60px]")} value={pedido} maxLength={1500} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: um caminho mais sóbrio, outro mais ousado" />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Caminhos">
            <select className={campo} value={quantos} onChange={(e) => setQuantos(e.target.value === "2" ? 2 : 3)}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </CampoDeFormulario>
          <BotaoComCusto
            rotulo={<RotuloComModelo rotulo={caminhos.length ? `Gerar de novo (substitui os ${caminhos.length})` : "Gerar caminhos"} papel="identidade" modeloId={modeloId} />}
            titulo="Caminhos criativos"
            partes={() => partesDoCusto(mesa.catalogo, "conceito", modeloId)}
            executar={() => {
              antesDeGerar.current = caminhos.length ? JSON.parse(JSON.stringify(projeto.dados.conceito || {})) : null;
              return chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("conceito_gerar", { projeto_id: projeto.id, quantidade: quantos, pedido: pedido.trim() || undefined, modelo_id: modeloId || undefined });
            }}
            // Um aviso só: o do fim da ação, com o custo real e (quando substituiu) o Desfazer.
            fecharAoConfirmar
            aoConcluir={(d, custo) => {
              guardar(d && d.projeto);
              const antes = antesDeGerar.current;
              antesDeGerar.current = null;
              if (!antes || situacaoDaResposta(d)) {
                avisarFimDaAcao("Caminhos criativos", d, custo);
                return;
              }
              toast.success("Caminhos criativos", {
                description: `${custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.`} O Desfazer volta os caminhos de antes; o gasto não volta.`,
                duration: 10_000,
                action: {
                  label: "Desfazer",
                  onClick: () => {
                    // salvarParte grava sobre a versão de agora (a da resposta, lida do cache na hora).
                    salvarParte("conceito", antes, { substituir: true })
                      .then(() => toast.success("Caminhos de antes de volta"))
                      .catch((e) => avisarErro(e, "Não foi possível desfazer"));
                  },
                },
              });
            }}
          />
        </div>
      </Secao>

      {caminhos.length > 0 && (
        <div className={juntar(espaco.grade, "grid-cols-1 xl:grid-cols-3")} data-caminhos="" data-bloco-da-etapa="caminhos">
          {caminhos.map((c) => {
            const escolhido = conceito.escolhido === c.id;
            const recomendado = !!rec && rec.id === c.id;
            return (
              <Painel
                key={c.id}
                recolher={false}
                className={juntar("min-w-0", escolhido && "border-primary")}
                data-caminho={c.id}
                titulo={c.nome}
                acao={
                  <button type="button" className={juntar(escolhido ? botao.primario : botao.secundario, "h-8")} onClick={() => void escolher(c.id)} disabled={!!escolhendo || escolhido}>
                    {escolhendo === c.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                    {escolhido ? "Escolhido" : "Escolher"}
                  </button>
                }
              >
                <div className="space-y-3">
                  {recomendado && (
                    <Pastilha tom="bom">
                      <Sparkles className="mr-1 h-3 w-3" /> Recomendado {rec!.fonte === "conselho" ? "pelo conselho" : "pelo Jev"}
                      {typeof rec!.confianca === "number" ? ` (${Math.round(rec!.confianca * 100)}%)` : ""}
                    </Pastilha>
                  )}
                  <div className="h-40 min-w-0">
                    {c.imagem ? (
                      <ImagemInteira caminho={c.imagem} alt={`Inspiração do caminho ${c.nome}`} className="h-full w-full bg-muted" />
                    ) : (
                      <div className="flex h-full min-w-0 overflow-hidden rounded-md">
                        {c.paleta.map((p) => (
                          <div key={p.hex} className="flex min-w-0 flex-1 items-end p-2" style={{ background: p.hex, color: textoSobre(p.hex) }}>
                            <span className={juntar(texto.etiqueta, "truncate")}>{p.hex}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className={texto.corpo}>{c.ideia}</p>
                  <div className="-m-0.5 flex min-w-0 flex-wrap">
                    {c.palavras.map((p) => (
                      <span key={p} className={juntar(etiqueta, "m-0.5 bg-muted text-muted-foreground")}>
                        {p}
                      </span>
                    ))}
                  </div>
                  <dl className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    <dt className={texto.rotulo}>Arquétipo</dt>
                    <dd className={texto.corpo}>{c.arquetipo || "a definir"}</dd>
                    <dt className={texto.rotulo}>Tipografia</dt>
                    <dd className={texto.corpo}>
                      {c.tipografia.titulo || "?"} / {c.tipografia.texto || "?"}
                    </dd>
                    <dt className={texto.rotulo}>Grafismos</dt>
                    <dd className={texto.corpo}>{c.grafismos}</dd>
                    <dt className={texto.rotulo}>Tom</dt>
                    <dd className={texto.corpo}>{c.tom.join(", ")}</dd>
                    <dt className={texto.rotulo}>Riscos</dt>
                    <dd className={juntar(texto.corpo, "text-muted-foreground")}>{c.riscos}</dd>
                  </dl>
                  <div className="flex justify-end">
                    <BotaoComCusto
                      rotulo={c.imagem ? "Outra inspiração" : "Imagem de inspiração"}
                      titulo="Imagem de inspiração"
                      descricao="Prancha de clima, sem texto e sem logo"
                      partes={() => partesDaImagem(mesa.catalogo)}
                      executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("conceito_imagem", { projeto_id: projeto.id, caminho_id: c.id })}
                      aoConcluir={(d) => guardar(d && d.projeto)}
                      variant="ghost"
                    />
                  </div>
                </div>
              </Painel>
            );
          })}
        </div>
      )}
    </div>
  );
}
