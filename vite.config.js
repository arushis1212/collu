import { defineConfig } from "vite";
import healthHandler from "./api/health.js";
import runHandler from "./api/run.js";

function localApi() {
  return {
    name: "collu-local-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const host = request.headers.host || "localhost";
        const url = new URL(request.url || "/", `http://${host}`);

        if (url.pathname === "/api/run") {
          await runHandler(request, response);
          return;
        }

        if (url.pathname === "/api/health") {
          healthHandler(request, response);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [localApi()],
});
