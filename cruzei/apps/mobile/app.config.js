// Config do Expo: o app.json continua a fonte da verdade (o Expo passa o conteúdo dele em `config`); aqui só entra o
// que depende da máquina.
//
// Push FCM: o google-services.json do Firebase NÃO vai pro git (.gitignore); quem gera o build põe o arquivo NESTA
// pasta (apps/mobile/). O APK sai do ./gradlew sobre o android/ versionado, sem prebuild, então quem liga o Firebase
// é o próprio Gradle: o android/build.gradle só põe o classpath do com.google.gms:google-services se o arquivo
// existir, e o android/app/build.gradle copia ele pra android/app/ (cópia também fora do git) e aplica o plugin. Sem
// o arquivo, o build fica idêntico (nada novo baixado) e o push fica desligado (o registro do token só loga a falha).
// O package_name do arquivo tem que ser app.metch, senão o plugin do Google para o build.
// Canal padrão e cor dos avisos (plugin expo-notifications do app.json) já estão escritos no manifesto e no
// colors.xml versionados. O googleServicesFile abaixo só vale se alguém rodar o prebuild (ele reconhece o que já
// está no Gradle e não duplica).
const fs = require('fs');
const path = require('path');

const GOOGLE_SERVICES = './google-services.json';

module.exports = ({ config }) => {
  if (!fs.existsSync(path.join(__dirname, GOOGLE_SERVICES))) return config;
  return { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES } };
};
