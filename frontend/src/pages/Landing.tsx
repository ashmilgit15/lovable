import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { CLERK_ENABLED } from "@/lib/clerkConfig";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Globe2,
  Rocket,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";

const featureCards = [
  {
    icon: Sparkles,
    title: "AI Pair Programmer",
    description:
      "Generate and refactor React + TypeScript code through chat with real project context.",
  },
  {
    icon: Globe2,
    title: "Live Product Feedback Loop",
    description:
      "Preview every change instantly and iterate before you commit to production deployment.",
  },
  {
    icon: Terminal,
    title: "Browser-Based DevOps",
    description:
      "Run installs, scripts, and release prep directly in the integrated terminal workspace.",
  },
];

const deployChecklist = [
  "Connect Clerk key and backend URL in environment variables.",
  "Run lint and production build directly from the workspace.",
  "Deploy frontend to Vercel/Netlify while pointing API to your FastAPI host.",
];

const quickFacts = [
  {
    label: "Provider Ready",
    value: "100%",
    detail: "Connect OpenAI-compatible providers and build with hosted models.",
  },
  {
    label: "Tech Stack",
    value: "React 19",
    detail: "Modern TypeScript + Vite frontend paired with FastAPI backend services.",
  },
  {
    label: "Deployment Focus",
    value: "Production",
    detail: "Designed for handoff: clean structure, settings controls, and export support.",
  },
];

export default function Landing() {
  return (
    <div className="app-shell relative flex min-h-screen flex-col text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-cyan-400 to-emerald-500 p-1.5 shadow-lg shadow-cyan-900/40">
            <Zap className="h-4 w-4 fill-current text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-100">
            one
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link to="/settings">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </Link>

          {CLERK_ENABLED ? (
            <>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="gap-1.5 bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                    Open Studio <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button size="sm" className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                    Sign In
                  </Button>
                </SignInButton>
              </SignedOut>
            </>
          ) : (
            <Link to="/dashboard">
              <Button size="sm" className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                Open Studio
              </Button>
            </Link>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 px-6 pb-16 pt-14 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl space-y-10">
          <section className="grid gap-8 lg:grid-cols-[1.25fr_0.9fr] lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
                <Cpu className="h-3.5 w-3.5" />
                AI Application Studio
              </div>

              <h1 className="max-w-3xl text-4xl font-bold leading-tight text-slate-100 sm:text-5xl lg:text-6xl">
                Build, polish, and deploy AI-generated products without leaving your browser.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                one turns prompts into production-grade code, gives you a live preview and terminal, and
                keeps your workflow deployment-ready.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                {CLERK_ENABLED ? (
                  <>
                    <SignedIn>
                      <Link to="/dashboard">
                        <Button size="lg" className="h-11 gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                          Launch Workspace <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </SignedIn>
                    <SignedOut>
                      <SignInButton mode="modal">
                        <Button size="lg" className="h-11 gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                          Start Building <ArrowRight className="h-4 w-4" />
                        </Button>
                      </SignInButton>
                    </SignedOut>
                  </>
                ) : (
                  <Link to="/dashboard">
                    <Button size="lg" className="h-11 gap-2 bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                      Launch Workspace <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                )}

                <Link to="/settings">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 border-slate-600/70 bg-slate-900/50 text-slate-100 hover:bg-slate-800/70"
                  >
                    Configure Models
                  </Button>
                </Link>
              </div>
            </div>

            <div className="panel-surface rounded-2xl border-white/15 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Rocket className="h-4 w-4 text-cyan-300" />
                Deployment Readiness Checklist
              </div>

              <div className="space-y-3">
                {deployChecklist.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <p className="text-sm leading-relaxed text-slate-300">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-100">
                Your frontend can deploy separately and connect to a hosted FastAPI backend using `VITE_BACKEND_URL`.
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {quickFacts.map((fact) => (
              <div key={fact.label} className="panel-surface rounded-xl p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{fact.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{fact.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{fact.detail}</p>
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-cyan-300" />
              <h2 className="text-2xl font-semibold text-slate-100">Professional Workflow Built In</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {featureCards.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className="group panel-surface rounded-xl border-white/10 p-5 transition-colors hover:border-cyan-300/35"
                  >
                    <div className="mb-4 inline-flex rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-2.5">
                      <Icon className="h-5 w-5 text-cyan-200" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-100">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{feature.description}</p>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-slate-950/60 px-6 py-5 text-center text-sm text-slate-400">
        <p>One | AI development with deployment-ready workflows</p>
      </footer>
    </div>
  );
}
