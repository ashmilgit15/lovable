import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { CLERK_ENABLED } from "@/lib/clerkConfig";
import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  Code2,
  Cpu,
  Eye,
  Globe2,
  Layers,
  MousePointerClick,
  Rocket,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";

const featureCards = [
  {
    icon: Bot,
    title: "AI Pair Programmer",
    description:
      "Chat with your codebase in natural language. Generate, refactor, and debug React + TypeScript code with full project context awareness.",
    gradient: "from-cyan-500/20 to-blue-500/20",
  },
  {
    icon: Eye,
    title: "Instant Live Preview",
    description:
      "See every change rendered in real-time with Sandpack. Iterate visually before you commit — no more blind coding.",
    gradient: "from-emerald-500/20 to-teal-500/20",
  },
  {
    icon: Terminal,
    title: "Integrated Terminal",
    description:
      "Run npm scripts, install packages, and execute commands directly in your browser. A full development environment at your fingertips.",
    gradient: "from-violet-500/20 to-purple-500/20",
  },
  {
    icon: Code2,
    title: "Monaco Code Editor",
    description:
      "Full-featured in-browser code editing with syntax highlighting, IntelliSense, and version history for every file.",
    gradient: "from-orange-500/20 to-amber-500/20",
  },
  {
    icon: Layers,
    title: "Template Gallery",
    description:
      "Kickstart projects with 10+ professionally crafted templates — from SaaS dashboards to e‑commerce storefronts and portfolios.",
    gradient: "from-pink-500/20 to-rose-500/20",
  },
  {
    icon: Shield,
    title: "BYOK & Privacy-First",
    description:
      "Bring your own API keys with encrypted storage, or use local Ollama models. Your code and data never leave your control.",
    gradient: "from-sky-500/20 to-indigo-500/20",
  },
];

const howItWorks = [
  {
    step: "01",
    title: "Describe Your Vision",
    description: "Tell the AI what you want to build in plain English. Be as detailed or high-level as you like.",
    icon: MousePointerClick,
  },
  {
    step: "02",
    title: "Watch It Build",
    description: "See files generated in real-time with progress indicators, file-by-file updates, and auto-fix for errors.",
    icon: Braces,
  },
  {
    step: "03",
    title: "Iterate & Ship",
    description: "Refine with follow-up prompts, export your project, and deploy directly to Vercel or any host.",
    icon: Rocket,
  },
];

const stats = [
  { value: "10+", label: "Project Templates", detail: "From dashboards to storefronts" },
  { value: "React 19", label: "Modern Stack", detail: "TypeScript + Vite + TailwindCSS" },
  { value: "100%", label: "Privacy-First", detail: "BYOK or local Ollama models" },
  { value: "Real-time", label: "Live Preview", detail: "Sandpack-powered rendering" },
];

export default function Landing() {
  const ctaButton = (label: string, size: "default" | "lg" = "lg") =>
    CLERK_ENABLED ? (
      <>
        <SignedIn>
          <Link to="/dashboard">
            <Button size={size} className="btn-glow h-12 gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-400 hover:to-emerald-400 shadow-lg shadow-cyan-500/25 transition-all duration-300">
              {label} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <Button size={size} className="btn-glow h-12 gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-400 hover:to-emerald-400 shadow-lg shadow-cyan-500/25 transition-all duration-300">
              {label} <ArrowRight className="h-4 w-4" />
            </Button>
          </SignInButton>
        </SignedOut>
      </>
    ) : (
      <Link to="/dashboard">
        <Button size={size} className="btn-glow h-12 gap-2 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold hover:from-cyan-400 hover:to-emerald-400 shadow-lg shadow-cyan-500/25 transition-all duration-300">
          {label} <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    );

  return (
    <div className="app-shell relative flex min-h-screen flex-col text-foreground">
      {/* ─── Navbar ─── */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/8 bg-slate-950/60 px-6 backdrop-blur-2xl">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-500 p-1.5 shadow-lg shadow-cyan-500/30 animate-pulse-glow">
            <Zap className="h-4 w-4 fill-current text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-100">
            One<span className="gradient-text">Forge</span>
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">Features</a>
          <a href="#how-it-works" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">How It Works</a>
          <a href="#templates" className="text-sm text-slate-400 hover:text-slate-100 transition-colors">Templates</a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link to="/settings">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </Link>

          {CLERK_ENABLED ? (
            <>
              <SignedIn>
                <Link to="/dashboard">
                  <Button size="sm" className="gap-1.5 bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:from-cyan-400 hover:to-emerald-400 shadow-md shadow-cyan-500/20">
                    Open Studio <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </SignedIn>
              <SignedOut>
                <SignInButton mode="modal">
                  <Button size="sm" className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:from-cyan-400 hover:to-emerald-400 shadow-md shadow-cyan-500/20">
                    Sign In
                  </Button>
                </SignInButton>
              </SignedOut>
            </>
          ) : (
            <Link to="/dashboard">
              <Button size="sm" className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:from-cyan-400 hover:to-emerald-400 shadow-md shadow-cyan-500/20">
                Open Studio
              </Button>
            </Link>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* ─── Hero Section ─── */}
        <section className="relative px-6 pb-20 pt-20 sm:px-10 lg:px-14 overflow-hidden">
          {/* Extra decorative orbs */}
          <div className="absolute top-20 left-1/4 w-[500px] h-[500px] rounded-full bg-cyan-500/8 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-emerald-500/8 blur-[100px] pointer-events-none" />

          <div className="mx-auto max-w-5xl text-center">
            <div className="animate-float-up mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              <Cpu className="h-3.5 w-3.5" />
              AI-Powered Application Studio
            </div>

            <h1 className="animate-float-up stagger-1 mx-auto max-w-4xl text-4xl font-extrabold leading-[1.1] text-slate-100 sm:text-5xl lg:text-7xl">
              Turn ideas into{" "}
              <span className="gradient-text">production-ready</span>{" "}
              apps with AI
            </h1>

            <p className="animate-float-up stagger-2 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300/90 sm:text-xl">
              Describe what you want. Watch it build in real-time. Preview, iterate, and deploy — all from one workspace powered by AI.
            </p>

            <div className="animate-float-up stagger-3 mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              {ctaButton("Start Building — It's Free")}

              <Link to="/settings">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 border-slate-600/50 bg-slate-900/40 text-slate-200 hover:bg-slate-800/60 hover:border-slate-500/50 backdrop-blur-sm"
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  Configure Models
                </Button>
              </Link>
            </div>

            {/* Mini trust badges */}
            <div className="animate-float-up stagger-4 mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />
                <span>Privacy-first architecture</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />
                <span>Open-source LLM support</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Stats Bar ─── */}
        <section className="relative px-6 pb-16 sm:px-10 lg:px-14">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className={`animate-float-up stagger-${i + 1} glass-card rounded-xl p-5 text-center transition-transform duration-300 hover:scale-[1.02]`}
              >
                <p className="text-2xl font-bold gradient-text sm:text-3xl">{stat.value}</p>
                <p className="mt-1 text-sm font-semibold text-slate-200">{stat.label}</p>
                <p className="mt-1 text-xs text-slate-500">{stat.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Features Section ─── */}
        <section id="features" className="relative px-6 py-20 sm:px-10 lg:px-14">
          <div className="mx-auto max-w-6xl">
            <div className="mb-12 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">
                <ShieldCheck className="h-3.5 w-3.5" />
                Professional Workflow
              </div>
              <h2 className="text-3xl font-bold text-slate-100 sm:text-4xl">
                Everything you need to build,{" "}
                <span className="gradient-text">all in one place</span>
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
                From AI-powered code generation to real-time previews and deployment tooling — OneForge gives you a complete development workspace in your browser.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {featureCards.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    className={`animate-float-up stagger-${(i % 6) + 1} group glass-card rounded-xl p-6 transition-all duration-300 hover:border-cyan-300/25 hover:scale-[1.01]`}
                  >
                    <div className={`mb-5 inline-flex rounded-xl bg-gradient-to-br ${feature.gradient} p-3 ring-1 ring-white/10`}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-100">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.description}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── How It Works ─── */}
        <section id="how-it-works" className="relative px-6 py-20 sm:px-10 lg:px-14">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/[0.02] to-transparent pointer-events-none" />

          <div className="mx-auto max-w-5xl">
            <div className="mb-14 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">
                <Workflow className="h-3.5 w-3.5" />
                Simple Process
              </div>
              <h2 className="text-3xl font-bold text-slate-100 sm:text-4xl">
                From idea to deployment in{" "}
                <span className="gradient-text">three steps</span>
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {howItWorks.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.step}
                    className={`animate-float-up stagger-${i + 1} relative`}
                  >
                    {i < howItWorks.length - 1 && (
                      <div className="absolute right-0 top-12 hidden w-12 border-t border-dashed border-white/10 md:block translate-x-full" />
                    )}
                    <div className="glass-card rounded-2xl p-6 text-center transition-all duration-300 hover:border-emerald-300/20">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/15 to-emerald-500/15 ring-1 ring-white/10">
                        <Icon className="h-6 w-6 text-cyan-300" />
                      </div>
                      <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-400/70">{item.step}</div>
                      <h3 className="text-lg font-semibold text-slate-100">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── Templates Preview ─── */}
        <section id="templates" className="relative px-6 py-20 sm:px-10 lg:px-14">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
                <Sparkles className="h-3.5 w-3.5" />
                Starter Templates
              </div>
              <h2 className="text-3xl font-bold text-slate-100 sm:text-4xl">
                Launch faster with{" "}
                <span className="gradient-text">ready-made templates</span>
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
                Pick a template and start customizing with AI in seconds. Dashboards, storefronts, portfolios, and more.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {["SaaS Dashboard", "Landing Page", "E-commerce", "Blog", "Portfolio", "Admin Panel", "Todo App", "Chat App", "Kanban Board", "Analytics"].map((name, i) => (
                <div
                  key={name}
                  className={`animate-float-up stagger-${(i % 5) + 1} glass-card rounded-xl p-4 text-center transition-all duration-300 hover:scale-[1.04] hover:border-violet-300/25 cursor-default`}
                >
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-pink-500/15 ring-1 ring-white/10">
                    <Globe2 className="h-4 w-4 text-violet-300" />
                  </div>
                  <p className="text-xs font-semibold text-slate-200">{name}</p>
                </div>
              ))}
            </div>

            <div className="mt-10 text-center">
              {ctaButton("Explore All Templates", "lg")}
            </div>
          </div>
        </section>

        {/* ─── CTA Footer Section ─── */}
        <section className="relative px-6 py-24 sm:px-10 lg:px-14">
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/[0.04] to-transparent pointer-events-none" />

          <div className="mx-auto max-w-3xl text-center">
            <div className="glass-card mx-auto rounded-3xl p-10 sm:p-14 gradient-border">
              <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-500 p-3 shadow-lg shadow-cyan-500/25 animate-pulse-glow">
                <Zap className="h-7 w-7 fill-current text-white" />
              </div>

              <h2 className="text-3xl font-bold text-slate-100 sm:text-4xl">
                Ready to build something{" "}
                <span className="gradient-text">amazing</span>?
              </h2>

              <p className="mx-auto mt-4 max-w-lg text-base text-slate-400">
                Start with a prompt. Ship a product. OneForge handles the heavy lifting so you can focus on what matters — your vision.
              </p>

              <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                {ctaButton("Get Started Now")}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 border-t border-white/8 bg-slate-950/60 px-6 py-6 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-gradient-to-br from-cyan-400 to-emerald-500 p-1 shadow-md shadow-cyan-500/20">
              <Zap className="h-3 w-3 fill-current text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-300">
              One<span className="gradient-text">Forge</span>
            </span>
          </div>
          <p className="text-xs text-slate-500">
            AI-powered development with deployment-ready workflows. Built with ❤️
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <Link to="/settings" className="hover:text-slate-300 transition-colors">Settings</Link>
            <Link to="/dashboard" className="hover:text-slate-300 transition-colors">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
