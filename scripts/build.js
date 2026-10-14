// Prepara a pasta www/: copia as bibliotecas de node_modules para www/vendor
// (o app não depende de CDN, para funcionar offline e dentro do APK).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const copias = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'www/vendor/supabase.js'],
  // Leitura de nota fiscal (OCR no aparelho): Tesseract.js, só as variantes LSTM usadas pelo app.
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'www/vendor/tesseract/tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'www/vendor/tesseract/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'www/vendor/tesseract/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'www/vendor/tesseract/tesseract-core-lstm.wasm.js']
];

for (const [origem, destino] of copias) {
  const de = path.join(raiz, origem);
  const para = path.join(raiz, destino);
  if (!fs.existsSync(de)) {
    console.error('Arquivo não encontrado: ' + origem + '. Rode "npm install" primeiro.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
  console.log('copiado: ' + destino);
}

// Versão do app e endereços de atualização (vêm do package.json).
const pacote = require(path.join(raiz, 'package.json'));
const cc = pacote.compracerta || {};
fs.writeFileSync(path.join(raiz, 'www/js/versao.js'), '/* Gerado por scripts/build.js a partir do package.json. */\nwindow.CC_VERSAO = ' +
  JSON.stringify({ app: pacote.version, apkMinimo: cc.apkMinimo, urlAtualizacao: cc.urlAtualizacao, urlApk: cc.urlApk }, null, 2) + ';\n');
console.log('gerado: www/js/versao.js (versão ' + pacote.version + ')');

// Idioma português do OCR, já descompactado: o build do Android remove a extensão ".gz" dos
// arquivos (e descompacta), então o app usa o arquivo puro em todas as plataformas.
const zlib = require('zlib');
const idiomaGz = path.join(raiz, 'node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz');
const idioma = path.join(raiz, 'www/vendor/tesseract/lang/por.traineddata');
if (!fs.existsSync(idiomaGz)) {
  console.error('Arquivo não encontrado: ' + path.relative(raiz, idiomaGz) + '. Rode "npm install" primeiro.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(idioma), { recursive: true });
fs.writeFileSync(idioma, zlib.gunzipSync(fs.readFileSync(idiomaGz)));
fs.rmSync(idioma + '.gz', { force: true }); // versão compactada de builds anteriores
console.log('descompactado: www/vendor/tesseract/lang/por.traineddata');

// www/js/config.js não vai para o Git (repositório público).
// Na publicação automática (GitHub Actions), vem dos segredos SUPABASE_URL e SUPABASE_CHAVE;
// no computador, é criado a partir do exemplo e preenchido à mão.
const config = path.join(raiz, 'www/js/config.js');
const { SUPABASE_URL, SUPABASE_CHAVE } = process.env;
if (SUPABASE_URL && SUPABASE_CHAVE) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL)) {
    console.error('SUPABASE_URL inválida (esperado https://xxxx.supabase.co).');
    process.exit(1);
  }
  if (/^sb_secret_/.test(SUPABASE_CHAVE)) {
    console.error('SUPABASE_CHAVE é uma chave SECRETA: use a publicável (sb_publishable_...).');
    process.exit(1);
  }
  fs.writeFileSync(config, '/* Gerado automaticamente na publicação. */\nwindow.CC_CONFIG = ' +
    JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseChave: SUPABASE_CHAVE }, null, 2) + ';\n');
  console.log('criado: www/js/config.js (a partir de SUPABASE_URL / SUPABASE_CHAVE)');
} else if (!fs.existsSync(config)) {
  fs.copyFileSync(path.join(raiz, 'www/js/config.exemplo.js'), config);
  console.log('criado: www/js/config.js (a partir de config.exemplo.js)');
}
const texto = fs.readFileSync(config, 'utf8');
if (/supabaseUrl:\s*''/.test(texto)) {
  console.warn('Aviso: www/js/config.js ainda não tem a URL do Supabase. O app vai funcionar só no aparelho, sem nuvem.');
}
