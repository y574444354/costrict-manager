import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  // 读取 PORT，如果不存在则使用默认值 5003（与 .env.example 中的一致）
  const backendPort = env.PORT || 5003;
  // 读取前端端口，如果不存在则使用默认值 8080
  const frontendPort = env.FRONTEND_PORT || 8080;

  return {
    envDir: path.resolve(__dirname, ".."),
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: Number(frontendPort),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      assetsInlineLimit: 4096,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
        },
        output: {
          entryFileNames: "assets/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === "manifest.json") {
              return "manifest.json";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    worker: {
      rollupOptions: {
        output: {
          entryFileNames: "sw.js",
        },
      },
    },
  };
});
