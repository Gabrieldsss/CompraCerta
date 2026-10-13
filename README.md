# CompraCerta

## 📲 [Baixar o CompraCerta para Android (APK)](https://github.com/Gabrieldsss/CompraCerta/raw/main/download/CompraCerta.apk)

Versão 3.1.0 · 4,1 MB · Android 7 ou mais novo

**Como instalar:**

1. No celular, toque no link acima. O arquivo `CompraCerta.apk` é baixado.
2. Abra o arquivo baixado: pela notificação do download ou pelo app **Arquivos → Downloads**.
3. Se o Android pedir, toque em **Configurações** e permita **"instalar apps desta fonte"**. Depois volte e toque em **Instalar**.
4. Se o Google Play Protect avisar que o app é de desenvolvedor desconhecido, toque em **Mais detalhes → Instalar mesmo assim**. O aviso aparece porque o app não vem da Play Store.

Para atualizar, baixe e instale a versão nova por cima: seus dados continuam no aparelho.

---

Lista de compras de supermercado para Android. A pessoa monta a lista, registra o preço real de cada produto no mercado, marca o que já pegou e finaliza a compra. A partir da segunda compra, o app mostra estimativas com base no preço pago na compra concluída mais recente.

- **Funciona sem internet:** tudo é salvo primeiro no aparelho.
- **Cópia na nuvem (Supabase):** quando há conexão, as alterações são enviadas automaticamente. Sem login: cada aparelho é um usuário anônimo.
- **APK para Android 7 ou mais novo**, gerado com o Capacitor. A mesma pasta `www/` também funciona como site/PWA.

## 1. Configurar o Supabase (uma vez)

1. Crie uma conta e um projeto em <https://supabase.com> (o plano gratuito basta).
2. **Authentication → Sign In / Providers →** ligue **"Allow anonymous sign-ins"**.
3. **SQL Editor → New query:** cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
4. **Project Settings → API Keys:** copie a **Project URL** e a chave **publishable** (`sb_publishable_...`) ou, nos projetos antigos, a chave **anon**.
5. Cole as duas em `www/js/config.js`. O arquivo é criado pelo `npm run build` a partir de [`www/js/config.exemplo.js`](www/js/config.exemplo.js) e **não vai para o Git**, para as chaves não ficarem expostas no repositório público.

> Nunca coloque no app a chave **secret** / **service_role** nem a senha do banco. A chave publicável pode ir no app: quem protege os dados são as regras RLS do `schema.sql`, pelas quais cada usuário só lê e grava os próprios dados e as compras finalizadas não podem ser alteradas.

Recomendado: em **Authentication → Attack Protection**, ative um CAPTCHA para logins anônimos, para dificultar a criação de usuários em massa por robôs. O Supabase já limita esses logins a 30 por hora por IP.

## 2. Gerar o APK

Requisitos: Node.js 22 ou mais novo, Java 21 e Android SDK. Há duas formas de ter os dois últimos:

- **Android Studio** (<https://developer.android.com/studio>): instale com as opções padrão e abra-o uma vez para concluir o assistente ("Standard").
- **Só as ferramentas de linha de comando** (como neste computador), sem o editor:
  - JDK 21 da Microsoft, descompactado em `%LOCALAPPDATA%\Programs\jdk-21`;
  - Android SDK Command-line Tools, em `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`;
  - os pacotes `platform-tools`, `platforms;android-36` e `build-tools;35.0.0`, instalados com o `sdkmanager`.

O `npm run apk` encontra sozinho qualquer uma das duas instalações.

```bash
npm install
npm run apk
```

O APK sai em `dist/CompraCerta-<versão>-debug.apk`, com uma cópia em `download/CompraCerta.apk`. Essa cópia é a que vai para o GitHub e é usada pelo link de download do topo: para publicar uma versão nova, basta fazer commit e push dela. Na primeira vez, o Gradle baixa cerca de 1 GB e leva alguns minutos.

**Instalar no celular:** copie o APK para o aparelho (cabo USB, Google Drive, WhatsApp etc.), toque nele e permita "instalar apps desconhecidos" para o app usado na abertura. Para atualizar, instale a versão nova por cima: os dados são mantidos.

**Nova versão:** aumente `version` no `package.json` (ex.: `3.1.0` → `3.1.1`) antes do `npm run apk`. O número interno do Android (`versionCode`) é calculado a partir dela, e o celular só aceita atualizar para um número maior.

> É um APK de **depuração**, assinado com uma chave de teste. Ele serve para instalar nos seus aparelhos e nos da família. Para publicar na Google Play, é preciso gerar um pacote **assinado** (AAB) com uma chave própria. Guarde essa chave com segurança e fora do projeto.

## 3. Testar no computador

```bash
npm start        → http://localhost:8080
npm test         → 22 testes (regras de cálculo + sincronização com a nuvem)
```

## Como a nuvem funciona

- Cada alteração é gravada no aparelho na hora e enviada à nuvem cerca de 1,5 s depois, agrupando alterações seguidas.
- Sem internet, nada se perde: o envio é refeito quando a conexão volta, com novas tentativas automáticas.
- Compras finalizadas são enviadas uma única vez. O banco ignora repetições, então nunca há compra duplicada.
- Se os dados locais se corromperem, o app restaura tudo da nuvem ao abrir.
- A situação aparece no topo (☁ salvo / enviando / offline / erro) e em **Histórico → Cópia na nuvem**.

**Limite do modo sem login:** a cópia na nuvem fica ligada ao aparelho. Se o app for desinstalado ou os dados dele forem apagados, outro aparelho não consegue recuperá-la. Para trocar de celular, use **Histórico → Exportar dados** e **Importar dados**. Contas com e-mail, para sincronizar vários aparelhos, podem ser adicionadas depois: o Supabase permite transformar um usuário anônimo em conta com e-mail sem perder os dados.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `www/` | O app: `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js` |
| `www/js/core.js` | Regras de negócio: centavos, estimativas, finalização, migração |
| `www/js/nuvem.js` | Sincronização com o Supabase (primeiro no aparelho, depois na nuvem) |
| `www/js/app.js` | Interface |
| `www/js/config.js` | URL e chave publicável do Supabase |
| `www/vendor/` | supabase-js, copiado de `node_modules` pelo `npm run build` |
| `supabase/schema.sql` | Tabelas, regras RLS e a função `registrar_compra` |
| `android/` | Projeto Android gerado pelo Capacitor (ícones e tela de abertura já personalizados) |
| `capacitor.config.json` | Nome e ID do app (`com.compracerta.app`) |
| `scripts/` | `build.js` (prepara `www/`) e `apk.js` (gera o APK) |
| `tests/` | Testes automatizados |

O ID `com.compracerta.app` identifica o app no Android. Para publicar na Google Play, troque-o por um domínio seu **antes** da primeira publicação, porque depois ele não pode mais mudar.

## Regras principais

- Valores em **centavos inteiros**, sem erro de ponto flutuante. A quantidade aceita até 3 casas decimais (ex.: 1,5 kg).
- Preço vazio significa **"não informado"**, que é diferente de R$ 0,00. Itens sem preço não entram no total, e o total aparece como parcial.
- A estimativa usa o preço da **compra concluída mais recente** em que o produto teve preço.
- Nomes parecidos nunca são unificados sem confirmação.
- A compra finalizada guarda uma cópia dos itens e é somente leitura, no aparelho e no banco.

## Ainda não implementado

- Contas com e-mail, sincronização entre vários aparelhos e lista compartilhada pela família.
- Corrigir ou excluir uma compra já finalizada.
- Estimativa pela média das últimas compras.
- Versão para iPhone (o Capacitor permite, mas exige um Mac com Xcode).
