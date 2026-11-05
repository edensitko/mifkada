import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = `http://127.0.0.1:${process.env.MIFKADA_PORT ?? 4777}`;
const WS = API.replace("http", "ws");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // לא לרוקן את dist לפני בנייה: החלון רץ ממנו בעדכון חם, ותיקייה ריקה באמצע בנייה נותנת 404.
  // קבצים ישנים שלא מופיעים ב-index.html החדש נמחקים אחרי הבנייה (scripts/prune-dist.mjs)
  build: { emptyOutDir: false },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.MIFKADA_WEB_PORT ?? 4778),
    strictPort: true,
    proxy: {
      "/api": API,
      "/ws": { target: WS, ws: true },
    },
    fs: { allow: [".."] },
  },
});
