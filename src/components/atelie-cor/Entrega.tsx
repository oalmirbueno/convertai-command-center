import { useMemo, useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { PillTabs } from "@/components/ds";
import { botao, JanelaCentral, juntar, texto } from "@/components/sistema";
import { contraste, textoOklch } from "../../../supabase/functions/_shared/cores/oklch";
import { PESO_DO_PAPEL, ROTULO_DO_PAPEL, type Briefing, type Proposta } from "../../../supabase/functions/_shared/cores/paleta";
import { arquivoAse, htmlDeEmail, listaDeHex, temaDeEmail, tokensCss, tokensJson, tokensTailwind } from "../../../supabase/functions/_shared/cores/saidas";
import { baixar, nomeDeArquivo, type TextosDaIa } from "./api";
import { coresDaProposta, PostQuadrado, SiteHero } from "./Amostras";

type Aba = "apresentacao" | "mensagem" | "codigo" | "email" | "checklist";

const copiar = (t: string, aviso = "Copiado") => navigator.clipboard?.writeText(t).then(() => toast.success(aviso), () => toast.error("Não deu para copiar."));
const fmt = (n: number) => n.toFixed(2).replace(".", ",");

function mensagemDaRegra(b: Briefing, p: Proposta): string {
  const linhas = p.cores.map((c) => `• ${c.nome} (${c.hex}): ${ROTULO_DO_PAPEL[c.papel].toLowerCase()}, ${c.uso.charAt(0).toLowerCase()}${c.uso.slice(1)}`);
  return `Oi! Tudo bem? Preparei a paleta da ${b.marca || "marca"}.\n\nA direção que recomendo é "${p.titulo}".\n\n${linhas.join("\n")}\n\nNa prática: a primeira cor ocupa as áreas grandes, a segunda os apoios e o destaque aparece só nos botões e chamadas, para guiar o olhar. Separei também duas alternativas para você comparar. Me conta o que achou?`;
}

function checklistDaRegra(p: Proposta): string[] {
  const dom = p.cores.find((c) => c.papel === "dominante")!;
  const ap = p.cores.find((c) => c.papel === "apoio");
  const des = p.cores.find((c) => c.papel === "destaque");
  const D = des?.nome ?? "o destaque";
  return [
    `Logotipo: versão principal em ${ap?.nome ?? p.neutros.tinta} sobre ${dom.nome}; versão negativa em ${p.neutros.papel} sobre ${ap?.nome ?? dom.nome}.`,
    `Site: fundo em ${dom.nome}, cartões e seções em ${ap?.nome ?? "papel"}, botões e links em ${D}, texto em ${dom.texto}.`,
    `Posts: alterne fundos em ${dom.nome}${ap ? ` e ${ap.nome}` : ""}; ${D} só na palavra-chave ou no selo.`,
    `Stories e destaques: capa em ${ap?.nome ?? dom.nome} com ícone em ${dom.nome === ap?.nome ? p.neutros.tinta : dom.nome}.`,
    `Cartão de visita: frente em ${dom.nome}, verso em ${p.neutros.papel} com texto em ${p.neutros.tinta} e um fio em ${D}.`,
    `Embalagem e etiqueta: ${dom.nome} como cor de reconhecimento; ${D} em selos e informações de destaque.`,
    `Apresentações: capa em ${ap?.nome ?? dom.nome}, páginas internas em ${p.neutros.papel}, números e gráficos em ${D}.`,
    `Assinatura de e-mail: nome em ${p.neutros.tinta}, link em ${D} (ou no tom ajustado do tema de e-mail).`,
  ];
}

export default function Entrega({ aberta, onFechar, b, p, alternativas, textos }: { aberta: boolean; onFechar: () => void; b: Briefing; p: Proposta; alternativas: Proposta[]; textos: Partial<TextosDaIa> | null }) {
  const [aba, setAba] = useState<Aba>("apresentacao");
  const nome = nomeDeArquivo(`${b.marca}-${textos?.propostas?.[p.id]?.titulo || p.titulo}`);
  const ia = textos?.propostas?.[p.id];
  const mensagem = textos?.mensagem || mensagemDaRegra(b, p);
  const checklist = textos?.checklist?.length ? textos.checklist : checklistDaRegra(p);
  const tema = useMemo(() => temaDeEmail(p), [p]);
  const t = { marca: b.marca || "Sua marca", titulo: b.oferta ? b.oferta.split(/[.!?]/)[0].slice(0, 60) : "Sua marca em *destaque*", sub: b.publico || "Uma linha curta sobre o que a marca entrega.", botao: "Fale conosco" };

  const imprimir = () => {
    const el = document.getElementById("apresentacao-da-paleta");
    if (!el) return;
    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) { toast.error("O navegador bloqueou a janela. Libere pop-ups para salvar o PDF."); return; }
    const estilos = Array.from(document.querySelectorAll("style, link[rel=stylesheet]")).map((n) => n.outerHTML).join("\n");
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${b.marca} · paleta</title>${estilos}<style>@page{size:A4;margin:14mm}body{background:#fff!important;color:#111}.quebra{break-after:page}</style></head><body class="light">${el.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  };

  return (
    <JanelaCentral aberta={aberta} onFechar={onFechar} largura="xl" titulo={`Entregar: ${ia?.titulo || p.titulo}`} descricao="Tudo montado a partir da proposta escolhida.">
      <div className="space-y-5">
        <PillTabs variant="soft" label="Entregável" value={aba} onChange={(v) => setAba(v as Aba)} tabs={[
          { value: "apresentacao", label: "Apresentação" },
          { value: "mensagem", label: "Mensagem" },
          { value: "codigo", label: "Arquivos e código" },
          { value: "email", label: "Tema de e-mail" },
          { value: "checklist", label: "Checklist e posts" },
        ]} />

        {aba === "apresentacao" && (
          <div className="space-y-3">
            <div className="flex justify-end"><button type="button" className={botao.primario} onClick={imprimir}><Printer className="mr-1.5 h-4 w-4" />Salvar em PDF</button></div>
            <div id="apresentacao-da-paleta" className="space-y-8 rounded-lg border border-border bg-white p-8 text-[#111]">
              <section className="quebra space-y-3">
                <div className="text-[12px] uppercase tracking-[0.2em] text-[#666]">Paleta de cores</div>
                <h1 className="text-[34px] font-bold leading-tight">{b.marca}</h1>
                <p className="text-[15px]">{ia?.titulo || p.titulo}: {ia?.frase || p.frase}</p>
                <div className="flex h-40 overflow-hidden rounded-xl">{p.cores.map((c) => <div key={c.papel} style={{ flex: PESO_DO_PAPEL[c.papel], background: c.hex }} />)}</div>
              </section>
              <section className="quebra space-y-3">
                <h2 className="text-[20px] font-bold">Por que estas cores</h2>
                <p className="text-[14px] leading-6">{ia?.diagnostico || p.diagnostico}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {p.cores.map((c) => (
                    <div key={c.papel} className="overflow-hidden rounded-lg border border-[#ddd]">
                      <div className="h-20" style={{ background: c.hex }} />
                      <div className="space-y-1 p-3 text-[12px]">
                        <b className="text-[14px]">{c.nome}</b>
                        <div>{ROTULO_DO_PAPEL[c.papel]} · cerca de {PESO_DO_PAPEL[c.papel]}%</div>
                        <div className="font-mono">{c.hex} · {textoOklch(c.hex)}</div>
                        <p className="pt-1">{ia?.cores?.[c.papel] || c.porque}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="quebra space-y-3">
                <h2 className="text-[20px] font-bold">Aplicada</h2>
                <SiteHero c={coresDaProposta(p)} t={t} />
                <div className="grid grid-cols-2 gap-3"><PostQuadrado c={coresDaProposta(p)} t={t} /><PostQuadrado c={coresDaProposta(p)} t={t} formato="4:5" /></div>
              </section>
              <section className="quebra space-y-2">
                <h2 className="text-[20px] font-bold">Como usar</h2>
                <ul className="list-disc space-y-1 pl-5 text-[13px]">{p.orientacoes.map((o, i) => <li key={i}>{o}</li>)}</ul>
                <h3 className="pt-3 text-[15px] font-bold">Combinações de texto aprovadas</h3>
                <ul className="space-y-1 text-[13px]">{p.cores.map((c) => <li key={c.papel}><span className="rounded px-2 font-semibold" style={{ background: c.hex, color: c.texto }}>Aa</span> texto {c.texto} sobre {c.nome}: {fmt(c.razaoTexto)}:1</li>)}</ul>
              </section>
              {alternativas.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-[20px] font-bold">Outras direções</h2>
                  {alternativas.map((a) => (
                    <div key={a.id} className="space-y-1">
                      <b className="text-[14px]">{textos?.propostas?.[a.id]?.titulo || a.titulo}</b>
                      <div className="flex h-10 overflow-hidden rounded-md">{a.cores.map((c) => <div key={c.papel} style={{ flex: PESO_DO_PAPEL[c.papel], background: c.hex }} />)}</div>
                      <p className="text-[12px]">{textos?.propostas?.[a.id]?.diagnostico || a.diagnostico}</p>
                    </div>
                  ))}
                  <p className="pt-2 text-[12px] text-[#666]">Próximo passo: escolher a direção, aplicar na logo e nas primeiras peças e conferir em tela de celular.</p>
                </section>
              )}
            </div>
          </div>
        )}

        {aba === "mensagem" && (
          <div className="space-y-3">
            <textarea readOnly className="h-72 w-full rounded-md border border-input bg-card p-3 text-[13px] leading-6" value={mensagem} />
            <div className="flex justify-end gap-2">
              <button type="button" className={botao.primario} onClick={() => copiar(mensagem, "Mensagem copiada")}><Copy className="mr-1.5 h-4 w-4" />Copiar</button>
            </div>
            {!textos?.mensagem && <p className={texto.auxiliar}>Texto da regra. Para um texto escrito para este cliente, use "Escrever com IA".</p>}
          </div>
        )}

        {aba === "codigo" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={botao.secundario} onClick={() => baixar(`${nome}.ase`, arquivoAse(p, b.marca), "application/octet-stream")}><Download className="mr-1.5 h-4 w-4" />.ase (Adobe)</button>
              <button type="button" className={botao.secundario} onClick={() => baixar(`${nome}.css`, tokensCss(p), "text/css")}><Download className="mr-1.5 h-4 w-4" />CSS</button>
              <button type="button" className={botao.secundario} onClick={() => baixar(`${nome}.tailwind.css`, tokensTailwind(p), "text/css")}><Download className="mr-1.5 h-4 w-4" />Tailwind v4</button>
              <button type="button" className={botao.secundario} onClick={() => baixar(`${nome}.json`, tokensJson(p, b.marca), "application/json")}><Download className="mr-1.5 h-4 w-4" />JSON</button>
              <button type="button" className={botao.secundario} onClick={() => copiar(listaDeHex(p, b.marca), "Lista copiada")}><Copy className="mr-1.5 h-4 w-4" />HEX para Canva e Figma</button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/60 p-3 text-[11px] leading-5">{tokensCss(p)}</pre>
          </div>
        )}

        {aba === "email" && (
          <div className="space-y-4">
            <p className={texto.corpo}>Tema para e-mail marketing e assinatura, nas duas versões. O HTML já vem preparado para o modo escuro do Gmail, Outlook e Apple Mail.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["claro", "escuro"] as const).map((k) => {
                const v = tema[k];
                return (
                  <div key={k} className="space-y-2">
                    <div className={texto.rotulo}>{k === "claro" ? "Modo claro" : "Modo escuro"}</div>
                    <div className="space-y-1 text-[12px]">
                      {([["Fundo", v.fundo], ["Cartão", v.cartao], ["Cabeçalho", v.cabecalho], ["Texto", v.texto], ["Botão", v.botao], ["Link", v.link]] as const).map(([r, h]) => (
                        <div key={r} className="flex items-center gap-2"><span className="h-4 w-4 rounded border border-border" style={{ background: h }} /><span className="w-20">{r}</span><span className="font-mono">{h}</span></div>
                      ))}
                      <div className="pt-1 text-muted-foreground">Texto no cartão {fmt(contraste(v.texto, v.cartao))}:1 · botão no cartão {fmt(contraste(v.botao, v.cartao))}:1</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {tema.avisos.map((a) => <p key={a} className={juntar(texto.auxiliar, "text-warning")}>{a}</p>)}
            <button type="button" className={botao.secundario} onClick={() => baixar(`${nome}-email.html`, htmlDeEmail(p, { marca: b.marca, titulo: t.titulo.replace(/\*/g, ""), texto: t.sub, botao: t.botao, link: "https://", assinatura: `Equipe ${b.marca}` }), "text/html")}><Download className="mr-1.5 h-4 w-4" />Baixar modelo HTML</button>
          </div>
        )}

        {aba === "checklist" && (
          <div className="space-y-5">
            <div>
              <div className={juntar(texto.tituloSecao, "mb-2")}>Onde usar cada cor</div>
              <ul className="list-disc space-y-1 pl-5 text-[13px]">{checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
              <button type="button" className={juntar(botao.discreto, "mt-2")} onClick={() => copiar(checklist.join("\n"), "Checklist copiado")}><Copy className="mr-1.5 h-4 w-4" />Copiar</button>
            </div>
            <div>
              <div className={juntar(texto.tituloSecao, "mb-2")}>Ideias de post para o portfólio</div>
              {textos?.ideias?.length ? (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-[13px]">{textos.ideias.map((c, i) => <li key={i}>{c}</li>)}</ol>
                  <button type="button" className={juntar(botao.discreto, "mt-2")} onClick={() => copiar(textos.ideias!.join("\n"), "Ideias copiadas")}><Copy className="mr-1.5 h-4 w-4" />Copiar</button>
                </>
              ) : <p className={texto.auxiliar}>Use "Escrever com IA" para gerar as 8 ideias deste projeto.</p>}
            </div>
          </div>
        )}
      </div>
    </JanelaCentral>
  );
}
