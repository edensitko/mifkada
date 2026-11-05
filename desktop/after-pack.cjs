// electron-builder afterPack: מכבה את ה-fuse של RunAsNode, כדי שמשתנה ELECTRON_RUN_AS_NODE שדולף
// מהסביבה (טרמינל בתוך VS Code או Claude Code) לא יפעיל את האפליקציה כ-Node בלי חלון.
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

/** הקובץ שה-fuses נכתבים בו: ה-.app במק, ה-.exe ב-Windows, הבינארי (executableName) ב-Linux */
function binaryOf(ctx) {
  const name = ctx.packager.appInfo.productFilename;
  if (ctx.electronPlatformName === "darwin" || ctx.electronPlatformName === "mas") return path.join(ctx.appOutDir, `${name}.app`);
  if (ctx.electronPlatformName === "win32") return path.join(ctx.appOutDir, `${name}.exe`);
  return path.join(ctx.appOutDir, ctx.packager.executableName);
}

exports.default = async function afterPack(ctx) {
  await flipFuses(binaryOf(ctx), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: ctx.electronPlatformName === "darwin",
    // לא להריץ את האפליקציה כ-Node, לא לקבל NODE_OPTIONS (הזרקת קוד), לא לפתוח דיבאגר מבחוץ
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // עוגיות מוצפנות בדיסק (מפתח ב-Keychain), ובלי הרשאות יתר לקבצי file://
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  // macOS בלי תעודת Developer ID (identity: null, אין CSC_LINK): חתימה אד-הוק לכל החבילה. בלעדיה macOS על Apple Silicon
  // מסרב להפעיל את האפליקציה בשקט, גם מתוך dmg. כשיש תעודה, electron-builder חותם אחרי השלב הזה ודורס את האד-הוק
  if (ctx.electronPlatformName === "darwin" && !process.env.CSC_LINK && !process.env.CSC_NAME) {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", binaryOf(ctx)], { stdio: "inherit" });
  }
};
