// בדיקות שרצות מתוך סשן של מפקדה יורשות את הסביבה של ה-daemon. דגלי המעטפת והשקע לא שייכים לבדיקות:
// MIFKADA_UI_SECRET_STDIN גורם לקריאה מ-stdin (התהליך לא יוצא), ו-MIFKADA_SOCKET מצביע על השקע של האפליקציה
for (const k of ["MIFKADA_UI_SECRET_STDIN", "MIFKADA_PARENT_STDIN", "MIFKADA_SOCKET"]) delete process.env[k];
process.env.MIFKADA_PROD_HOSTS = "prod-server,203.0.113.10";
