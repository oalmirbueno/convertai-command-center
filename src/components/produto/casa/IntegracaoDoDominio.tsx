import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, RefreshCw, Save } from "lucide-react";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import {
  conferirCloudflare,
  conferirZoho,
  guardarTokenZoho,
  salvarIntegracao,
  type ConferenciaDaCloudflare,
  type ConferenciaDoZoho,
  type DominioComIntegracao,
  type ItemConferido,
} from "@/lib/produto/email-pedidos";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, Secao, botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema";

const COR: Record<ItemConferido["situacao"], string> = {
  ok: "bg-accent-soft text-primary",
  alerta: "bg-warning-soft text-warning",
  falta: "bg-destructive/10 text-destructive",
};
const ROTULO: Record<ItemConferido["situacao"], string> = { ok: "Certo", alerta: "Atenção", falta: "Falta" };

export function lerConferencias(d: DominioComIntegracao): { cloudflare: ConferenciaDaCloudflare | null; zoho: ConferenciaDoZoho | null } {
  const i = (d.integracao || {}) as { cloudflare?: unknown; zoho?: unknown };
  const cf = i.cloudflare && typeof i.cloudflare === "object" && Array.isArray((i.cloudflare as { itens?: unknown }).itens) ? (i.cloudflare as ConferenciaDaCloudflare) : null;
  const zo = i.zoho && typeof i.zoho === "object" ? ({ avisos: [], ...(i.zoho as object) } as ConferenciaDoZoho) : null;
  return { cloudflare: cf, zoho: zo };
}

/**
 * A base de cada cliente nos provedores: a zona na Cloudflare da Aceleriq e a organização do Zoho do
 * cliente. Aqui ficam só os ids e o que a conferência leu; senha nunca. O token do Zoho vai direto para
 * o cofre (Vault) pela função produto-email e não volta para a tela.
 */
export default function IntegracaoDoDominio({ dominio, aoMudar }: { dominio: DominioComIntegracao; aoMudar: () => Promise<unknown> }) {
  const [f, setF] = useState({
    cloudflare_zona_id: dominio.cloudflare_zona_id || "",
    zoho_org_id: dominio.zoho_org_id || "",
    zoho_dc: dominio.zoho_dc || "com",
    zoho_admin: dominio.zoho_admin || "",
    zoho_plano: dominio.zoho_plano || "gratuito",
  });
  const [ocupado, setOcupado] = useState<"" | "salvar" | "cloudflare" | "zoho">("");
  const [pedindoToken, setPedindoToken] = useState(false);
  const { cloudflare, zoho } = lerConferencias(dominio);

  const salvar = async () => {
    setOcupado("salvar");
    try {
      await salvarIntegracao(dominio.id, {
        cloudflare_zona_id: f.cloudflare_zona_id.trim().toLowerCase(),
        zoho_org_id: f.zoho_org_id.trim(),
        zoho_dc: f.zoho_dc,
        zoho_admin: f.zoho_admin.trim().toLowerCase(),
        zoho_plano: f.zoho_plano,
      });
      toast.success("Integração salva.");
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
    } finally {
      setOcupado("");
    }
  };
  const conferir = async (onde: "cloudflare" | "zoho") => {
    setOcupado(onde);
    try {
      const r = onde === "cloudflare" ? await conferirCloudflare(dominio.id) : await conferirZoho(dominio.id);
      toast[r.ok ? "success" : "warning"](r.ok ? "Conferido: tudo certo." : "Conferido: veja o que falta.");
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível conferir agora."));
    } finally {
      setOcupado("");
    }
  };

  return (
    <Secao
      titulo="Integração"
      descricao={dominio.integracao_conferida_em ? `Conferida em ${diaLegivel(dominio.integracao_conferida_em, true)}` : "Ainda não conferida"}
      recolher="produto:email:integracao"
      ajuda="Cloudflare: a zona do cliente fica na conta da Aceleriq; a conferência lê os registros e aponta proxy ligado, MX, SPF duplicado, DKIM e DMARC. Zoho: uma conta por cliente; com o token guardado, a conferência lê as caixas, os apelidos e a verificação do domínio. Só leitura nos dois: nada muda o DNS nem as caixas."
    >
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Zona na Cloudflare" apoio="Vazio: a conferência acha pelo domínio e guarda">
          <input value={f.cloudflare_zona_id} onChange={(e) => setF({ ...f, cloudflare_zona_id: e.target.value })} className={campo} placeholder="id da zona (32 caracteres)" autoCapitalize="none" data-campo="zona" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Organização do Zoho" apoio="Vazio: a conferência descobre">
          <input value={f.zoho_org_id} onChange={(e) => setF({ ...f, zoho_org_id: e.target.value })} className={campo} placeholder="zoid" autoCapitalize="none" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Região do Zoho">
          <select value={f.zoho_dc} onChange={(e) => setF({ ...f, zoho_dc: e.target.value })} className={campo}>
            <option value="com">Estados Unidos (zoho.com)</option>
            <option value="eu">Europa (zoho.eu)</option>
            <option value="in">Índia (zoho.in)</option>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Plano do Zoho">
          <select value={f.zoho_plano} onChange={(e) => setF({ ...f, zoho_plano: e.target.value })} className={campo}>
            <option value="gratuito">Gratuito (até 5 caixas, sem IMAP)</option>
            <option value="lite">Mail Lite</option>
            <option value="premium">Mail Premium</option>
            <option value="workplace">Workplace</option>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Admin do Zoho" largo apoio="Só o endereço. A senha fica no cofre do cliente no painel.">
          <input value={f.zoho_admin} onChange={(e) => setF({ ...f, zoho_admin: e.target.value })} className={campo} placeholder={`admin@${dominio.dominio}`} autoCapitalize="none" />
        </CampoDeFormulario>
      </GrupoDeCampos>
      <div className="mt-1 flex flex-wrap items-center [&>*]:mr-2 [&>*]:mt-2">
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void salvar()} disabled={!!ocupado} data-salvar-integracao="">
          <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {ocupado === "salvar" ? "Salvando..." : "Salvar"}
        </button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void conferir("cloudflare")} disabled={!!ocupado} data-conferir-cloudflare="">
          <RefreshCw className={juntar("mr-1.5 h-4 w-4", ocupado === "cloudflare" && "animate-spin")} aria-hidden="true" />
          Conferir na Cloudflare
        </button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void conferir("zoho")} disabled={!!ocupado} data-conferir-zoho="">
          <RefreshCw className={juntar("mr-1.5 h-4 w-4", ocupado === "zoho" && "animate-spin")} aria-hidden="true" />
          Conferir no Zoho
        </button>
        <button type="button" className={botao.icone} onClick={() => setPedindoToken(true)} aria-label="Guardar o token do Zoho" title={dominio.zoho_conectado ? "Token do Zoho guardado. Trocar" : "Guardar o token do Zoho"}>
          <KeyRound className={juntar("h-4 w-4", dominio.zoho_conectado && "text-primary")} aria-hidden="true" />
        </button>
      </div>

      {cloudflare && (
        <div className="mt-4 min-w-0" data-conferencia-cloudflare="">
          <p className={juntar(texto.auxiliar, "mb-1")}>Cloudflare{cloudflare.status ? ` · zona ${cloudflare.status}` : ""}</p>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {cloudflare.itens.map((i) => (
              <li key={i.chave} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{i.texto}</span>
                <span className={juntar(etiqueta, "ml-2", COR[i.situacao])}>{ROTULO[i.situacao]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {zoho && (
        <div className="mt-4 min-w-0" data-conferencia-zoho="">
          <p className={juntar(texto.auxiliar, "mb-1")}>
            Zoho{zoho.usuarios != null ? ` · ${zoho.usuarios} de ${f.zoho_plano === "gratuito" ? 5 : "?"} caixas` : ""}{zoho.dominio ? ` · domínio ${zoho.dominio.verificado ? "verificado" : "sem verificação"}, DKIM ${zoho.dominio.dkim ? "certo" : "pendente"}` : ""}
          </p>
          {(zoho.caixas || []).length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {(zoho.caixas || []).map((c) => (
                <li key={c.endereco} className={lista.linha}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{c.endereco}</span>
                    {c.apelidos.length > 0 && <span className={juntar(texto.auxiliar, "block truncate")}>Apelidos: {c.apelidos.join(", ")}</span>}
                  </span>
                  {c.admin && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Admin</span>}
                </li>
              ))}
            </ul>
          )}
          {zoho.avisos.map((a) => <p key={a} className={juntar(texto.auxiliar, "mt-1")}>{a}</p>)}
        </div>
      )}
      {pedindoToken && <JanelaDoToken dominio={dominio} onFechar={() => setPedindoToken(false)} aoGuardar={aoMudar} />}
    </Secao>
  );
}

function JanelaDoToken({ dominio, onFechar, aoGuardar }: { dominio: DominioComIntegracao; onFechar: () => void; aoGuardar: () => Promise<unknown> }) {
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const guardar = async (valor: string) => {
    setSalvando(true);
    try {
      const ok = await guardarTokenZoho(dominio.id, valor);
      setToken("");
      toast.success(ok ? "Token guardado no cofre." : "Token apagado do cofre.");
      await aoGuardar();
      onFechar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível guardar."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo="Token do Zoho"
      ajuda="No console de API da Zoho (api-console.zoho.com), no app da Aceleriq, gere um refresh token na conta do cliente com os escopos de leitura ZohoMail.organization.accounts.READ, ZohoMail.organization.domains.READ e ZohoMail.partner.organization.READ. Ele vai direto para o cofre e não aparece de novo aqui."
      rodape={
        <>
          {dominio.zoho_conectado && (
            <button type="button" className={juntar(botao.secundario, "mr-auto")} onClick={() => void guardar("")} disabled={salvando}>
              Apagar do cofre
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void guardar(token)} disabled={salvando || !token.trim()}>
            {salvando ? "Guardando..." : "Guardar no cofre"}
          </button>
        </>
      }
    >
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={campo} placeholder="1000.xxxx.xxxx" autoComplete="off" aria-label="Refresh token do Zoho" />
    </JanelaCentral>
  );
}
