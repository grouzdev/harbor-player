import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./styles.css";
import "./desktop";
import { installTextInputTabNavigation } from "./text-input-tab-navigation";
import {
  installSessionPersistence,
  loadWorkspaceSession,
} from "./workspace-session";

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
installTextInputTabNavigation();
await loadWorkspaceSession();
installSessionPersistence();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  void window.harborPlayerDesktop?.reportClientReady();
});
