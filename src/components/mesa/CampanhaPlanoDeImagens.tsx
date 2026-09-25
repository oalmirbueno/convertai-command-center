import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Sparkles } from "lucide-react";
import { BotaoComCusto } from "./Custo";
import { Cronometro } from "./Cronometro";
import { useMesa } from "./MesaContexto";
import { MiniaturaDaImagem, useImagensVistas } from "./CampanhaImagens";
import type { Campanha, ItemProposto, PecaDoPlanoDeImagens } from "./mesaV4Api";
import {
  aplicarRespostaDaCampanha,
  campanhaPlanoImagens,
  marcarPedidoDaCampanha,
  normalizarImagensDaCampanha,
  normalizarPlanoDeImagens,
  partesDoPlanoDeImagens,
  planoDesatualizado,
  rotuloDoPapelDaImagem,
  usePedidoDaCampanha,
} from "./campanhasApi";

/**
 * Plano de imagens da campanha (25/09): o estrategista olha as imagens de
 * verdade junto com o briefing e os conteúdos e diz qual imagem vai em qual
 * lâmina e por quê; onde há mais de uma candidata, o Jev escolhe. Ao gravar
 * na agenda, a imagem escolhida chega ao Estúdio como foto da lâmina.
 */

const dataCurta = (d?: string) => {
  const p = String(d || "").split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : "";
};

function LinhaDaPeca({ peca, item, achar }: { peca: PecaDoPlanoDeImagens; item: ItemProposto | null; achar: ReturnType<typeof useImagensVistas> }) {
  const card = item && item.cards ? item.cards.filter((c) => c.ordem === peca.ordem)[0] : null;
  const vista = achar(peca.imagem_id);
  return (
    <li className="flex min-w-0 rounded-lg border border-border bg-background p-2">
      <div className="mr-2.5 w-16 shrink-0 sm:w-20">
        <MiniaturaDaImagem imagem={peca.imagem_id ? vista : null} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium [overflow-wrap:anywhere]">
          Lâmina {peca.ordem}
          {card && card.funcao ? ` (${card.funcao})` : ""}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {peca.imagem_id ? (vista ? vista.nome : "imagem do acervo") : "sem foto"}
            {peca.imagem_id ? ` · ${peca.uso === "fundo" ? "foto de fundo" : "produto como elemento"}` : ""}
          </span>
        </p>
        {card && card.texto && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">"{card.texto}"</p>}
        {peca.por_que && <p className="mt-1 text-[12px] leading-relaxed [overflow-wrap:anywhere]">{peca.por_que}</p>}
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          {peca.escolha === "jev"
            ? `Escolha do Jev${peca.confianca !== null ? ` (${Math.round(peca.confianca * 100)}%)` : ""} entre ${peca.candidatas.length} candidatas`
            : peca.candidatas.length > 1 && peca.confianca !== null
              ? `Escolha do estrategista, confirmada pelo Jev${peca.confianca !== null ? ` (${Math.round(peca.confianca * 100)}%)` : ""}`
              : "Escolha do estrategista"}
        </p>
        {peca.aviso && (
          <p className="mt-1 flex items-start rounded-md bg-warning/10 px-2 py-1 text-[11.5px]">
            <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-warning" />
            <span className="min-w-0">{peca.aviso}</span>
          </p>
        )}
      </div>
    </li>
  );
}

export default function CampanhaPlanoDeImagens({ campanha, itens }: { campanha: Campanha; itens: ItemProposto[] | null }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const achar = useImagensVistas();
  const plano = normalizarPlanoDeImagens(campanha.plano_imagens);
  const imagens = normalizarImagensDaCampanha(campanha.imagens);
  const chave = `plano:${campanha.id}`;
  const emCurso = usePedidoDaCampanha(chave);
  const lista = itens || [];
  const velho = planoDesatualizado(plano, imagens, itens);
  const ordenados = lista.slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  const semConteudos = !campanha.proposta_id || (itens !== null && lista.length === 0);

  const gerar = async () => {
    marcarPedidoDaCampanha(chave, { mensagem: "plano de imagens", desde: Date.now() });
    try {
      return await campanhaPlanoImagens(campanha.id);
    } finally {
      marcarPedidoDaCampanha(chave, null);
    }
  };

  const botao = (
    <BotaoComCusto
      rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{plano && plano.pecas.length ? "Refazer o plano" : "Montar o plano de imagens"}</>}
      titulo="Plano de imagens"
      descricao="O estrategista olha as imagens, o briefing e os conteúdos e diz qual imagem vai em cada lâmina e por quê; o Jev decide onde há mais de uma candidata."
      partes={() => partesDoPlanoDeImagens(catalogo, imagens.length || 10, lista.length)}
      executar={gerar}
      aoConcluir={(data) => aplicarRespostaDaCampanha(queryClient, clientId, data)}
      variant={plano && plano.pecas.length && !velho ? "outline" : "default"}
      disabled={emCurso !== null || semConteudos}
      className="h-8"
    />
  );

  return (
    <div className="min-w-0 space-y-3">
      {semConteudos && <p className="text-[12.5px] text-muted-foreground">O plano precisa dos conteúdos da campanha. Peça os conteúdos ao agente primeiro.</p>}
      {!semConteudos && !imagens.length && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          A campanha ainda não tem imagens escolhidas: o plano usa as fotos reais mais recentes do acervo. Para mandar no resultado, escolha as imagens na seção acima.
        </p>
      )}
      {velho && (
        <p className="flex items-start rounded-lg bg-warning/10 px-3 py-2 text-[12px]">
          <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0">As imagens ou os conteúdos mudaram depois deste plano. Refaça para a escolha valer para o que está na campanha agora.</span>
        </p>
      )}

      <div className="flex min-w-0 flex-wrap items-center">
        <span className="mb-1 mr-2">{botao}</span>
        {emCurso && (
          <span className="mb-1 min-w-0">
            <Cronometro desde={emCurso.desde} rotulo="Analisando as imagens" previsao="~1min" />
          </span>
        )}
      </div>

      {plano && (
        <div className="min-w-0 space-y-4">
          {plano.resumo && <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere]">{plano.resumo}</p>}
          {plano.fonte === "acervo" && (
            <p className="text-[11.5px] text-muted-foreground">Feito com fotos do acervo: a campanha não tinha imagens escolhidas quando o plano foi montado.</p>
          )}
          {plano.jev_erro && <p className="text-[11.5px] text-muted-foreground">O Jev não respondeu desta vez: ficou a ordem do estrategista.</p>}

          {ordenados.map((it) => {
            const pecas = plano.pecas.filter((p) => p.tema_id === it.tema_id).sort((a, b) => a.ordem - b.ordem);
            if (!pecas.length) return null;
            return (
              <section key={it.tema_id} className="min-w-0">
                <p className="mb-1.5 text-[12px] font-semibold [overflow-wrap:anywhere]">
                  {dataCurta(it.data) ? `${dataCurta(it.data)} · ` : ""}
                  {it.tema || "Peça"}
                  {it.carrossel_infinito ? <span className="font-normal text-muted-foreground"> · carrossel contínuo: a foto fica só como sugestão no roteiro</span> : null}
                </p>
                <ul className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
                  {pecas.map((p) => <LinhaDaPeca key={`${p.tema_id}-${p.ordem}`} peca={p} item={it} achar={achar} />)}
                </ul>
              </section>
            );
          })}
          {plano.pecas.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhuma lâmina com foto real neste plano.</p>}

          {plano.analise.length > 0 && (
            <section className="min-w-0">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">O que cada imagem tem</p>
              <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                {plano.analise.map((a) => {
                  const vista = achar(a.imagem_id);
                  const papel = imagens.filter((i) => i.imagem_id === a.imagem_id)[0];
                  return (
                    <li key={a.imagem_id} className="flex min-w-0 rounded-lg border border-border bg-background p-2">
                      <div className="mr-2.5 w-14 shrink-0">
                        <MiniaturaDaImagem imagem={vista} />
                      </div>
                      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed">
                        <p className="truncate text-[12px] font-medium">
                          {vista ? vista.nome : "Imagem do acervo"}
                          {papel ? <span className="font-normal text-muted-foreground"> · {rotuloDoPapelDaImagem(papel.papel)}</span> : null}
                        </p>
                        {a.o_que_mostra && <p className="[overflow-wrap:anywhere]">{a.o_que_mostra}</p>}
                        {a.forca && <p className="text-muted-foreground [overflow-wrap:anywhere]">Força: {a.forca}</p>}
                        {a.serve_para && <p className="text-muted-foreground [overflow-wrap:anywhere]">Serve para: {a.serve_para}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {plano.lacunas.length > 0 && (
            <section className="min-w-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Imagens que faltam</p>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px]">
                {plano.lacunas.map((l, i) => <li key={`${l}-${i}`} className="[overflow-wrap:anywhere]">{l}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
