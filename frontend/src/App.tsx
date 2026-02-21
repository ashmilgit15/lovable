import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import {
  SignedIn,
  SignedOut,
  RedirectToSignIn,
} from "@clerk/clerk-react";
import { useAuthSync } from "./hooks/useAuthSync";
import { CLERK_ENABLED } from "./lib/clerkConfig";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Builder from "./pages/Builder";
import Settings from "./pages/Settings";
import TodoApp from "./pages/TodoApp";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!CLERK_ENABLED) {
    return <>{children}</>;
  }

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function AuthSyncBridge() {
  useAuthSync();
  return null;
}

export default function App() {
  return (
    <div className="dark min-h-screen text-foreground font-sans antialiased selection:bg-cyan-400/30">
      {CLERK_ENABLED ? <AuthSyncBridge /> : null}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/todo" element={<TodoApp />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/builder/:projectId"
          element={
            <ProtectedRoute>
              <Builder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
      </Routes>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0c1220",
            border: "1px solid rgba(148, 163, 184, 0.24)",
            color: "#e2e8f0",
          },
          className: "font-sans",
        }}
      />
    </div>
  );
}
