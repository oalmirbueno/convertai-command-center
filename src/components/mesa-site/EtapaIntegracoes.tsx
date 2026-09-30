import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { GradeDeGrupos, GrupoDeFuncoes } from "@/components/sistema/GrupoDeFuncoes";
import { PreencherComIA } from "@/components/sistema";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { CAMPOS_DO_FORMULARIO, normalizarIntegracoes, normalizarSeo, TIPOS_DE_NEGOCIO } from "../../../supabase/functions/_shared/site-lancamento";
import { CHAVES, chamarMotor, type LinhaDoSite, montadoDepoisDasMudancas, useSalvarSite, useTrabalhos } from "./siteApi";
import CampoComIA, { listaDoValor, textoDoValor } from "./CampoComIA";

const ROTULO_DO_CAMPO: Record<string, string> = { nome: "Nome", email: "E-mail", whatsapp: "WhatsApp", empresa: "Empresa", mensagem: "Mensagem" };

type Integracoes = ReturnType<typeof normalizarIntegracoes>;
type Seo = ReturnType<typeof normalizarSeo>;

/**
 * Etapa 6 (SIT2): integrações e SEO. WhatsApp flutuante, formulário que cai
 * no CRM do painel (Comercial, origem "site", com anti-spam), pixel da Meta e
 * GA4 por ID (só depois do aviso de cookies), mapa do Google, aviso de
 * cookies (LGPD) e o SEO completo (título, descrição, imagem de
 * compartilhamento, indexação, schema do negócio; sitemap e robots saem no
 * build). "Aplicar no site" monta de novo sem gastar modelo.
 */
export default function EtapaIntegracoes({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = trabalhosQ.data ? trabalhosQ.data.trabalhos : [];
  const [int, setInt] = useState<Integracoes>(() => normalizarIntegracoes(site.integracoes || {}));
  const [seo, setSeo] = useState<Seo>(() => normalizarSeo(site.seo || {}));
  const [horario, setHorario] = useState("");
  const [redes, setRedes] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const imagens = useMemo(
    () =>
      ((site.imagens || []) as Array<{ id: string; slot: string; secao?: string | null; alt?: string; escolhida?: boolean }>)
        .filter((i) => i.escolhida !== false)
        .map((i) => ({ id: i.id, rotulo: `${i.slot}${i.secao ? ` · ${i.secao}` : ""}: ${i.alt || ""}`.slice(0, 80) })),
    [site.imagens],
  );

  useEffect(() => {
    setInt(normalizarIntegracoes(site.integracoes || {}));
    const s = normalizarSeo(site.seo || {});
    setSeo(s);
    setHorario(s.negocio.horario.join("\n"));
    setRedes(s.negocio.redes.join("\n"));
    // Ao abrir outro site e quando o salvo muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.integracoes || null), JSON.stringify(site.seo || null)]);

  const montado = montadoDepoisDasMudancas(site, trabalhos);
  const rodando = trabalhos.some((t) => t.estado === "na_fila" || t.estado === "executando" || t.estado === "parando");
  // Motor desligado: o pedido espera na fila e a tela diz isso, sem girar para sempre (QA 30/09).
  const parado = rodando && !!trabalhosQ.data && !trabalhosQ.data.vivo;

  const rodar = async (rotulo: string, fn: () => Promise<unknown>) => {
    setOcupado(rotulo);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const salvarIntegracoes = () => rodar("As integrações não foram salvas", () => salvarSite("integracoes_salvar", { site_id: site.id, integracoes: int }));
  const seoParaSalvar = (s: Seo) => ({ ...s, negocio: { ...s.negocio, horario: listaDoValor(horario), redes: listaDoValor(redes) } });
  const salvarSeo = () => rodar("O SEO não foi salvo", () => salvarSite("seo_salvar", { site_id: site.id, seo: seoParaSalvar(seo) }));
  const aplicarNoSite = () =>
    rodar("A montagem não entrou na fila", async () => {
      await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo: "revisar", instrucao: "Aplicar SEO e integrações e revisar" });
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
    });

  const mudarInt = <K extends keyof Integracoes>(k: K, v: Partial<Integracoes[K]>) => setInt((x) => ({ ...x, [k]: { ...x[k], ...v } }));
  const mudarNegocio = (v: Partial<Seo["negocio"]>) => setSeo((x) => ({ ...x, negocio: { ...x.negocio, ...v } }));

  const camposDoSeo = [
    { chave: "seo.titulo", rotulo: "Título de SEO", tipo: "texto" as const, valorAtual: seo.titulo, maximo: 60, dica: "até 60 caracteres, com o serviço principal e a cidade quando o negócio é local" },
    { chave: "seo.descricao", rotulo: "Descrição de SEO", tipo: "texto_longo" as const, valorAtual: seo.descricao, maximo: 155, dica: "de 120 a 155 caracteres: benefício e próximo passo" },
    { chave: "seo.palavras", rotulo: "Palavras de busca", tipo: "lista" as const, valorAtual: seo.palavras, maximo: 8, dica: "de 5 a 8 termos que o público busca" },
    { chave: "seo.negocio.nome", rotulo: "Nome do negócio", tipo: "texto" as const, valorAtual: seo.negocio.nome, maximo: 120 },
    { chave: "seo.negocio.tipo", rotulo: "Tipo do negócio (schema)", tipo: "escolha" as const, opcoes: TIPOS_DE_NEGOCIO.map((t) => t.id), valorAtual: seo.negocio.tipo },
    { chave: "seo.negocio.telefone", rotulo: "Telefone", tipo: "texto" as const, valorAtual: seo.negocio.telefone || "", dica: "só das fontes; nunca inventar número" },
    { chave: "seo.negocio.email", rotulo: "E-mail", tipo: "texto" as const, valorAtual: seo.negocio.email || "", dica: "só das fontes" },
    { chave: "seo.negocio.rua", rotulo: "Endereço (rua e número)", tipo: "texto" as const, valorAtual: seo.negocio.rua, dica: "só das fontes" },
    { chave: "seo.negocio.cidade", rotulo: "Cidade", tipo: "texto" as const, valorAtual: seo.negocio.cidade, dica: "só das fontes" },
    { chave: "seo.negocio.estado", rotulo: "UF", tipo: "texto" as const, valorAtual: seo.negocio.estado, maximo: 2 },
    { chave: "seo.negocio.horario", rotulo: "Horário", tipo: "lista" as const, valorAtual: seo.negocio.horario, dica: "formato do schema, ex.: Mo-Fr 09:00-18:00; só das fontes" },
  ];

  const aplicarSeoDaIA = async (v: Record<string, unknown>) => {
    const novo: Seo = { ...seo, negocio: { ...seo.negocio } };
    Object.keys(v).forEach((k) => {
      if (k === "seo.titulo") novo.titulo = textoDoValor(v[k]).slice(0, 60);
      else if (k === "seo.descricao") novo.descricao = textoDoValor(v[k]).slice(0, 155);
      else if (k === "seo.palavras") novo.palavras = listaDoValor(v[k]).slice(0, 10);
      else if (k === "seo.negocio.horario") setHorario(listaDoValor(v[k]).join("\n"));
      else if (k.indexOf("seo.negocio.") === 0) (novo.negocio as Record<string, unknown>)[k.slice(12)] = textoDoValor(v[k]);
    });
    setSeo(novo);
    const horarioNovo = v["seo.negocio.horario"] !== undefined ? listaDoValor(v["seo.negocio.horario"]) : listaDoValor(horario);
    await salvarSite("seo_salvar", { site_id: site.id, seo: { ...novo, negocio: { ...novo.negocio, horario: horarioNovo, redes: listaDoValor(redes) } } });
  };

  const contar = (s: string, max: number) => `${s.length}/${max}`;

  return (
    <div className="min-w-0 space-y-6" data-etapa-integracoes="">
      <Secao
        titulo="Integrações"
        descricao={parado ? "Motor desligado: a montagem espera na fila (pare em Construção)" : montado ? "Site em dia" : "Mudou depois do último build"}
        ajuda="O WhatsApp flutuante e o formulário são os jeitos de falar com o cliente. O formulário manda o contato para o Comercial do painel (origem site), com armadilha para robô, tempo mínimo e limite por visitante. Pixel da Meta e GA4 só carregam depois do Aceitar do aviso de cookies (LGPD), que liga sozinho quando há rastreio. O mapa do Google só carrega com o clique. Aplicar no site monta de novo com o que está salvo, sem gastar modelo."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado || rodando} onClick={() => void aplicarNoSite()} data-aplicar-no-site="">
              {ocupado === "A montagem não entrou na fila" || (rodando && !parado) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Aplicar no site
            </button>
            <button type="button" className={botao.primario} disabled={!!ocupado} onClick={() => void salvarIntegracoes()} data-salvar-integracoes="">
              {ocupado === "As integrações não foram salvas" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
          </>
        }
      >
        <GradeDeGrupos colunas={2} larguraMinima={300}>
          <GrupoDeFuncoes titulo="WhatsApp flutuante" ajuda="Botão no canto da tela em todas as páginas; a mensagem vai pronta. Número com DDD.">
            <label className="flex cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2" checked={int.whatsapp.ligado} onChange={(e) => mudarInt("whatsapp", { ligado: e.target.checked })} />
              Ligado
            </label>
            <input value={int.whatsapp.numero || ""} onChange={(e) => mudarInt("whatsapp", { numero: e.target.value })} placeholder="(41) 99999-9999" inputMode="tel" className={campo} aria-label="Número do WhatsApp" />
            <CampoComIA
              rotulo="Mensagem"
              campo={{ chave: "integracoes.whatsapp.mensagem", rotulo: "Mensagem do WhatsApp", tipo: "texto", valorAtual: int.whatsapp.mensagem, maximo: 120, dica: "a primeira mensagem do visitante, curta e cordial" }}
              onAplicar={(v) => mudarInt("whatsapp", { mensagem: textoDoValor(v) })}
              onDesfazer={(a) => mudarInt("whatsapp", { mensagem: textoDoValor(a) })}
            >
              <input value={int.whatsapp.mensagem} onChange={(e) => mudarInt("whatsapp", { mensagem: e.target.value })} maxLength={200} className={campo} aria-label="Mensagem do WhatsApp" />
            </CampoComIA>
          </GrupoDeFuncoes>

          <GrupoDeFuncoes titulo="Formulário no CRM" ajuda="O contato cai em Comercial (commercial_leads, origem site), com a página de onde veio. A chave do formulário nasce ao ligar.">
            <label className="flex cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2" checked={int.formulario.ligado} onChange={(e) => mudarInt("formulario", { ligado: e.target.checked })} />
              Ligado{int.formulario.chave ? " · chave pronta" : ""}
            </label>
            <div className="flex flex-wrap">
              {CAMPOS_DO_FORMULARIO.map((c) => (
                <label key={c} className="mr-3 flex cursor-pointer items-center py-1 text-[13px]">
                  <input
                    type="checkbox"
                    className="mr-1.5"
                    checked={int.formulario.campos.indexOf(c) >= 0}
                    disabled={c === "nome"}
                    onChange={() => mudarInt("formulario", { campos: int.formulario.campos.indexOf(c) >= 0 ? int.formulario.campos.filter((x) => x !== c) : int.formulario.campos.concat([c]) })}
                  />
                  {ROTULO_DO_CAMPO[c]}
                </label>
              ))}
            </div>
            <input value={int.formulario.agradecimento} onChange={(e) => mudarInt("formulario", { agradecimento: e.target.value })} maxLength={200} className={campo} aria-label="Mensagem depois do envio" />
          </GrupoDeFuncoes>

          <GrupoDeFuncoes titulo="Pixel e GA4" ajuda="Só os IDs. O rastreio carrega depois do Aceitar do aviso de cookies; o formulário conta o Lead nos dois.">
            <input value={int.pixel_meta.id || ""} onChange={(e) => mudarInt("pixel_meta", { id: e.target.value.trim() || null })} placeholder="ID do pixel da Meta (só números)" inputMode="numeric" className={campo} aria-label="ID do pixel da Meta" />
            <input value={int.ga4.id || ""} onChange={(e) => mudarInt("ga4", { id: e.target.value.trim() || null })} placeholder="ID do GA4 (G-XXXXXXX)" className={campo} aria-label="ID do GA4" />
          </GrupoDeFuncoes>

          <GrupoDeFuncoes titulo="Mapa e cookies" ajuda="O mapa usa o endereço, sem chave de API. O aviso de cookies liga sozinho com pixel ou GA4.">
            <label className="flex cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2" checked={int.mapa.ligado} onChange={(e) => mudarInt("mapa", { ligado: e.target.checked })} />
              Mapa do Google
            </label>
            <input value={int.mapa.endereco} onChange={(e) => mudarInt("mapa", { endereco: e.target.value })} placeholder="Rua, número, bairro, cidade" maxLength={200} className={campo} aria-label="Endereço do mapa" />
            <label className="flex cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2" checked={int.cookies.ligado || !!int.pixel_meta.id || !!int.ga4.id} disabled={!!int.pixel_meta.id || !!int.ga4.id} onChange={(e) => mudarInt("cookies", { ligado: e.target.checked })} />
              Aviso de cookies (LGPD)
            </label>
            <input value={int.cookies.politica_url || ""} onChange={(e) => mudarInt("cookies", { politica_url: e.target.value.trim() || null })} placeholder="https://.../privacidade" className={campo} aria-label="Endereço da política de privacidade" />
          </GrupoDeFuncoes>
        </GradeDeGrupos>
      </Secao>

      <Secao
        titulo="SEO"
        descricao={seo.titulo ? `${contar(seo.titulo, 60)} · ${contar(seo.descricao, 155)}` : "Sem título"}
        ajuda="Título até 60 e descrição até 155 caracteres, a imagem de compartilhamento (og), a indexação e os dados do negócio que viram o schema LocalBusiness (sem endereço, vira Organization). O sitemap.xml e o robots.txt saem no build, com o domínio da Publicação. O ✨ preenche pelo contexto e pelo briefing; telefone, endereço e horário só das fontes."
        recolher="mesa-site:integracoes:seo"
        acao={
          <>
            <span className="mr-2 inline-flex">
              <PreencherComIA papel="site" clientId={clientId} marcaId={marca ? marca.id : null} campos={camposDoSeo} rotulo="Preencher o SEO" onAplicar={aplicarSeoDaIA} onDesfazer={aplicarSeoDaIA} />
            </span>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado} onClick={() => void salvarSeo()} data-salvar-seo="">
              {ocupado === "O SEO não foi salvo" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
            <button type="button" className={botao.primario} onClick={() => onIrPara("construcao")}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Título ({contar(seo.titulo, 60)})</span>
            <input value={seo.titulo} onChange={(e) => setSeo((s) => ({ ...s, titulo: e.target.value.slice(0, 60) }))} className={campo} aria-label="Título de SEO" />
          </label>
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Imagem de compartilhamento</span>
            <select value={seo.og_imagem || ""} onChange={(e) => setSeo((s) => ({ ...s, og_imagem: e.target.value || null }))} className={campo} aria-label="Imagem de compartilhamento">
              <option value="">A do hero (ou a logo)</option>
              {imagens.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Descrição ({contar(seo.descricao, 155)})</span>
          <textarea value={seo.descricao} onChange={(e) => setSeo((s) => ({ ...s, descricao: e.target.value.slice(0, 155) }))} rows={2} className={juntar(campoTexto, "min-h-[60px]")} aria-label="Descrição de SEO" />
        </label>
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <input value={seo.palavras.join(", ")} onChange={(e) => setSeo((s) => ({ ...s, palavras: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10) }))} placeholder="Palavras de busca, separadas por vírgula" className={campo} aria-label="Palavras de busca" />
          <label className="flex cursor-pointer items-center py-1 text-[13px]">
            <input type="checkbox" className="mr-2" checked={seo.indexar} onChange={(e) => setSeo((s) => ({ ...s, indexar: e.target.checked }))} />
            Liberado para o Google (sem isso, noindex e robots fechado)
          </label>
        </div>
        <div className="min-w-0 border-t border-border pt-3">
          <span className={juntar(texto.rotulo, "mb-2 block")}>Negócio (schema)</span>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <select value={seo.negocio.tipo} onChange={(e) => mudarNegocio({ tipo: e.target.value })} className={campo} aria-label="Tipo do negócio">
              {TIPOS_DE_NEGOCIO.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <input value={seo.negocio.nome} onChange={(e) => mudarNegocio({ nome: e.target.value })} placeholder="Nome do negócio" className={campo} aria-label="Nome do negócio" />
            <input value={seo.negocio.telefone || ""} onChange={(e) => mudarNegocio({ telefone: e.target.value })} placeholder="Telefone" inputMode="tel" className={campo} aria-label="Telefone do negócio" />
            <input value={seo.negocio.email || ""} onChange={(e) => mudarNegocio({ email: e.target.value })} placeholder="E-mail" inputMode="email" className={campo} aria-label="E-mail do negócio" />
            <input value={seo.negocio.rua} onChange={(e) => mudarNegocio({ rua: e.target.value })} placeholder="Rua e número" className={campo} aria-label="Rua e número" />
            <input value={seo.negocio.bairro} onChange={(e) => mudarNegocio({ bairro: e.target.value })} placeholder="Bairro" className={campo} aria-label="Bairro" />
            <input value={seo.negocio.cidade} onChange={(e) => mudarNegocio({ cidade: e.target.value })} placeholder="Cidade" className={campo} aria-label="Cidade" />
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <input value={seo.negocio.estado} onChange={(e) => mudarNegocio({ estado: e.target.value.toUpperCase().slice(0, 2) })} placeholder="UF" className={campo} aria-label="UF" />
              <input value={seo.negocio.cep} onChange={(e) => mudarNegocio({ cep: e.target.value })} placeholder="CEP" inputMode="numeric" className={campo} aria-label="CEP" />
            </div>
            <select value={seo.negocio.faixa_de_preco} onChange={(e) => mudarNegocio({ faixa_de_preco: e.target.value })} className={campo} aria-label="Faixa de preço">
              <option value="">Faixa de preço (opcional)</option>
              {["$", "$$", "$$$", "$$$$"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <textarea value={horario} onChange={(e) => setHorario(e.target.value)} rows={2} className={juntar(campoTexto, "min-h-[60px]")} placeholder="Horário, um por linha: Mo-Fr 09:00-18:00" aria-label="Horário de funcionamento" />
            <textarea value={redes} onChange={(e) => setRedes(e.target.value)} rows={2} className={juntar(campoTexto, "min-h-[60px]")} placeholder="Redes (https://...), uma por linha" aria-label="Redes sociais" />
          </div>
        </div>
      </Secao>
    </div>
  );
}
