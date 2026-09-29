// Config do Expo: o app.json continua a fonte da verdade (o Expo passa o conteúdo dele em `config`); aqui só entra o
// que depende da máquina. Push FCM: o google-services.json do Firebase NÃO vai pro git (.gitignore); quem gera o build
// põe o arquivo nesta pasta e o prebuild liga o plugin do Google no Gradle. Sem o arquivo, o app builda igual e o push
// fica desligado (o registro do token só loga a falha).
const fs = require('fs');
const path = require('path');

const GOOGLE_SERVICES = './google-services.json';

module.exports = ({ config }) => {
  if (!fs.existsSync(path.join(__dirname, GOOGLE_SERVICES))) return config;
  return { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES } };
};
