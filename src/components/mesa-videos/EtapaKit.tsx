import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, BookmarkPlus, FolderOpen, LayoutTemplate, Loader2, Mic, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { gravarEstadoDaTela, lerEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMotoresDaMesa, useProjetoDoDiretor, useProjetosSalvos, useTemplatesDeVideo } from "@/lib/mesa-videos/api";
import { KITS_DE_VIDEO, kitPorId, duracaoDoKit } from "../../../supabase/functions/_shared/video-kits";
import { custoDoMotor, motorDoPapel, textoDoCusto } from "../../../supabase/functions/_shared/modelos-de-video";
import { projetoDoKit, projetoDoTemplate, type TemplateDeVideo } from "../../../supabase/functions/_shared/diretor-de-video";
import { AvisoDeAtivacao } from "./Comuns";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos } from "./videosApi";
import { chaveDoRascunhoDoAvatar, RASCUNHO_DO_AVATAR, type RascunhoDoAvatar, roteiroDoKitUgc } from "./rascunhoDoAvatar";

/**
 * Kit (frente V-A): kits de vídeo por nicho (móveis planejados, antes e
 * depois, UGC, produto, imobiliário, gastronomia, estética, automotivo,
 * esporte, filme curto, paisagismo, jurídico, assistência técnica, games e
 * moda) e os templates salvos (do cliente e da agência). "Usar" monta o
 * primeiro rascunho da bíblia e do roteiro sem IA; lacuna vazia vira pergunta.
 * Frente V-C (26/09): no kit UGC, "Avatar falando" leva o gancho para o modo
 * de avatar da HeyGen (avatar de estoque ou clone com autorização).
 */

interface Rascunho {
  kit: string;
  variante: string;
  formato: string;
  valores: Record<string, Record<string, string>>;
}

const INICIAL: Rascunho = { kit: "mobiliario", variante: "", formato: "9:16", valores: {} };

export default function EtapaKit({ irPara }: { irPara: IrPara }) {
  const { clientId, isAdmin } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const { projeto, trocar, desfazer } = useProjetoDoDiretor(clientId);
  const templatesQ = useTemplatesDeVideo(clientId);
  const projetosQ = useProjetosSalvos(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:kit:${clientId}`, INICIAL, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const [salvando, setSalvando] = useState(false);
  const kit = kitPorId(r.kit) || KITS_DE_VIDEO[0];
  const variante = (kit.variantes || []).find((v) => v.id === r.variante) || null;
  const valores = { ...(variante ? variante.valores : {}), ...(r.valores[kit.id] || {}) };
  const formato = kit.formatos.indexOf(r.formato as never) >= 0 ? r.formato : kit.formatos[0];

  const cenas = useMemo(
    () =>
      kit.cenas.map((c) => {
        const m = motorDoPapel(c.papel, motores.motores, c.modo);
        return { c, m, custo: m ? custoDoMotor(m, { duracao_s: c.duracao_s }) : null };
      }),
    [kit, motores.motores],
  );
  const total = cenas.reduce((s, x) => s + (x.custo && x.custo.usd !== null ? x.custo.usd : 0), 0);
  const semCotacao = cenas.some((x) => !x.custo || x.custo.usd === null);

  const mudarValor = (chave: string, v: string) => setR((x) => ({ ...x, valores: { ...x.valores, [kit.id]: { ...(x.valores[kit.id] || {}), [chave]: v } } }));

  const usarKit = () => {
    const temPlanos = projeto.roteiro.planos.length > 0;
    const { projeto: novo, faltando } = projetoDoKit(kit, valores, formato, motores.motores);
    trocar(novo);
    toast.success(`Kit ${kit.nome} pronto na Bíblia e no Roteiro`, {
      description: faltando.length ? `Faltam: ${faltando.join(", ")}. O diretor pergunta.` : "Confira a bíblia e os planos.",
      action: temPlanos ? { label: "Desfazer", onClick: () => desfazer() } : undefined,
    });
    irPara("biblia");
  };

  // Kit UGC com a HeyGen: o gancho e o convite viram o começo do roteiro do Avatar falando (nada gera nem cobra aqui).
  const usarComAvatar = () => {
    const chave = chaveDoRascunhoDoAvatar(clientId);
    const atual = lerEstadoDaTela<Partial<RascunhoDoAvatar> | null>(chave, null, (v) => !!v && typeof v === "object");
    const produto = String(valores.produto || "").trim();
    gravarEstadoDaTela(chave, { ...RASCUNHO_DO_AVATAR, ...(atual || {}), roteiro: roteiroDoKitUgc(valores), formato: "9:16", titulo: (produto ? `UGC: ${produto}` : "UGC falado").slice(0, 120) });
    toast.success("Roteiro do UGC no Avatar falando", { description: "Complete o meio com a demonstração e escolha quem fala." });
    irPara("gerar", { modo: "avatar" });
  };

  const usarTemplate = (t: TemplateDeVideo) => {
    trocar(projetoDoTemplate(t, motores.motores));
    toast.success(`Template ${t.nome} aberto`, { action: { label: "Desfazer", onClick: () => desfazer() } });
    irPara("biblia");
  };

  const salvarTemplate = async (daAgencia: boolean) => {
    setSalvando(true);
    try {
      await chamarMesaVideos({ acao: "template_salvar", client_id: clientId, projeto, nome: projeto.titulo, da_agencia: daAgencia });
      void queryClient.invalidateQueries({ queryKey: ["mesa-videos", "templates", clientId] });
      toast.success(daAgencia ? "Template da agência salvo" : "Template do cliente salvo");
    } catch (e) {
      toast.error("Não foi possível salvar o template", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setSalvando(false);
    }
  };

  const arquivarTemplate = async (t: TemplateDeVideo) => {
    try {
      await chamarMesaVideos({ acao: "template_arquivar", template_id: t.id, arquivar: true });
      void queryClient.invalidateQueries({ queryKey: ["mesa-videos", "templates", clientId] });
      toast.success("Template arquivado", {
        action: { label: "Desfazer", onClick: () => void chamarMesaVideos({ acao: "template_arquivar", template_id: t.id, arquivar: false }).then(() => queryClient.invalidateQueries({ queryKey: ["mesa-videos", "templates", clientId] })) },
      });
    } catch (e) {
      toast.error("Não foi possível arquivar", { description: textoDoErro(e) });
    }
  };

  const templates = (templatesQ.data && templatesQ.data.itens) || [];
  const salvos = (projetosQ.data && projetosQ.data.itens) || [];

  return (
    <div className="grid min-w-0 gap-6 pb-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <Secao
        titulo="Kit"
        descricao={`${kit.cenas.length} cenas · ${duracaoDoKit(kit)} s · ${semCotacao ? "~" : ""}US$ ${total.toFixed(2).replace(".", ",")}`}
        ajuda={`${kit.resumo} ${kit.ajuda} Usar não gera nem cobra.`}
        acao={<SeletorCompacto rotulo="Kit" icone={<LayoutTemplate className="h-3.5 w-3.5" />} opcoes={KITS_DE_VIDEO.map((k) => ({ valor: k.id, rotulo: k.nome, descricao: k.resumo }))} valor={kit.id} onEscolher={(v) => setR((x) => ({ ...x, kit: v, variante: "" }))} className="max-w-[62vw] sm:max-w-none" />}
        data-kit={kit.id}
      >
        <GrupoDeCampos>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
            <SeletorCompacto rotulo="Formato" larguraTotal opcoes={kit.formatos.map((f) => ({ valor: f, rotulo: f }))} valor={formato} onEscolher={(v) => setR((x) => ({ ...x, formato: v }))} />
          </div>
          {kit.variantes && kit.variantes.length > 0 && (
            <div className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1.5")}>Variante</p>
              <SeletorCompacto rotulo="Variante" larguraTotal opcoes={[{ valor: "", rotulo: "Livre" }].concat(kit.variantes.map((v) => ({ valor: v.id, rotulo: v.nome })))} valor={r.variante} onEscolher={(v) => setR((x) => ({ ...x, variante: v }))} />
            </div>
          )}
          {kit.lacunas.map((l) => (
            <CampoDeFormulario key={l.chave} rotulo={l.rotulo} obrigatorio={l.obrigatoria}>
              <input className={campo} value={valores[l.chave] || ""} maxLength={300} placeholder={l.exemplo} onChange={(e) => mudarValor(l.chave, e.target.value)} />
            </CampoDeFormulario>
          ))}
        </GrupoDeCampos>

        <ol className="mt-5 divide-y divide-border" aria-label="Cenas do kit">
          {cenas.map(({ c, m, custo }) => (
            <li key={c.ref} className="flex min-w-0 items-baseline py-2">
              <span className={juntar(texto.auxiliar, "mr-2 w-6 shrink-0 tabular-nums")}>{c.ref.replace("c", "")}</span>
              <div className="mr-2 min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{c.nome}</p>
                <p className={juntar(texto.auxiliar, "truncate")} title={c.objetivo}>
                  {c.modo === "imagem" ? "imagem" : `${c.duracao_s} s`} · {c.camera} · {m ? m.rotulo : "sem motor"}
                </p>
              </div>
              <span className="text-[12px] tabular-nums text-muted-foreground">{custo ? textoDoCusto(custo) : "Sem cotação"}</span>
            </li>
          ))}
        </ol>

        {/* 28/09 (dono: "menos poluído"): as regras do kit ficam no "?" da linha das ações, sem caixa nem texto à vista. */}
        <div className="mt-4 flex min-w-0 items-center justify-end">
          <span className={juntar(texto.rotulo, "min-w-0 truncate")}>Consistência e o que evitar</span>
          <AjudaRecolhida rotulo="Regras do kit" className="ml-1 mr-3">
            {kit.consistencia
              .concat(kit.evitar.map((e) => `Evitar: ${e}`))
              .concat(kit.pede_pessoa ? ["Pede pessoa: gerada pela folha, ou real só com autorização registrada."] : [])
              .join(" ")}
          </AjudaRecolhida>
          <span className="flex-1" />
          {kit.id === "ugc" && (
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={usarComAvatar} aria-label="Fazer o UGC com avatar falando">
              <Mic className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Avatar falando</span>
            </button>
          )}
          <button type="button" className={botao.primario} onClick={usarKit} title="Usar não gera nem cobra">
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Usar o kit
          </button>
        </div>
      </Secao>

      <div className="min-w-0 space-y-6">
        <Secao
          titulo="Templates"
          descricao={`${templates.length} salvos`}
          ajuda="Um projeto pronto (bíblia e roteiro) vira template: do cliente (com as referências dele) ou da agência (sem arquivos de cliente)."
          recolher={`mesa-videos:templates:${clientId}`}
          resumo={`${templates.length} salvos`}
          acao={
            <>
              <button type="button" className={botao.secundario} disabled={salvando || !projeto.roteiro.planos.length} onClick={() => void salvarTemplate(false)} aria-label="Salvar o projeto atual como template do cliente">
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <BookmarkPlus className="h-3.5 w-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">Salvar</span>
              </button>
              {isAdmin && (
                <button type="button" className={juntar(botao.discreto, "ml-1")} disabled={salvando || !projeto.roteiro.planos.length} onClick={() => void salvarTemplate(true)}>
                  Da agência
                </button>
              )}
            </>
          }
        >
          {templatesQ.data && !templatesQ.data.disponivel && <AvisoDeAtivacao>Templates esperam o SQL V-01.</AvisoDeAtivacao>}
          {templates.length ? (
            <ul className="divide-y divide-border" aria-label="Templates">
              {templates.map((t) => (
                <li key={t.id} className="flex min-w-0 items-center py-2">
                  <div className="mr-2 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{t.nome}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>{t.client_id ? "Do cliente" : "Da agência"}{t.kit_id ? ` · ${(kitPorId(t.kit_id) || { nome: t.kit_id }).nome}` : ""}</p>
                  </div>
                  <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12.5px]")} onClick={() => usarTemplate(t)}>
                    Usar
                  </button>
                  {(t.client_id || isAdmin) && (
                    <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void arquivarTemplate(t)} aria-label={`Arquivar ${t.nome}`}>
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EstadoVazio compacto titulo="Nenhum template ainda." descricao="Monte um projeto e salve." />
          )}
        </Secao>

        <Secao
          divisoria
          titulo="Projetos"
          descricao={`${salvos.length} salvos`}
          ajuda="Projetos do diretor gravados no banco. Abrir troca o projeto aberto (dá para desfazer)."
          recolher={`mesa-videos:projetos:${clientId}`}
          resumo={`${salvos.length} salvos`}
        >
          {salvos.length ? (
            <ul className="divide-y divide-border" aria-label="Projetos do diretor">
              {salvos.map((p) => (
                <li key={p.id || p.titulo} className="flex min-w-0 items-center py-2">
                  <div className="mr-2 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{p.titulo}</p>
                    <p className={juntar(texto.auxiliar, "truncate")}>{p.roteiro.planos.length} planos{projeto.id === p.id ? " · aberto" : ""}</p>
                  </div>
                  <button
                    type="button"
                    className={botao.icone}
                    onClick={() => {
                      trocar(p);
                      toast.success(`${p.titulo} aberto`, { action: { label: "Desfazer", onClick: () => desfazer() } });
                      irPara("roteiro");
                    }}
                    aria-label={`Abrir ${p.titulo}`}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EstadoVazio compacto titulo="Nada salvo ainda." />
          )}
        </Secao>
      </div>
    </div>
  );
}
