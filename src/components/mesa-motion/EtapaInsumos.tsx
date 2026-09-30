import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ImagePlus, Loader2, Music, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA } from "@/components/sistema";
import Secao from "@/components/sistema/Secao";
import { botao, campo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { LISTA_DE_FORMATOS, type FormatoDoMotion } from "../../../supabase/functions/_shared/cena-hf";
import { pastaDoFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, CHAVES, type Filme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 1: insumos do filme. Kit da marca aberta (cores, fontes, logo), dossiê,
 * provas reais com fonte (só elas viram número ou depoimento), prints e fotos
 * (subidos ou do acervo, copiados para a pasta do filme), vídeos do acervo,
 * música e o despejo de ideias. Formatos de saída.
 */

type Insumos = {
  kit: { nome: string; paleta: Array<{ hex?: string; nome?: string; papel?: string }>; fontes: Array<{ nome: string; papel: string }>; tem_logo: boolean; fonte_titulo: string; fonte_texto: string; avisos: string[] };
  dossie: string | null;
  imagens: Array<{ id: string; nome: string; storage_bucket: string; storage_path: string }>;
  videos: Array<{ id: string; nome: string; tipo: string; duracao_s: number | null }>;
  musicas: Array<{ id: string; nome: string; storage_path: string; duracao_s: number | null }>;
};

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [subindo, setSubindo] = useState(false);
  const [novaProva, setNovaProva] = useState({ texto: "", fonte: "" });
  const [notas, setNotas] = useState(typeof filme.insumos.notas === "string" ? (filme.insumos.notas as string) : "");
  const q = useQuery({ queryKey: CHAVES.insumos(filme.id), queryFn: () => chamarMotion<Insumos>("insumos_ler", { filme_id: filme.id }), staleTime: 60_000 });
  const provas = Array.isArray(filme.insumos.provas) ? (filme.insumos.provas as Array<{ texto: string; fonte: string }>) : [];
  const prints = Array.isArray(filme.insumos.prints) ? (filme.insumos.prints as Array<{ path: string; nome: string }>) : [];

  const salvar = async (campos: Record<string, unknown>) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, ...campos });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "Não foi salvo");
    }
  };

  const subir = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setSubindo(true);
    try {
      const novos: Array<{ path: string; nome: string; origem: string }> = [];
      for (const f of Array.from(files).slice(0, 10)) {
        const path = `${pastaDoFilme(clientId, filme.id)}/insumos/${Date.now().toString(36)}-${nomeSeguro(f.name)}`;
        const { error } = await supabase.storage.from("mesa").upload(path, f, { contentType: f.type || "image/png", upsert: false });
        if (error) throw error;
        novos.push({ path, nome: f.name, origem: "upload" });
      }
      await salvar({ insumos: { prints: prints.concat(novos).slice(0, 30) } });
    } catch (e) {
      avisarErro(e, "O print não subiu");
    } finally {
      setSubindo(false);
    }
  };

  const doAcervo = async (id: string) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("insumo_do_acervo", { filme_id: filme.id, cliente_imagem_id: id });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "A foto não foi copiada");
    }
  };

  const k = q.data ? q.data.kit : null;
  return (
    <div className="min-w-0 space-y-6">
      <Secao titulo="Kit da marca" descricao={k ? `${k.nome}${k.tem_logo ? " · com logo" : " · sem logo no kit"}` : "Lendo o kit"} ajuda="Cores, fontes e logo vêm do kit da marca aberta (a marca que não é a principal nunca herda da outra). A logo entra pelo código, nunca pelo gerador de imagem." recolher="mesa-motion:kit">
        {k && (
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-wrap items-center">
              {k.paleta.map((c, i) => (
                <span key={`${c.hex}-${i}`} className="mb-2 mr-3 inline-flex items-center">
                  <span className="mr-1.5 inline-block h-5 w-5 rounded border border-border" style={{ background: c.hex }} aria-hidden />
                  <span className={texto.auxiliar}>
                    {c.hex} {c.papel ? `(${c.papel})` : ""}
                  </span>
                </span>
              ))}
            </div>
            <p className={texto.corpo}>Fontes na cena: {k.fonte_titulo.split("-")[0]} (título) e {k.fonte_texto.split("-")[0]} (texto).</p>
            {k.avisos.map((a) => (
              <p key={a} className={juntar(texto.auxiliar, "text-warning")}>
                {a}
              </p>
            ))}
          </div>
        )}
      </Secao>

      <Secao titulo="Formatos" descricao={filme.formatos.join(", ")} ajuda="A mesma cena sai em cada formato (as medidas são proporcionais ao quadro).">
        <div className="flex min-w-0 flex-wrap" role="group" aria-label="Formatos do filme">
          {LISTA_DE_FORMATOS.map((f) => {
            const ligado = filme.formatos.indexOf(f) >= 0;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={ligado}
                className={juntar(ligado ? botao.primario : botao.secundario, "mb-2 mr-2")}
                onClick={() => {
                  const nova = ligado ? filme.formatos.filter((x) => x !== f) : filme.formatos.concat([f as FormatoDoMotion]);
                  if (nova.length) void salvar({ formatos: nova });
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </Secao>

      <Secao titulo="Provas reais" descricao={`${provas.length} com fonte`} ajuda="Só o que tem fonte entra no filme como número, depoimento ou prova. Sem fonte, o filme fala do método." recolher="mesa-motion:provas">
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {provas.map((p, i) => (
            <li key={`${p.texto}-${i}`} className={lista.linha}>
              <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1")}>
                {p.texto} <span className={texto.auxiliar}>({p.fonte})</span>
              </span>
              <button type="button" className={botao.icone} aria-label="Tirar a prova" onClick={() => void salvar({ insumos: { provas: provas.filter((_, j) => j !== i) } })}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex min-w-0 flex-wrap items-center">
          <input className={juntar(campo, "mb-2 mr-2 min-w-[200px] flex-1")} placeholder="O fato (ex.: 120 lojas atendidas)" value={novaProva.texto} maxLength={240} onChange={(e) => setNovaProva({ ...novaProva, texto: e.target.value })} aria-label="Prova" />
          <input className={juntar(campo, "mb-2 mr-2 min-w-[160px] flex-1")} placeholder="Fonte (relatório, print, contrato)" value={novaProva.fonte} maxLength={160} onChange={(e) => setNovaProva({ ...novaProva, fonte: e.target.value })} aria-label="Fonte da prova" />
          <button
            type="button"
            className={juntar(botao.secundario, "mb-2")}
            disabled={!novaProva.texto.trim() || !novaProva.fonte.trim()}
            onClick={() => {
              void salvar({ insumos: { provas: provas.concat([{ texto: novaProva.texto.trim(), fonte: novaProva.fonte.trim() }]).slice(0, 12) } });
              setNovaProva({ texto: "", fonte: "" });
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Pôr a prova
          </button>
        </div>
      </Secao>

      <Secao titulo="Prints e fotos" descricao={`${prints.length} no filme`} ajuda="Prints do produto, fotos do trabalho e provas em imagem. Ficam na pasta do filme; o worker baixa de lá para a cena." recolher="mesa-motion:prints">
        <div className="flex min-w-0 flex-wrap">
          {prints.map((p) => (
            <span key={p.path} className={juntar(etiqueta, "mb-1 mr-1 bg-muted")}>
              <span className="max-w-[160px] truncate">{p.nome}</span>
            </span>
          ))}
        </div>
        <label className={juntar(botao.secundario, "mt-2 cursor-pointer")}>
          {subindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1 h-3.5 w-3.5" />}
          Subir prints
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => void subir(e.target.files)} />
        </label>
        {q.data && q.data.imagens.length > 0 && (
          <div className="mt-3 min-w-0">
            <span className={texto.rotulo}>Do acervo do cliente</span>
            <ul className={juntar(lista.aberta, "mt-1 lg:max-h-[300px] lg:overflow-y-auto")}>
              {q.data.imagens.slice(0, 30).map((i) => (
                <li key={i.id} className={lista.linha}>
                  <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 truncate")}>{i.nome}</span>
                  <button type="button" className={botao.barra} onClick={() => void doAcervo(i.id)}>
                    Usar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Secao>

      <Secao titulo="Acervo e música" descricao={q.data ? `${q.data.videos.length} vídeos · ${q.data.musicas.length} músicas` : ""} ajuda="Vídeos reais entram como plano do filme da marca; a música é escolhida na etapa Som (licença registrada)." recolher="mesa-motion:acervo" recolhidaDeInicio>
        {q.data && (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {q.data.musicas.slice(0, 10).map((m) => (
              <li key={m.id} className={lista.linha}>
                <Music className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{m.nome}</span>
              </li>
            ))}
            {q.data.videos.slice(0, 10).map((v) => (
              <li key={v.id} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{v.nome}</span>
                <span className={texto.auxiliar}>{v.duracao_s ? `${Math.round(v.duracao_s)} s` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Dossiê e ideias"
        descricao={q.data && q.data.dossie ? "Dossiê lido" : "Sem dossiê"}
        ajuda="O despejo de ideias vai para o BRAND.md e os storyboards. O dossiê da marca aberta entra sozinho."
        recolher="mesa-motion:ideias"
        acao={
          <PreencherComIA
            papel="motion"
            clientId={clientId}
            marcaId={marca ? marca.id : null}
            campos={[{ chave: "notas", rotulo: "Ideias para o filme", tipo: "texto_longo", valorAtual: notas, maximo: 1500, dica: "Ideias de cenas, tom e o que mostrar, tiradas do dossiê e do briefing. Nada de número inventado." }]}
            onAplicar={(v) => {
              const t = String(v.notas || "");
              setNotas(t);
              return salvar({ insumos: { notas: t } });
            }}
            onDesfazer={(a) => {
              const t = String(a.notas || "");
              setNotas(t);
              return salvar({ insumos: { notas: t } });
            }}
          />
        }
      >
        {q.data && q.data.dossie && <p className={juntar(texto.auxiliar, "mb-3 whitespace-pre-line")}>{q.data.dossie.slice(0, 900)}</p>}
        <textarea className={campoTexto} value={notas} maxLength={1500} onChange={(e) => setNotas(e.target.value)} onBlur={() => void salvar({ insumos: { notas } })} placeholder="Despejo de ideias: o que o filme precisa mostrar, referências, o que evitar" aria-label="Ideias para o filme" />
      </Secao>

      <button type="button" className={botao.primario} onClick={() => void salvar({ etapa: "entrevista" }).then(() => irPara("entrevista"))}>
        Seguir para a entrevista
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaInsumos({ irPara }: { irPara: IrPara }) {
  return <ComFilme>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
