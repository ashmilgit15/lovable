import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/clerk-react";
import "./index.css";
import App from "./App";
import { CLERK_ENABLED, CLERK_PUBLISHABLE_KEY } from "./lib/clerkConfig";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

if (typeof window !== "undefined") {
  if (!CLERK_ENABLED) {
    console.warn(
      "Clerk is disabled because VITE_CLERK_PUBLISHABLE_KEY is missing. Running in local/no-auth mode."
    );
  }

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as
      | { type?: string; msg?: string; message?: string }
      | string
      | undefined;
    const text =
      typeof reason === "string"
        ? reason
        : reason?.msg || reason?.message || "";

    if (
      (typeof reason === "object" && reason?.type === "cancelation") ||
      text.toLowerCase().includes("operation is manually canceled")
    ) {
      event.preventDefault();
    }
  });
}

const appTree = (
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </BrowserRouter>
);

createRoot(document.getElementById("root")!).render(
  CLERK_ENABLED ? (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      {appTree}
    </ClerkProvider>
  ) : (
    appTree
  )
);
