import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { type CartaoDeDns, normalizarDominio, REGISTRADORES, ROTULO_DO_DOMINIO, type EstadoDoDominio } from "../../../supabase/functions/mesa-site/modulos/dns-do-site";
import { ehAberto } from "../../../supabase/functions/_shared/motor-codigo";
import { chamarSite, CHAVES, type LinhaDoSite, trabalhosDeCodigo, useGuardarSite, useTrabalhos } from "./siteApi";
import { useChecklistDoSite } from "./ChecklistDeLancamento";
import { pendentesObrigatorios } from "../../../supabase/functions/_shared/site-lancamento";
import { useBarraDaEtapa } from "./BarraDaEtapa";
// Frente CUS (01/10): o navegador do agente confere o site publicado (prints, velocidade e links quebrados).
import { BotaoDoNavegador, TarefasDoNavegador } from "@/components/agentes/NavegadorDoAgente";

type Estado = {
  vercel_ligada: boolean;
  faltas: string[];
  dominio: string | null;
  registrador: string;
  cartao: CartaoDeDns | null;
  estado: EstadoDoDominio;
  deploy_url: string | null;
  zip: { path: string; em: string | null } | null;
};

/** "Falta:" em palavras da equipe: o item da chave da Vercel vira "a conta de publicação da agência" (o técnico fica no "?"). */
export const faltaNaTela = (f: string) => (/VERCEL_TOKEN/.test(f) ? "a conta de publicação da agência" : f);

/**
 * Etapa 8: publicação. Pelo painel, só vinculando o domínio: Vercel (deploy
 * no worker) e o cartão de DNS do registrador com os valores da API. Preparada
 * e desligada até haver a conta: sem a chave, "Baixar o site (zip)" e o que
 * falta. Publicar sempre com Confirmar.
 * UXS 30/09: o zip é um fluxo que termina (acompanha o trabalho "zip" e troca
 * para "Baixar agora" quando fica pronto); o domínio grava ao sair do campo e
 * no Enter, só quando muda; esqueleto na primeira leitura e erro com "Tentar
 * de novo". É a última etapa: a barra só tem o Voltar.
 */
export default function EtapaPublicacao({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const estadoQ = useQuery({ queryKey: CHAVES.publicacao(site.id), queryFn: () => chamarSite<Estado>("publicacao_estado", { site_id: site.id }) });
  const e = estadoQ.data;
  const [dominio, setDominio] = useState("");
  const [registrador, setRegistrador] = useState("registro_br");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const trabalhosQ = useTrabalhos(clientId, site.id);
  // SPV: só os trabalhos de código (a edição da prévia esperando não é montagem na fila).
  const trabalhos = trabalhosQ.data ? trabalhosDeCodigo(trabalhosQ.data.trabalhos) : [];
  const checklist = useChecklistDoSite(site, trabalhos);
  const pendentes = pendentesObrigatorios(checklist);
  // Uma gravação da publicação por vez: o servidor troca o JSON inteiro, e duas juntas desfariam uma delas.
  const gravando = useRef<Promise<unknown>>(Promise.resolve());

  // O zip pelo trabalho do motor (sobrevive a sair e voltar da etapa).
  const zipAberto = trabalhos.find((t) => t.tipo === "zip" && ehAberto(t.estado)) || null;
  const ultimoZip = trabalhos.find((t) => t.tipo === "zip") || null;
  const zipPronto = !!(e && e.zip) && !zipAberto;
  const zipFalhou = !zipAberto && !!ultimoZip && (ultimoZip.estado === "falhou" || ultimoZip.estado === "parado" || ultimoZip.estado === "cancelado");
  const motorDesligado = !!zipAberto && !!trabalhosQ.data && !trabalhosQ.data.vivo;
  const zipVisto = useRef<string | null>(null);
  // Pediu o zip nesta visita: quando ficar pronto, o botão vira "Baixar agora".
  const [pediuZip, setPediuZip] = useState(false);

  useEffect(() => {
    if (!e) return;
    setDominio(e.dominio || "");
    setRegistrador(e.registrador || "registro_br");
    dominioPedido.current = null;
    // Só quando o estado chega do servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e && e.dominio, e && e.registrador]);

  // O zip que ficou pronto: relê a publicação (o botão vira "Baixar agora"; o download sai do clique).
  useEffect(() => {
    if (!pediuZip || !ultimoZip || ultimoZip.estado !== "feito" || zipVisto.current === ultimoZip.id) return;
    zipVisto.current = ultimoZip.id;
    void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
  }, [pediuZip, ultimoZip && ultimoZip.id, ultimoZip && ultimoZip.estado, qc, site.id]);

  const rodar = async (rotulo: string, fn: () => Promise<void>): Promise<boolean> => {
    setOcupado(rotulo);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
      return true;
    } catch (err) {
      avisarErro(err, rotulo);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  /** Grava na fila (uma de cada vez). Com o domínio: só quando mudou (salvar o domínio zera o DNS vindo da Vercel). */
  const gravarPublicacao = (publicacao: Record<string, unknown>, rotulo: string): Promise<boolean> => {
    const vez = gravando.current.then(() =>
      rodar(rotulo, async () => {
        const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", { site_id: site.id, publicacao });
        guardar(d.site);
      }),
    );
    gravando.current = vez.catch(() => undefined);
    return vez;
  };
  // O domínio que já foi pedido (Enter e depois sair do campo não gravam duas vezes).
  const dominioPedido = useRef<{ valor: string | null } | null>(null);
  const salvarDominio = () => {
    const novo = dominio.trim() ? normalizarDominio(dominio) : null;
    const base = dominioPedido.current ? dominioPedido.current.valor : e ? e.dominio : null;
    if (dominio.trim() && !novo) {
      avisarErro(new Error("Esse domínio não parece válido. Ex.: cliente.com.br"), "O domínio não foi salvo");
      return;
    }
    if (novo === base) return;
    dominioPedido.current = { valor: novo };
    void gravarPublicacao({ dominio: novo }, "O domínio não foi salvo").then((ok) => {
      if (!ok) dominioPedido.current = null;
    });
  };
  const salvarRegistrador = (v: string) => {
    setRegistrador(v);
    // Só o registrador: mandar o domínio junto zeraria a configuração do DNS.
    void gravarPublicacao({ registrador: v }, "O registrador não foi salvo");
  };

  const baixar = () =>
    rodar("O zip não saiu", async () => {
      const d = await chamarSite<{ zip: { path: string } | null; trabalho?: { id: string }; ja_na_fila?: boolean; motor_ligado?: boolean }>("zip_pedir", { site_id: site.id });
      if (!d.zip) {
        // O useTrabalhos só relê de 4 em 4 s quando já vê um trabalho aberto: relê agora.
        // O estado (guardando, motor desligado, pronto) vem da lista de trabalhos, na linha da seção.
        setPediuZip(true);
        void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
        return;
      }
      const { data, error } = await supabase.storage.from("mesa").createSignedUrl(d.zip.path, 600, { download: `${site.projeto}.zip` });
      if (error || !data) throw error || new Error("Link do zip indisponível");
      window.location.assign(data.signedUrl);
    });

  const verificar = () => rodar("A verificação falhou", async () => void (await chamarSite("dominio_verificar", { site_id: site.id })));
  const publicar = () =>
    rodar("A publicação não entrou na fila", async () => {
      await chamarSite("publicar", { site_id: site.id, confirmar: true });
      toast.success("Publicação na fila do motor.");
    });

  const copiar = (v: string) => {
    try {
      void navigator.clipboard.writeText(v);
      toast.success("Copiado");
    } catch {
      /* navegador sem área de transferência */
    }
  };

  const podePublicar = !!e && e.vercel_ligada && !e.faltas.length;
  const faltas = e ? e.faltas.map(faltaNaTela) : [];

  useBarraDaEtapa({ estado: e ? (e.vercel_ligada ? ROTULO_DO_DOMINIO[e.estado] : "Publicação desligada") : null });

  // Primeira leitura: esqueleto; erro sem dado nenhum: o que houve e "Tentar de novo". Depois, o dado velho fica na tela.
  if (!e && estadoQ.isLoading) return <Carregando forma="lista" linhas={3} rotulo="Lendo a publicação" />;
  if (!e && estadoQ.isError)
    return (
      <EstadoDeErro
        titulo="A publicação não foi lida."
        acao={
          <button type="button" className={botao.discreto} onClick={() => void estadoQ.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );

  return (
    <div className="min-w-0 space-y-6" data-etapa-publicacao="">
      <Secao
        titulo="Publicação"
        descricao={motorDesligado ? "Motor desligado: o zip sai quando ele voltar" : e ? (e.vercel_ligada ? ROTULO_DO_DOMINIO[e.estado] : "Publicação desligada") : undefined}
        ajuda="Publicar leva o site para a Vercel (a conta da agência) e liga o domínio do cliente. Só funciona com a chave VERCEL_TOKEN no cofre do servidor e no worker. Enquanto isso, baixe o site em zip: é um projeto Vite completo, pronto para qualquer hospedagem."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado || !!zipAberto} onClick={() => void baixar()} data-baixar-zip="">
              {ocupado === "O zip não saiu" || zipAberto ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
              {zipAberto ? "Guardando o código" : pediuZip && zipPronto ? "Baixar agora" : "Baixar o site (zip)"}
            </button>
            <button type="button" className={botao.primario} disabled={!podePublicar || !!ocupado} onClick={() => setConfirmando(true)} title={faltas.length ? `Falta: ${faltas.join("; ")}` : undefined} data-publicar="">
              <Rocket className="mr-1 h-3.5 w-3.5" />
              Publicar
            </button>
          </>
        }
      >
        {faltas.length > 0 && (
          <div className="flex min-w-0 items-start" data-faltas-da-publicacao="">
            <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 whitespace-normal")}>Falta: {faltas.join("; ")}.</span>
            <AjudaRecolhida rotulo="O que falta para publicar">
              A conta Vercel Pro da agência ainda não existe. Quando existir, a chave vai para o cofre do servidor (VERCEL_TOKEN e, se a conta for de time, VERCEL_TEAM_ID) e para o arquivo .env do worker. Até lá, o botão Publicar fica desligado e o zip resolve.
            </AjudaRecolhida>
          </div>
        )}
        {pediuZip && zipFalhou && ultimoZip && <p className={juntar(texto.auxiliar, "text-destructive")}>O último pedido do zip ficou {ultimoZip.estado === "falhou" ? "com falha" : ultimoZip.estado}: peça de novo.</p>}
        {e && e.zip && <p className={texto.auxiliar}>Último código guardado: {dataEHora(e.zip.em)}</p>}
        {e && e.deploy_url && (
          <a className={juntar(texto.corpo, "text-primary underline")} href={e.deploy_url} target="_blank" rel="noopener noreferrer">
            {e.deploy_url}
          </a>
        )}
      </Secao>

      <Secao titulo="Domínio" descricao={e && e.dominio ? e.dominio : "Sem domínio"} recolher="mesa-site:publicacao:dominio">
        {/* Grava ao sair do campo e no Enter, como o registrador: um jeito só. */}
        <form
          className="flex min-w-0 items-center"
          onSubmit={(ev) => {
            ev.preventDefault();
            salvarDominio();
          }}
        >
          <input value={dominio} onChange={(ev) => setDominio(ev.target.value)} onBlur={salvarDominio} placeholder="cliente.com.br" className={juntar(campo, "mr-2 flex-1")} aria-label="Domínio do cliente" disabled={ocupado === "O domínio não foi salvo"} />
          {ocupado === "O domínio não foi salvo" || ocupado === "O registrador não foi salvo" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Salvando" /> : null}
        </form>
        <SeletorCompacto rotulo="Registrador do domínio" opcoes={REGISTRADORES.map((r) => ({ valor: r.id, rotulo: r.rotulo }))} valor={registrador} onEscolher={salvarRegistrador} listaQuandoNaoCabe />
        {e && (e.dominio || e.deploy_url) && (
          <div className="min-w-0 pt-2" data-conferir-site-publicado="">
            <BotaoDoNavegador caso="conferir_site" clientId={clientId} origem="mesa_site" url={e.dominio ? `https://${e.dominio}/` : String(e.deploy_url)} rotulo="Conferir o site no ar" compacto />
          </div>
        )}
        <TarefasDoNavegador clientId={clientId} origem="mesa_site" titulo="Conferências do site publicado" casos={["conferir_site"]} />
      </Secao>

      {e && e.cartao && (
        <Secao
          titulo="Registros de DNS"
          descricao={ROTULO_DO_DOMINIO[e.estado]}
          ajuda="Crie estes registros no painel do registrador. Os valores vêm da Vercel quando o site é publicado; a propagação leva de minutos a algumas horas. Verificar consulta a Vercel de novo."
          acao={
            e.vercel_ligada ? (
              <button type="button" className={botao.secundario} disabled={!!ocupado} onClick={() => void verificar()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Verificar
              </button>
            ) : null
          }
        >
          <p className={texto.auxiliar}>Onde: {e.cartao.onde}</p>
          <ul className={juntar(lista.aberta, lista.divisoria)} data-cartao-dns={e.cartao.registrador}>
            {e.cartao.registros.map((r, i) => (
              <li key={i} className={lista.linha}>
                <span className={juntar(etiqueta, "mr-2 w-14 justify-center bg-muted")}>{r.tipo}</span>
                <span className={juntar(texto.corpo, "mr-3 w-24 shrink-0 truncate font-medium")}>{r.nome}</span>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", !r.valor && "text-muted-foreground")}>{r.valor || "aparece quando a Vercel responder"}</span>
                {r.apoio && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{r.apoio}</span>}
                {r.valor && (
                  <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Copiar ${r.tipo} ${r.nome}`} onClick={() => copiar(String(r.valor))}>
                    <Copy className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {/* Os cuidados continuam à vista, uma linha cada. */}
          <ul className="list-disc space-y-0.5 pl-5">
            {e.cartao.cuidados.map((c) => (
              <li key={c} className={juntar(texto.auxiliar, "whitespace-normal")}>
                {c}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar o site?</AlertDialogTitle>
            <AlertDialogDescription>
              O motor faz o build e publica na Vercel{e && e.dominio ? `, ligando ${e.dominio}` : ""}. O site fica público. Dá para publicar de novo depois de cada ajuste.
              {pendentes.length ? ` Ainda falta no checklist: ${pendentes.map((p) => p.rotulo.toLowerCase()).join("; ")}.` : " O checklist obrigatório está completo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publicar()}>{pendentes.length ? "Publicar mesmo assim" : "Confirmar e publicar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
