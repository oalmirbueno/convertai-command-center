import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Loader2, RefreshCw, Rocket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { type CartaoDeDns, REGISTRADORES, ROTULO_DO_DOMINIO, type EstadoDoDominio } from "../../../supabase/functions/_shared/dns-do-site";
import { CHAVES, chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";

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

/**
 * Etapa 8: publicação. Pelo painel, só vinculando o domínio: Vercel (deploy
 * no worker) e o cartão de DNS do registrador com os valores da API. Preparada
 * e desligada até haver a conta: sem a chave, "Baixar o site (zip)" e o que
 * falta. Publicar sempre com Confirmar.
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

  useEffect(() => {
    if (!e) return;
    setDominio(e.dominio || "");
    setRegistrador(e.registrador || "registro_br");
    // Só quando o estado chega do servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e && e.dominio, e && e.registrador]);

  const rodar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
    } catch (err) {
      avisarErro(err, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const salvarDominio = (novoRegistrador = registrador) =>
    rodar("O domínio não foi salvo", async () => {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", { site_id: site.id, publicacao: { dominio: dominio.trim() || null, registrador: novoRegistrador } });
      guardar(d.site);
    });

  const baixar = () =>
    rodar("O zip não saiu", async () => {
      const d = await chamarSite<{ zip: { path: string } | null; trabalho?: { id: string } }>("zip_pedir", { site_id: site.id });
      if (!d.zip) {
        toast.info("O motor está guardando o código. O zip aparece aqui em instantes.");
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

  return (
    <div className="min-w-0 space-y-6" data-etapa-publicacao="">
      <Secao
        titulo="Publicação"
        descricao={e ? (e.vercel_ligada ? ROTULO_DO_DOMINIO[e.estado] : "Publicação desligada") : undefined}
        ajuda="Publicar leva o site para a Vercel (a conta da agência) e liga o domínio do cliente. Só funciona com a chave VERCEL_TOKEN no cofre do servidor e no worker. Enquanto isso, baixe o site em zip: é um projeto Vite completo, pronto para qualquer hospedagem."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado} onClick={() => void baixar()} data-baixar-zip="">
              {ocupado === "O zip não saiu" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
              Baixar o site (zip)
            </button>
            <button type="button" className={botao.primario} disabled={!podePublicar || !!ocupado} onClick={() => setConfirmando(true)} title={e && e.faltas.length ? `Falta: ${e.faltas.join("; ")}` : undefined} data-publicar="">
              <Rocket className="mr-1 h-3.5 w-3.5" />
              Publicar
            </button>
          </>
        }
      >
        {e && e.faltas.length > 0 && (
          <div className="flex min-w-0 items-start" data-faltas-da-publicacao="">
            <span className={juntar(texto.auxiliar, "mr-1 min-w-0 flex-1 whitespace-normal")}>Falta: {e.faltas.join("; ")}.</span>
            <AjudaRecolhida rotulo="O que falta para publicar">
              A conta Vercel Pro da agência ainda não existe. Quando existir, a chave vai para o cofre do servidor (VERCEL_TOKEN e, se a conta for de time, VERCEL_TEAM_ID) e para o arquivo .env do worker. Até lá, o botão Publicar fica desligado e o zip resolve.
            </AjudaRecolhida>
          </div>
        )}
        {e && e.zip && <p className={texto.auxiliar}>Último código guardado: {dataEHora(e.zip.em)}</p>}
        {e && e.deploy_url && (
          <a className={juntar(texto.corpo, "text-primary underline")} href={e.deploy_url} target="_blank" rel="noopener noreferrer">
            {e.deploy_url}
          </a>
        )}
      </Secao>

      <Secao titulo="Domínio" descricao={e && e.dominio ? e.dominio : "Sem domínio"} recolher="mesa-site:publicacao:dominio">
        <form
          className="flex min-w-0 items-center"
          onSubmit={(ev) => {
            ev.preventDefault();
            void salvarDominio();
          }}
        >
          <input value={dominio} onChange={(ev) => setDominio(ev.target.value)} placeholder="cliente.com.br" className={juntar(campo, "mr-2 flex-1")} aria-label="Domínio do cliente" />
          <button type="submit" className={botao.secundario} disabled={!!ocupado}>
            Salvar
          </button>
        </form>
        <SeletorCompacto
          rotulo="Registrador do domínio"
          opcoes={REGISTRADORES.map((r) => ({ valor: r.id, rotulo: r.rotulo }))}
          valor={registrador}
          onEscolher={(v) => {
            setRegistrador(v);
            void salvarDominio(v);
          }}
          listaQuandoNaoCabe
        />
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
          <ul className="list-disc space-y-1 pl-5">
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
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publicar()}>Confirmar e publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
