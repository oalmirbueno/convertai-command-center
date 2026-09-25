import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookImage, Check, ClipboardCheck, Images, Megaphone, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, usd, type Qualidade } from "@/lib/mesa/api";
import { AndamentoDoLote, BotaoDoLote } from "./AndamentoDoLote";
import { SeletorDaCampanha, useCampanhaEscolhida } from "./CampanhaDaMesa";
import { DecisaoRapida, MenuDeUso } from "./UsoDaFoto";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import { ImagemDaBiblioteca } from "./EtapaBiblioteca";
import { ZonaDeEnvio } from "./EtapaAcervo";
import { GuiaDeEstiloNaTela } from "./GuiaDeEstilo";
import SeletorDeFotos from "./SeletorDeFotos";
import {
  acrescentarFotos,
  chaveDosEnsaios,
  ehCampanha,
  ESTADOS_DA_TOMADA,
  fotoDaVersao,
  gerarTomada,
  guardarEnsaio,
  invalidarFotos,
  partesDaGeracao,
  limitarQuantidade,
  MAX_REFERENCIAS_DA_CAMPANHA,
  partesDoPlanoDeLote,
  planejarCampanha,
  proporcaoDoFormato,
  resumoDoEnsaio,
  rotuloDoEstadoDoEnsaio,
  rotuloDoTipo,
  subirOriginais,
  useBiblioteca,
  useEnsaios,
  useFotos,
  useKits,
  type Ensaio,
  type PerfilDoModelo,
} from "./fotoApi";

/**
 * Campanha com modelo (CONTRATO-V2, pedido do dono com o exemplo da ótica):
 * escolher o produto (kit), subir ou escolher referências de estilo (print
 * de perfil, moodboard, biblioteca), dizer o perfil do modelo sintético e
 * quantas fotos; o diretor lê as referências e escreve o guia de estilo
 * (paleta, luz, cenários, props, enquadramentos, clima), e monta as fotos
 * de campanha. Gerar em lote com andamento por foto; revisar e usar seguem o
 * mesmo fluxo de aprovação.
 *
 * Organizada em blocos independentes (Produto, Campanha da Mesa, Estilo,
 * Modelo, Fotos, e a campanha aberta) para virar a futura Mesa de
 * Publicidade sem refazer.
 *
 * 25/09 (pedido do dono): a campanha da Mesa se escolhe aqui (a do mês vem
 * marcada pelo calendário) e vai no plano; cada foto gerada aprova, rejeita,
 * refaz e tem o menu Usar no próprio resultado, numa grade com rolagem
 * própria.
 *
 * Regras: a pessoa é sintética (adulta, sem parecer com ninguém real, sem
 * sexualização), o produto do kit não muda, a referência de estilo só dá a
 * direção (nunca se copia foto, marca ou pessoa) e toda foto sai marcada
 * como gerada.
 */

const PERFIS = ["Mulher", "Homem", "Variar os perfis"].map((p) => ({ valor: p, rotulo: p }));
const IDADES = ["18 a 25", "25 a 35", "35 a 50", "50 ou mais"].map((p) => ({ valor: p, rotulo: `${p} anos` }));
const QUANTIDADES = [4, 6, 8, 12, 16].map((n) => ({ valor: n, rotulo: `${n} fotos` }));

/** Referência de estilo escolhida: do acervo (foto) ou da biblioteca (item). */
interface RefDeEstilo {
  id: string;
  origem: "acervo" | "biblioteca";
}

function BlocoDoEstilo({ refs, onMudar }: { refs: RefDeEstilo[]; onMudar: (r: RefDeEstilo[]) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const [daBiblioteca, setDaBiblioteca] = useState(false);
  const biblioteca = useBiblioteca(clientId, daBiblioteca || refs.some((r) => r.origem === "biblioteca"));
  const [doAcervo, setDoAcervo] = useState(false);
  const [andamento, setAndamento] = useState<string | null>(null);
  const todas = fotos.data || [];
  const referencias = (biblioteca.data || []).filter((i) => i.tipo === "referencia");
  const cheio = refs.length >= MAX_REFERENCIAS_DA_CAMPANHA;

  const somar = (novas: RefDeEstilo[]) => {
    const saida = refs.slice();
    novas.forEach((n) => {
      if (saida.length < MAX_REFERENCIAS_DA_CAMPANHA && !saida.some((x) => x.id === n.id)) saida.push(n);
    });
    onMudar(saida);
  };

  const subir = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento(`Subindo ${arquivos.length} ${arquivos.length === 1 ? "referência" : "referências"}`);
    try {
      const r = await subirOriginais(clientId, arquivos.slice(0, MAX_REFERENCIAS_DA_CAMPANHA), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      somar(r.registradas.map((f) => ({ id: f.id, origem: "acervo" as const })));
      if (r.recusadas.length) toast.error(`${r.recusadas.length} ${r.recusadas.length === 1 ? "imagem não entrou" : "imagens não entraram"}`, { description: r.recusadas.map((x) => `${x.nome}: ${x.motivo}`).join(". ") });
    } catch (e) {
      avisarErro(e, "Referência não subiu");
    } finally {
      setAndamento(null);
    }
  };

  return (
    <Cartao titulo="3. Referência de estilo" dica="Print de perfil, moodboard ou referência da biblioteca. O diretor tira só a direção: paleta, luz, cenários, clima. Nunca copia foto, marca ou pessoa.">
      {refs.length > 0 && (
        <ul className="mb-2 flex min-w-0 flex-wrap" aria-label="Referências de estilo escolhidas">
          {refs.map((r) => {
            const f = r.origem === "acervo" ? todas.find((x) => x.id === r.id) : null;
            const item = r.origem === "biblioteca" ? referencias.find((x) => x.id === r.id) : null;
            return (
              <li key={r.id} className="relative mb-1.5 mr-1.5 w-14" data-ref-de-estilo={r.id}>
                {f ? (
                  <MiniaturaDaFoto foto={f} selo={false} />
                ) : item ? (
                  <Moldura proporcao={1}>
                    <ImagemDaBiblioteca item={item} />
                  </Moldura>
                ) : (
                  <span className="block h-14 w-14 rounded-lg bg-muted" />
                )}
                <button
                  type="button"
                  onClick={() => onMudar(refs.filter((x) => x.id !== r.id))}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
                  aria-label="Tirar esta referência"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!cheio && <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />}
      <div className="mt-2 flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={cheio} onClick={() => setDoAcervo(true)}>
          <Images className="mr-1.5 h-3.5 w-3.5" /> Do acervo
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={cheio} onClick={() => setDaBiblioteca(!daBiblioteca)} aria-expanded={daBiblioteca}>
          <BookImage className="mr-1.5 h-3.5 w-3.5" /> Da biblioteca
        </Button>
        <span className="mb-1 text-[11px] text-muted-foreground">
          {refs.length} de {MAX_REFERENCIAS_DA_CAMPANHA}
        </span>
      </div>
      {doAcervo && (
        <div className="mt-2">
          <SeletorDeFotos
            fotos={todas}
            titulo="Referências de estilo do acervo"
            jaEscolhidas={refs.map((r) => r.id)}
            onUsar={(ids) => {
              somar(ids.map((id) => ({ id, origem: "acervo" as const })));
              setDoAcervo(false);
            }}
            onFechar={() => setDoAcervo(false)}
          />
        </div>
      )}
      {daBiblioteca && (
        <div className="mt-2 min-w-0">
          {biblioteca.isError && <AvisoDeErro erro={biblioteca.error} />}
          {biblioteca.isSuccess && referencias.length === 0 && <p className="text-[12px] text-muted-foreground">Nenhuma referência de imagem na biblioteca ainda.</p>}
          <div className="grid max-h-56 min-w-0 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6" aria-label="Referências da biblioteca">
            {referencias.slice(0, 60).map((i) => {
              const marcada = refs.some((r) => r.id === i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={marcada}
                  aria-label={`Referência ${i.titulo}`}
                  disabled={!marcada && cheio}
                  onClick={() => (marcada ? onMudar(refs.filter((r) => r.id !== i.id)) : somar([{ id: i.id, origem: "biblioteca" }]))}
                  className={`relative min-w-0 rounded-lg border p-0.5 disabled:opacity-40 ${marcada ? "border-primary" : "border-transparent hover:border-border"}`}
                >
                  <Moldura proporcao={1}>
                    <ImagemDaBiblioteca item={i} />
                  </Moldura>
                  {marcada && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Cartao>
  );
}

function BlocoDoModelo({ modelo, onMudar }: { modelo: PerfilDoModelo; onMudar: (m: PerfilDoModelo) => void }) {
  return (
    <Cartao titulo="4. Modelo sintético" dica="Pessoa criada pela IA: adulta, sem parecer com ninguém real, sem sexualização. Sempre marcada como gerada.">
      <p className="mb-1 text-[11.5px] text-muted-foreground">Perfil</p>
      <Pilulas rotulo="Perfil do modelo" opcoes={PERFIS} valor={PERFIS.some((p) => p.valor === modelo.perfil) ? modelo.perfil : null} onEscolher={(v) => onMudar({ ...modelo, perfil: v })} />
      <p className="mb-1 mt-1 text-[11.5px] text-muted-foreground">Idade aproximada</p>
      <Pilulas rotulo="Idade aproximada do modelo" opcoes={IDADES} valor={modelo.idade_aprox || null} onEscolher={(v) => onMudar({ ...modelo, idade_aprox: v })} />
      <label className="mt-1 block">
        <span className="mb-1 block text-[11.5px] text-muted-foreground">Estilo (opcional)</span>
        <Input value={modelo.estilo} onChange={(e) => onMudar({ ...modelo, estilo: e.target.value })} placeholder="Ex.: urbano, minimalista, roupa neutra" aria-label="Estilo do modelo" className="h-9 text-[12.5px]" />
      </label>
    </Cartao>
  );
}

/** Uma foto da campanha no resultado: ver grande, aprovar, rejeitar, refazer e usar ali mesmo. */
function FotoDaCampanha({ ensaio, tomada, modeloId, qualidade, onAmpliar }: { ensaio: Ensaio; tomada: Ensaio["tomadas"][number]; modeloId: string; qualidade: Qualidade; onAmpliar: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const fotos = useFotos(clientId);
  const ultima = tomada.versoes.length ? tomada.versoes[tomada.versoes.length - 1] : null;
  const aprovadaV = tomada.versoes.find((v) => v.aprovada) || null;
  const mostrada = aprovadaV || ultima;
  const estado = ESTADOS_DA_TOMADA[tomada.status] || ESTADOS_DA_TOMADA.pendente;
  const pendente = !aprovadaV && ultima && !ultima.rejeitada && ultima.storage_path ? ultima : null;
  const fotoAprovada = aprovadaV ? fotoDaVersao(fotos.data || [], aprovadaV) : null;
  const gerando = tomada.status === "gerando";
  return (
    <li className={`min-w-0 rounded-xl border bg-card p-1.5 ${aprovadaV ? "border-success/50" : "border-border"}`} data-foto-da-campanha={tomada.id}>
      <button type="button" className="block w-full cursor-zoom-in text-left disabled:cursor-default" disabled={!mostrada} onClick={onAmpliar} aria-label={`Ver grande: ${tomada.nome}`}>
        <Moldura proporcao={proporcaoDoFormato(tomada.formato)} className="border border-border">
          {mostrada && mostrada.storage_path ? (
            <ImagemDaMesa caminho={mostrada.storage_path} alt={tomada.nome} className="h-full w-full !object-contain" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Megaphone className="h-4 w-4" />
            </span>
          )}
          {mostrada && (
            <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
              gerada
            </span>
          )}
        </Moldura>
      </button>
      <p className="mt-1 truncate text-[11.5px] font-medium" title={tomada.nome}>
        {tomada.nome}
      </p>
      <span className={`inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${estado.cor}`}>{estado.rotulo}</span>
      <div className="mt-1 flex min-w-0 flex-wrap items-center">
        {pendente && !gerando && <DecisaoRapida ensaio={ensaio} tomada={tomada} versao={pendente} compacta />}
        {!aprovadaV && ultima && tomada.status !== "bloqueada" && (
          <BotaoComCusto
            rotulo={
              <>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refazer
              </>
            }
            titulo="Variação gerada"
            descricao="Gera uma versão nova desta foto, com variação real. As versões antigas ficam."
            variant="ghost"
            className="mb-1 mr-1 h-8 px-2 text-[12px]"
            disabled={gerando || !modeloId}
            partes={() => partesDaGeracao(modeloId, qualidade)}
            executar={async () => {
              try {
                const r = await gerarTomada({ ensaioId: ensaio.id, tomadaId: tomada.id, modeloImagemId: modeloId, qualidade });
                if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
                else void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
                return r;
              } catch (e) {
                void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
                throw e;
              }
            }}
          />
        )}
        {fotoAprovada && <MenuDeUso foto={fotoAprovada} className="mb-1" />}
        {pendente && !gerando && <MenuDeUso pendente={{ ensaio, tomada, versao: pendente }} variante="ghost" className="mb-1" />}
      </div>
    </li>
  );
}

function CampanhaAberta({ ensaio }: { ensaio: Ensaio }) {
  const { catalogo } = useMesa();
  const { irPara } = useMesaFoto();
  const padrao = padraoPara(catalogo, "imagem");
  const [modeloId, setModeloId] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const modelo = modeloId || (padrao ? padrao.id : "");
  const r = resumoDoEnsaio(ensaio);
  const comVersao = ensaio.tomadas.filter((t) => t.versoes.length > 0);

  return (
    <div className="min-w-0 space-y-3" data-campanha-aberta={ensaio.id}>
      <GuiaDeEstiloNaTela guia={ensaio.direcao.guia_de_estilo} modelo={ensaio.direcao.modelo} />
      <AndamentoDoLote ensaioId={ensaio.id} />
      <Cartao
        titulo={`Fotos da campanha · ${r.total}`}
        dica={`${r.aprovadas} aprovadas · ${r.paraRevisar} para revisar · ${usd(r.custo)} gasto${ensaio.direcao.campanha_mesa ? ` · campanha ${ensaio.direcao.campanha_mesa.nome}` : ""}. Aprove, refaça ou use cada foto aqui mesmo.`}
        acao={
          r.versoes > 0 ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => irPara("revisar", { ensaio: ensaio.id })}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Comparar com as fontes
            </Button>
          ) : undefined
        }
      >
        {ensaio.tomadas.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">O diretor não montou fotos. Planeje de novo com outro pedido.</p>
        ) : (
          <div className="max-h-[75vh] min-w-0 overflow-y-auto pr-0.5" data-rolagem-propria="">
            <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {ensaio.tomadas.map((t) => (
                <FotoDaCampanha key={t.id} ensaio={ensaio} tomada={t} modeloId={modelo} qualidade={qualidade} onAmpliar={() => setAmpliada(comVersao.indexOf(t))} />
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
          <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setModeloId} qualidade={qualidade} />
          <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center">
          <BotaoDoLote ensaio={ensaio} modeloId={modelo} qualidade={qualidade} className="mb-1 mr-1.5 h-9 text-[12.5px]" />
          {r.aprovadas > 0 && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-9 text-[12.5px]" onClick={() => irPara("usar", { ensaio: ensaio.id })}>
              Usar as {r.aprovadas} aprovadas
            </Button>
          )}
        </div>
      </Cartao>
      <Ampliar
        imagens={comVersao.map((t) => {
          const v = t.versoes[t.versoes.length - 1];
          return { caminho: v.storage_path || "", titulo: `${t.nome} (gerada)`, legenda: "Imagem gerada por IA, pessoa sintética", proporcao: proporcaoDoFormato(t.formato) };
        })}
        indice={ampliada !== null && ampliada >= 0 ? ampliada : null}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}

export default function EtapaCampanha() {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { kitId, ensaioId, escolherKit, escolherEnsaio, irPara } = useMesaFoto();
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  const campanhas = useMemo(() => (ensaios.data || []).filter((e) => ehCampanha(e)), [ensaios.data]);
  const [nova, setNova] = useState(false);
  const aberta = !nova && ensaioId ? campanhas.find((e) => e.id === ensaioId) || null : null;
  const kit = kitId ? listaDeKits.find((k) => k.id === kitId) || null : null;
  const [refs, setRefs] = useState<RefDeEstilo[]>([]);
  const [modelo, setModelo] = useState<PerfilDoModelo>({ perfil: "Variar os perfis", idade_aprox: "25 a 35", estilo: "" });
  const [quantidade, setQuantidade] = useState(6);
  const [pedido, setPedido] = useState("");
  const campanhaDaMesa = useCampanhaEscolhida();

  if (kits.isSuccess && !listaDeKits.length) {
    return (
      <Vazio
        titulo="Primeiro, o produto"
        acao={
          <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("acervo")}>
            Identificar o produto nas fotos
          </Button>
        }
      >
        A campanha põe o produto na mão de um modelo sintético. Sem o produto identificado, não há o que preservar.
      </Vazio>
    );
  }

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <div className="flex min-w-0 flex-wrap items-center">
        <Select
          value={aberta ? aberta.id : ""}
          onValueChange={(v) => {
            setNova(false);
            escolherEnsaio(v);
          }}
        >
          <SelectTrigger className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[12.5px] sm:w-[340px]" aria-label="Campanha aberta">
            <SelectValue placeholder={campanhas.length ? "Abrir uma campanha" : "Nenhuma campanha ainda"} />
          </SelectTrigger>
          <SelectContent>
            {campanhas.map((e) => {
              const k = listaDeKits.find((x) => x.id === e.kit_id);
              return (
                <SelectItem key={e.id} value={e.id}>
                  Campanha{k ? ` · ${k.nome}` : ""} · {e.tomadas.length} fotos · {rotuloDoEstadoDoEnsaio(e.status)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {aberta && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-1.5 h-9 text-[12.5px]"
            onClick={() => {
              setNova(true);
              escolherEnsaio(null);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Nova campanha
          </Button>
        )}
      </div>
      {(kits.isError || ensaios.isError) && <AvisoDeErro erro={kits.error || ensaios.error} />}

      {aberta ? (
        <CampanhaAberta key={aberta.id} ensaio={aberta} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <Cartao titulo="1. Produto">
              <Select value={kit && kit.id ? kit.id : ""} onValueChange={(v) => escolherKit(v)}>
                <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Produto da campanha">
                  <SelectValue placeholder="Escolha o produto" />
                </SelectTrigger>
                <SelectContent>
                  {listaDeKits.map((k) => (
                    <SelectItem key={String(k.id)} value={String(k.id)}>
                      {k.nome} · {rotuloDoTipo(k.tipo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {kit && kit.invariantes.length > 0 && <p className="mt-2 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Não muda: {kit.invariantes.join(", ")}.</p>}
            </Cartao>
            <SeletorDaCampanha escolhida={campanhaDaMesa} titulo="2. Campanha da Mesa" />
            <BlocoDoEstilo refs={refs} onMudar={setRefs} />
          </div>
          <div className="min-w-0 space-y-4">
            <BlocoDoModelo modelo={modelo} onMudar={setModelo} />
            <Cartao titulo="5. Fotos">
              <Pilulas rotulo="Quantas fotos da campanha" opcoes={QUANTIDADES} valor={quantidade} onEscolher={(n) => setQuantidade(limitarQuantidade(n))} />
              <label className="mt-1 block">
                <span className="mb-1 block text-[11.5px] text-muted-foreground">Pedido ao diretor (opcional)</span>
                <div className="relative">
                  <Textarea
                    value={pedido}
                    onChange={(e) => setPedido(e.target.value)}
                    rows={3}
                    placeholder="Ex.: céu azul com nuvens, retratos de perto, lifestyle na rua, produto flutuando"
                    className="pr-10 text-[12.5px]"
                    aria-label="Pedido da campanha"
                  />
                  <Ditado valor={pedido} onChange={setPedido} className="absolute bottom-1.5 right-1.5" />
                </div>
              </label>
              <BotaoComCusto
                rotulo={
                  <>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Planejar a campanha ({quantidade} fotos)
                  </>
                }
                titulo="Campanha planejada"
                descricao="O diretor lê as referências, escreve o guia de estilo e monta as fotos. Nenhuma imagem é gerada agora: o total para gerar aparece antes."
                className="mt-3 h-9 w-full text-[12.5px]"
                disabled={!kit || !kit.id}
                partes={() => partesDoPlanoDeLote(catalogo, refs.length)}
                executar={() =>
                  planejarCampanha({
                    clientId,
                    kitId: String(kit && kit.id),
                    quantidade,
                    referenciasEstiloIds: refs.map((r) => r.id),
                    modelo,
                    pedido,
                    campanhaId: campanhaDaMesa.campanhaId,
                  })
                }
                aoConcluir={(data) => {
                  if (data && data.ensaio) {
                    guardarEnsaio(queryClient, clientId, data.ensaio);
                    setNova(false);
                    escolherEnsaio(data.ensaio.id);
                  }
                  if (data && data.estimativa_usd !== null && data.estimativa_usd !== undefined) {
                    toast.info(`Gerar a campanha: cerca de ${usd(data.estimativa_usd)}`, { description: "O botão Gerar todas mostra o total antes." });
                  }
                }}
              />
              {!kit && <p className="mt-2 text-[11.5px] text-muted-foreground">Escolha o produto.</p>}
              <p className="mt-2 flex items-start text-[11px] leading-snug text-muted-foreground">
                <Upload className="mr-1 mt-0.5 h-3 w-3 shrink-0" /> Cada foto gerada se aprova, refaz ou usa no próprio resultado: Mesa, Mesa Ads, baixar ou aprovação.
              </p>
            </Cartao>
          </div>
        </div>
      )}
    </div>
  );
}
