import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Crop, Images, Maximize2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto } from "./AcoesDeUso";
import AreasNaFoto from "./AreasNaFoto";
import { Cartao, MiniaturaDaFoto, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import SeletorDeFotos from "./SeletorDeFotos";
import SeletorDeGuia from "./SeletorDeGuia";
import { BotaoTirarFundo } from "./EtapaAcervo";
import {
  acrescentarFotos,
  classeDaFoto,
  invalidarFotos,
  MODOS_DE_PREPARO,
  partesDoPreparo,
  podeTirarFundo,
  prepararFoto,
  useFotos,
  type Area,
  type FotoDoAcervo,
  type Guia,
  type ModoDePreparo,
} from "./fotoApi";

/**
 * Etapa 3, Preparar: uma foto do acervo vira uma derivada tratada, com o
 * original intacto. Os modos dizem o que muda e o que fica. As áreas
 * protegidas são desenhadas na própria foto e voltam com os pixels originais
 * depois da geração (máscara no servidor). Antes e depois lado a lado. A
 * derivada nasce sem aprovação: "Aprovar esta foto" (acervo_decidir) libera o
 * envio para a aprovação do cliente.
 */

type Vista = "lado" | "antes" | "depois";

/** Estilo do desfoque enquanto prepara (filter existe no Safari 11 e no Chrome 64). */
const VELADO = { filter: "blur(12px)", WebkitFilter: "blur(12px)" };

export default function EtapaPreparar() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { imagemId, irPara } = useMesaFoto();
  const fotos = useFotos(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const [fotoId, setFotoId] = useState<string | null>(imagemId);
  const [escolhendo, setEscolhendo] = useState(false);
  const [modo, setModo] = useState<ModoDePreparo>("limpar");
  const [areas, setAreas] = useState<Area[]>([]);
  const [marcando, setMarcando] = useState(false);
  const [cenario, setCenario] = useState("");
  const [instrucao, setInstrucao] = useState("");
  const [guia, setGuia] = useState<Guia>({ modo: "nenhum" });
  const [vista, setVista] = useState<Vista>("lado");
  const [depoisId, setDepoisId] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const padrao = padraoPara(catalogo, "imagem");
  const [modeloId, setModeloId] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const modeloEscolhido = modeloId || (padrao ? padrao.id : "");

  useEffect(() => {
    if (imagemId) setFotoId(imagemId);
  }, [imagemId]);

  const foto = fotoId ? todas.find((f) => f.id === fotoId) || null : null;
  // Preparar sempre a partir do original da linhagem: tratada de tratada perde qualidade.
  const derivadas = foto ? todas.filter((f) => f.derivada_de === foto.id) : [];
  const depois: FotoDoAcervo | null = (depoisId && todas.find((f) => f.id === depoisId)) || derivadas[0] || null;
  const modoAtual = MODOS_DE_PREPARO.find((m) => m.valor === modo) || MODOS_DE_PREPARO[0];
  // A função pede o cenário escrito mesmo com guia (cenario_obrigatorio).
  const faltaCenario = modo === "cenario" && !cenario.trim();

  const escolherFoto = (id: string) => {
    setFotoId(id);
    setAreas([]);
    setDepoisId(null);
    setEscolhendo(false);
    irPara("preparar", { imagem: id });
  };

  if (!foto) {
    return (
      <div className="min-w-0 space-y-4 pb-24">
        {fotos.isSuccess && todas.length === 0 ? (
          <Vazio
            titulo="Nenhuma foto no acervo"
            acao={
              <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("acervo")}>
                Subir fotos no Acervo
              </Button>
            }
          />
        ) : (
          <SeletorDeFotos fotos={todas} titulo="Qual foto preparar?" multiplas={false} filtroInicial="original" onUsar={(ids) => ids[0] && escolherFoto(ids[0])} onFechar={() => irPara("acervo")} />
        )}
      </div>
    );
  }

  const imagensDoAmpliar = [foto].concat(depois ? [depois] : []).map((f) => ({
    caminho: f.storage_path,
    bucket: f.storage_bucket || "mesa",
    titulo: f.id === foto.id ? `Antes: ${f.nome}` : `Depois: ${f.nome}`,
    legenda: classeDaFoto(f) === "gerada" ? "Imagem gerada por IA" : f.id === foto.id ? "Original" : "Derivada tratada",
    proporcao: f.largura && f.altura ? f.largura / f.altura : undefined,
  }));

  const Antes = (
    <div className="min-w-0">
      <p className="mb-1 flex items-center text-[11.5px] font-medium text-muted-foreground">
        Antes <span className="ml-1.5"><SeloDaFoto foto={foto} compacto /></span>
      </p>
      <AreasNaFoto foto={foto} areas={areas} onMudar={setAreas} marcando={marcando} disabled={preparando} />
    </div>
  );
  const Depois = (
    <div className="min-w-0">
      <p className="mb-1 flex items-center text-[11.5px] font-medium text-muted-foreground">
        Depois {depois && <span className="ml-1.5"><SeloDaFoto foto={depois} compacto /></span>}
      </p>
      {preparando ? (
        <AreasNaFoto foto={foto} areas={[]} onMudar={() => undefined} marcando={false} estiloDaImagem={VELADO}>
          <div className="absolute inset-0 flex items-center justify-center p-2" aria-live="polite">
            <span className="inline-flex items-center rounded-full bg-card px-3 py-1.5 text-[12.5px] font-medium shadow-sm">
              <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-primary" /> Preparando: {modoAtual.rotulo.toLowerCase()}
            </span>
          </div>
        </AreasNaFoto>
      ) : depois ? (
        <>
          <AreasNaFoto foto={depois} areas={[]} onMudar={() => undefined} marcando={false} />
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <AprovarFoto foto={depois} />
          </div>
        </>
      ) : (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
          A versão tratada aparece aqui. O original não muda.
        </div>
      )}
    </div>
  );

  return (
    <div className="min-w-0 space-y-4 pb-24">
      {escolhendo && <SeletorDeFotos fotos={todas} titulo="Trocar a foto" multiplas={false} filtroInicial="original" onUsar={(ids) => ids[0] && escolherFoto(ids[0])} onFechar={() => setEscolhendo(false)} />}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Cartao
          titulo={<span className="normal-case tracking-normal text-foreground">{foto.nome}</span>}
          acao={
            <>
              <div role="group" aria-label="Como comparar" className="mb-1 mr-2 grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5">
                {(
                  [
                    { v: "lado", r: "Lado a lado" },
                    { v: "antes", r: "Antes" },
                    { v: "depois", r: "Depois" },
                  ] as { v: Vista; r: string }[]
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    aria-pressed={vista === o.v}
                    onClick={() => setVista(o.v)}
                    className={`rounded-md px-2 py-1 text-[11.5px] ${vista === o.v ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
                  >
                    {o.r}
                  </button>
                ))}
              </div>
              <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setEscolhendo(true)}>
                <Images className="mr-1 h-3.5 w-3.5" /> Trocar
              </Button>
              <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => setAmpliada(0)} aria-label="Ver grande">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </>
          }
        >
          <div className={`grid min-w-0 gap-3 ${vista === "lado" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
            {(vista === "lado" || vista === "antes") && Antes}
            {(vista === "lado" || vista === "depois") && Depois}
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap items-center">
            <Button
              type="button"
              size="sm"
              variant={marcando ? "default" : "outline"}
              className="mb-1.5 mr-2 h-8 text-[12px]"
              onClick={() => {
                setMarcando(!marcando);
                if (!marcando && vista === "depois") setVista("lado");
              }}
              aria-pressed={marcando}
            >
              <Crop className="mr-1.5 h-3.5 w-3.5" /> {marcando ? "Pronto" : "Marcar áreas protegidas"}
            </Button>
            <span className="mb-1.5 text-[11.5px] text-muted-foreground">
              {areas.length
                ? `${areas.length} ${areas.length === 1 ? "área protegida" : "áreas protegidas"}: voltam com os pixels originais.`
                : modo === "fundo_branco" || modo === "fundo_transparente"
                  ? "Sem área marcada: o recorte devolve o assunto com os pixels originais."
                  : "Sem área marcada: o gerador trata a foto inteira. Marque o que não pode mudar."}
            </span>
            {areas.length > 0 && (
              <button type="button" className="mb-1.5 ml-2 text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setAreas([])}>
                Limpar áreas
              </button>
            )}
          </div>
          {derivadas.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Versões feitas a partir desta foto</p>
              <div className="flex min-w-0 flex-wrap">
                {derivadas.slice(0, 12).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDepoisId(d.id)}
                    aria-pressed={depois ? depois.id === d.id : false}
                    title={d.nome}
                    className={`mb-1.5 mr-1.5 w-16 rounded-lg border p-0.5 ${depois && depois.id === d.id ? "border-primary" : "border-transparent hover:border-border"}`}
                  >
                    <MiniaturaDaFoto foto={d} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Cartao>

        <div className="min-w-0 space-y-4">
          <Cartao
            titulo="O que fazer com a foto"
            acao={podeTirarFundo(foto) ? <BotaoTirarFundo foto={foto} onPronta={(id) => setDepoisId(id)} /> : undefined}
          >
            <div role="radiogroup" aria-label="Modo de preparo" className="space-y-1.5">
              {MODOS_DE_PREPARO.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  role="radio"
                  aria-checked={modo === m.valor}
                  onClick={() => setModo(m.valor)}
                  className={`block w-full min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${modo === m.valor ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                >
                  <span className="block text-[12.5px] font-semibold">{m.rotulo}</span>
                  {modo === m.valor && (
                    <span className="mt-1 block space-y-0.5 text-[11.5px] leading-snug">
                      <span className="block">
                        <span className="text-muted-foreground">Muda: </span>
                        {m.muda}
                      </span>
                      <span className="block">
                        <span className="text-muted-foreground">Fica: </span>
                        {m.fica}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {modo === "cenario" && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[11.5px] text-muted-foreground">Cenário</span>
                <Input value={cenario} onChange={(e) => setCenario(e.target.value)} placeholder="Ex.: bancada de mármore claro, luz de janela" className="h-9" aria-label="Cenário" />
              </label>
            )}
            <label className="mt-3 block">
              <span className="mb-1 block text-[11.5px] text-muted-foreground">Ajuste fino (opcional)</span>
              <div className="relative">
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={2} placeholder="Ex.: tirar o reflexo da janela na tampa" className="pr-10 text-[12.5px]" aria-label="Ajuste fino" />
                <Ditado valor={instrucao} onChange={setInstrucao} className="absolute bottom-1.5 right-1.5" />
              </div>
            </label>
          </Cartao>

          <Cartao titulo="Guia">
            <SeletorDeGuia guia={guia} onMudar={setGuia} />
          </Cartao>

          <Cartao titulo="Gerar a versão tratada">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloEscolhido} onChange={setModeloId} qualidade={qualidade} />
              <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
            </div>
            {faltaCenario && <p className="mt-2 text-[11.5px] text-warning">Descreva o cenário (superfície, fundo, props, luz). O guia completa, não substitui.</p>}
            {modo === "cenario" && areas.length === 0 && (
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Para trocar o cenário preservando o assunto, marque a área do assunto ou use uma versão já sem fundo desta foto.
              </p>
            )}
            <BotaoComCusto
              rotulo={
                <>
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Preparar: {modoAtual.rotulo.toLowerCase()}
                </>
              }
              titulo="Foto preparada"
              descricao="Gera uma derivada nova no acervo. O original não muda."
              className="mt-3 h-9 w-full text-[12.5px]"
              disabled={preparando || faltaCenario || !modeloEscolhido}
              partes={() => partesDoPreparo(modeloEscolhido, qualidade)}
              executar={async () => {
                setPreparando(true);
                setMarcando(false);
                try {
                  return await prepararFoto({ clientId, imagemId: foto.id, modo, areas, cenario, instrucao, guia });
                } finally {
                  setPreparando(false);
                }
              }}
              aoConcluir={(data) => {
                if (data && data.imagem) {
                  acrescentarFotos(queryClient, clientId, [data.imagem]);
                  setDepoisId(data.imagem.id);
                }
                invalidarFotos(queryClient, clientId);
                if (vista === "antes") setVista("lado");
              }}
            />
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Se o motor não fizer o que o modo exige, a Mesa avisa e não troca por um modo pior. Nada escurece a foto para dar destaque.
            </p>
          </Cartao>
        </div>
      </div>

      <Ampliar imagens={imagensDoAmpliar} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
