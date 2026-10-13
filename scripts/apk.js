// Gera o APK de instalação (debug) do CompraCerta.
// Requisitos: "npm install" feito e Android Studio instalado (ele traz o Java e o Android SDK).
// Uso: npm run apk
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const android = path.join(raiz, 'android');
const versao = require(path.join(raiz, 'package.json')).version;

function falhar(msg) {
  console.error('\nERRO: ' + msg);
  process.exit(1);
}

function rodar(comando, args, opcoes) {
  console.log('\n> ' + comando + ' ' + args.join(' '));
  const r = spawnSync(comando, args, Object.assign({ stdio: 'inherit', shell: process.platform === 'win32' }, opcoes));
  if (r.status !== 0) falhar('o comando acima terminou com erro (código ' + r.status + ').');
}

const primeiroQueExiste = lista => lista.filter(Boolean).find(p => fs.existsSync(p));

// Java: primeiro o que vem com o Android Studio (pasta "jbr", versão certa para o Gradle);
// depois o JAVA_HOME já configurado (precisa ser JDK 17 ou mais novo).
const javaHome = primeiroQueExiste([
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
  process.env.JAVA_HOME
].filter(p => p && fs.existsSync(path.join(p, 'bin'))));
if (!javaHome) falhar('Java não encontrado. Instale o Android Studio (https://developer.android.com/studio) e abra-o uma vez para concluir a instalação.');

// Android SDK: instalado pelo assistente do Android Studio.
const sdk = primeiroQueExiste([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
  path.join(process.env.HOME || '', 'Library', 'Android', 'sdk'),
  path.join(process.env.HOME || '', 'Android', 'Sdk')
]);
if (!sdk) falhar('Android SDK não encontrado. Abra o Android Studio e conclua o assistente inicial ("Standard"), que baixa o SDK.');

console.log('Java:        ' + javaHome);
console.log('Android SDK: ' + sdk);
fs.writeFileSync(path.join(android, 'local.properties'), 'sdk.dir=' + sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:') + '\n');

const env = Object.assign({}, process.env, {
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  PATH: path.join(javaHome, 'bin') + path.delimiter + process.env.PATH
});

rodar('node', [path.join('scripts', 'build.js')], { cwd: raiz, env });
rodar('npx', ['cap', 'sync', 'android'], { cwd: raiz, env });
rodar(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--console=plain'], { cwd: android, env });

const gerado = path.join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(gerado)) falhar('o Gradle terminou, mas o APK não foi encontrado em ' + gerado);
fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
const destino = path.join(raiz, 'dist', 'CompraCerta-' + versao + '-debug.apk');
fs.copyFileSync(gerado, destino);
console.log('\nAPK pronto: ' + destino + ' (' + (fs.statSync(destino).size / 1048576).toFixed(1) + ' MB)');
