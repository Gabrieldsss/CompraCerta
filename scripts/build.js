// Prepara a pasta www/: copia as bibliotecas de node_modules para www/vendor
// (o app não depende de CDN, para funcionar offline e dentro do APK).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const copias = [
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'www/vendor/supabase.js']
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

// www/js/config.js não vai para o Git (repositório público): é criado a partir do exemplo.
const config = path.join(raiz, 'www/js/config.js');
if (!fs.existsSync(config)) {
  fs.copyFileSync(path.join(raiz, 'www/js/config.exemplo.js'), config);
  console.log('criado: www/js/config.js (a partir de config.exemplo.js)');
}
const texto = fs.readFileSync(config, 'utf8');
if (/supabaseUrl:\s*''/.test(texto)) {
  console.warn('Aviso: www/js/config.js ainda não tem a URL do Supabase. O app vai funcionar só no aparelho, sem nuvem.');
}
