// Feste Einstellungen. Keine Gesundheitsdaten, keine Medikamentennamen:
// die kommen zur Laufzeit aus konfig.json im OneDrive.

export const TESTMODUS = ["localhost", "127.0.0.1"].includes(location.hostname);

export const KONFIG = {
  // Tenant-ID. Öffentlich auffindbar, kein Geheimnis.
  tenant: "a649dc0e-02d4-4a47-b859-9c6a3c3ca285",
  // App-Registrierung "Hanna Erfassung" in Entra (SPA). Öffentlich, kein Geheimnis.
  clientId: "6fd81d59-c8eb-42cf-8007-8eae7b9223bc",
  scope: "openid offline_access https://graph.microsoft.com/Files.ReadWrite",
  // Ordner im Business-OneDrive, relativ zum Stamm
  basis: "AI_Projekte/bereiche/gesundheit/erfassung",
  graph: TESTMODUS ? `${location.origin}/graph/v1.0` : "https://graph.microsoft.com/v1.0",
};

export const redirectUri = () => new URL("./", location.href).href;
