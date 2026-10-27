import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  LockKeyhole,
  Play,
  Sparkles,
  Video,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CAPAS_MEMBROS,
  capaDoProduto,
  capaPadraoDoProduto,
  produtoDeBoasVindas,
  produtosDaVitrine,
} from "@/lib/membros/capas";
import { podeAbrir, rotuloDoAcesso, type Produto } from "@/lib/membros/modelo";
import "./vitrine-membros.css";

export type AcessoDaVitrine = {
  rotulo: string;
  ferramenta: boolean;
  liberado: boolean;
  conferindo?: boolean;
};

const etapasBoasVindas = [
  {
    titulo: "Encontre seu próximo passo",
    texto:
      "Na vitrine, você conhece os produtos e ferramentas da Aceleriq. O cadeado indica que aquele acesso ainda não está liberado para sua conta.",
  },
  {
    titulo: "Abra o que já é seu",
    texto:
      "Os produtos liberados continuam disponíveis na biblioteca. Ferramentas como o CRM têm licença própria; você vê a validade ao abrir a ferramenta.",
  },
  {
    titulo: "Prepare sua primeira campanha",
    texto:
      "No Aceleriq de Bolso, comece pela sua marca. Depois informe o que vende, para quem, a oferta e a ação que espera do cliente. Escolha o texto antes de gerar a arte.",
  },
  {
    titulo: "Revise antes de publicar",
    texto:
      "Confira o texto, o preço e as condições. Baixe a peça aprovada por você e publique onde preferir. Seu saldo e o custo de cada geração aparecem no estúdio.",
  },
];

export default function VitrineDoMembro({
  produtos,
  abrir,
  acesso = (produto) => ({
    rotulo: rotuloDoAcesso(produto),
    ferramenta: false,
    liberado: podeAbrir(produto),
  }),
  abrirEstudio,
  acessoEstudio,
}: {
  produtos: Produto[];
  abrir: (produto: Produto) => void;
  acesso?: (produto: Produto) => AcessoDaVitrine;
  abrirEstudio?: () => void;
  acessoEstudio?: { liberado: boolean; conferindo?: boolean };
}) {
  const [guia, setGuia] = useState(false);
  const boasVindas = produtos.find(
    (produto) => produto.estado === "publicado" && produtoDeBoasVindas(produto),
  );
  const vitrine = produtosDaVitrine(produtos);

  return (
    <section
      className="membros-vitrine"
      aria-labelledby="membros-vitrine-titulo"
    >
      <div className="membros-vitrine-cabecalho">
        <h2 id="membros-vitrine-titulo">Explore a Aceleriq</h2>
        <button
          type="button"
          className="membros-vitrine-boas-vindas"
          onClick={() =>
            boasVindas && acesso(boasVindas).liberado
              ? abrir(boasVindas)
              : setGuia(true)
          }
        >
          <BookOpen size={18} aria-hidden="true" />
          Boas-vindas <span>Comece aqui</span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="membros-vitrine-grade">
        {abrirEstudio && (
          <button
            type="button"
            className="membros-vitrine-cartao membros-vitrine-bolso"
            onClick={abrirEstudio}
            disabled={acessoEstudio?.conferindo}
            aria-label={
              acessoEstudio?.liberado
                ? "Abrir Aceleriq de Bolso"
                : "Conhecer Aceleriq de Bolso"
            }
          >
            <img
              src={CAPAS_MEMBROS.estudio}
              alt=""
              className="membros-vitrine-imagem"
              loading="lazy"
              decoding="async"
            />
            <span className="membros-vitrine-selo">
              {acessoEstudio?.liberado ? (
                <>
                  <Check size={13} aria-hidden="true" /> Liberado
                </>
              ) : (
                <>
                  <LockKeyhole size={13} aria-hidden="true" /> Estúdio de
                  campanhas
                </>
              )}
            </span>
            <div className="membros-vitrine-identidade">
              <span>ESTRATÉGIA + CRIATIVIDADE</span>
              <h3>
                Aceleriq
                <br />
                de Bolso
              </h3>
              <p>Sua oferta. Sua mensagem. Sua arte.</p>
              <span className="membros-vitrine-acao">
                {acessoEstudio?.conferindo
                  ? "Conferindo acesso…"
                  : acessoEstudio?.liberado
                    ? "Abrir estúdio"
                    : "Conhecer o estúdio"}
                <ArrowUpRight size={19} aria-hidden="true" />
              </span>
            </div>
          </button>
        )}
        {vitrine.map((produto) => {
          const direito = acesso(produto);
          return (
            <button
              type="button"
              className="membros-vitrine-cartao"
              key={produto.id}
              onClick={() => abrir(produto)}
              disabled={direito.conferindo}
              aria-label={`${direito.liberado ? "Abrir" : "Conhecer"} ${produto.titulo}`}
            >
              <img
                src={capaDoProduto(produto)}
                alt=""
                className="membros-vitrine-imagem"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(evento) => {
                  const img = evento.currentTarget;
                  if (img.dataset.fallback) {
                    img.hidden = true;
                    return;
                  }
                  img.dataset.fallback = "true";
                  img.src = capaPadraoDoProduto(produto);
                }}
              />
              <span className="membros-vitrine-selo">
                {direito.liberado ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <LockKeyhole size={13} aria-hidden="true" />
                )}
                {direito.conferindo
                  ? "Conferindo…"
                  : direito.liberado
                    ? "Liberado"
                    : "Bloqueado"}
              </span>
              <div className="membros-vitrine-identidade">
                <span>{produto.categoria || produto.formato}</span>
                <h3>{produto.titulo}</h3>
                <span className="membros-vitrine-acao">
                  {direito.liberado
                    ? direito.ferramenta
                      ? "Abrir ferramenta"
                      : "Acessar conteúdo"
                    : "Ver detalhes"}
                  <ArrowUpRight size={19} aria-hidden="true" />
                </span>
              </div>
            </button>
          );
        })}
        <article
          className="membros-vitrine-cartao membros-vitrine-em-breve"
          aria-label="Estúdio UGC, em breve"
        >
          <img
            src={CAPAS_MEMBROS.ugc}
            alt=""
            className="membros-vitrine-imagem"
            loading="lazy"
            decoding="async"
          />
          <span className="membros-vitrine-selo">
            <Video size={13} aria-hidden="true" /> Em breve
          </span>
          <div className="membros-vitrine-identidade">
            <span>CRIAÇÃO EM VÍDEO</span>
            <h3>
              Estúdio
              <br />
              UGC
            </h3>
            <span className="membros-vitrine-acao">
              Em preparação
              <Sparkles size={18} aria-hidden="true" />
            </span>
          </div>
        </article>
      </div>
      <Dialog open={guia} onOpenChange={setGuia}>
        <DialogContent className="membros-guia-inicial">
          <div className="membros-guia-capa">
            <img src={CAPAS_MEMBROS.estudio} alt="" />
            <span>
              <BookOpen size={20} aria-hidden="true" /> Comece aqui
            </span>
            <DialogTitle>Boas-vindas à Aceleriq</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Um guia rápido para usar sua biblioteca e as ferramentas.
          </DialogDescription>
          <ol className="membros-guia-passos">
            {etapasBoasVindas.map((etapa, indice) => (
              <li key={etapa.titulo}>
                <span>{String(indice + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{etapa.titulo}</h3>
                  <p>{etapa.texto}</p>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="membros-acao membros-guia-concluir"
            onClick={() => setGuia(false)}
          >
            Explorar minha biblioteca
            <Play size={16} aria-hidden="true" />
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
