// Rede do Android: o build de produção só fala HTTPS — a única exceção é o próprio aparelho (localhost/127.0.0.1), pra
// dar pra testar o APK de release contra o servidor de dev pelo túnel USB (adb reverse tcp:3000). Sem isso o release
// nega todo http:// e o app abre "vazio" (mapa sem gente, socket caindo) sem dizer por quê.
// Debug continua liberando HTTP pra qualquer host (o IP do PC na rede local): com um network security config presente,
// o android:usesCleartextTraffic do manifesto de debug é ignorado, então o debug ganha um XML próprio que libera tudo.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

const RELEASE_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- gerado por plugins/with-local-cleartext.js: produção só HTTPS; HTTP só pro próprio aparelho (adb reverse) -->
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

const DEBUG_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- gerado por plugins/with-local-cleartext.js: debug fala HTTP com o servidor de dev em qualquer endereço -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

module.exports = function withLocalCleartext(config) {
  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const src = path.join(c.modRequest.platformProjectRoot, 'app', 'src');
      write(path.join(src, 'main', 'res', 'xml', 'network_security_config.xml'), RELEASE_XML);
      for (const variant of ['debug', 'debugOptimized']) {
        write(path.join(src, variant, 'res', 'xml', 'network_security_config.xml'), DEBUG_XML);
      }
      return c;
    },
  ]);
};
