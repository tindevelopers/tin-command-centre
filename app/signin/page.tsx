import { requestReset, resetPassword, signIn } from "./actions";

const input = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const button = "w-full min-h-10 rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600";

function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <path d="M16 4v6M16 22v6M4 16h6M22 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const points = [
  ["Declared", "Admins record what should be true: projects, owners, versions."],
  ["Observed", "A collector measures what is actually deployed and healthy."],
  ["Drift", "The gap between the two, flagged before it becomes an incident."],
];

/** The front page: the Command Center's identity on the left, sign-in on the right. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative hidden flex-col justify-between bg-[#0A110E] p-12 text-[#E8EFEA] lg:flex">
        <div className="flex items-center gap-3 text-[#3DDC97]">
          <Mark />
          <span className="text-lg font-semibold tracking-wide text-[#E8EFEA]">TIN Command Center</span>
        </div>
        <div className="max-w-lg">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#3DDC97]">command.tinconnect.com</p>
          <h2 className="mt-4 text-5xl font-bold leading-[1.05] tracking-tight">Everything TIN runs, in one place.</h2>
          <p className="mt-5 text-lg leading-relaxed text-[#A8B8AE]">Every hub, package, app and cell, who owns it, and whether what is deployed matches what you declared.</p>
          <dl className="mt-10 space-y-5">
            {points.map(([term, text]) => (
              <div key={term} className="flex gap-4">
                <dt className="w-20 flex-none font-mono text-xs uppercase tracking-wider text-[#3DDC97]">{term}</dt>
                <dd className="text-sm leading-relaxed text-[#A8B8AE]">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-[#8DA096]">Access is by invitation.</p>
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3 text-brand-500 lg:hidden">
            <Mark />
            <span className="text-base font-semibold text-gray-800 dark:text-white/90">TIN Command Center</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { step = "signin", error, email = "", notice } = await searchParams;
  return (
    <Frame>
      <div>
        <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Signing in alone grants nothing: your account must also be an active operator.</p>
      </div>
      {notice === "password-set" && <p role="status">Password set. Sign in below.</p>}
      {error && <p role="alert" className="text-error-500">{error}</p>}

      {step === "forgot" && (
        <form action={requestReset} className="space-y-3">
          <input suppressHydrationWarning className={input} name="email" type="email" autoComplete="email" placeholder="Email" defaultValue={email} required />
          <button className={button}>Email me a code</button>
        </form>
      )}
      {step === "reset" && (
        <form action={resetPassword} className="space-y-3">
          <input type="hidden" name="email" value={email} />
          <p>Enter the code sent to {email} and choose a new password.</p>
          <input suppressHydrationWarning className={input} name="otp" inputMode="numeric" autoComplete="one-time-code" placeholder="Code" required />
          <input suppressHydrationWarning className={input} name="password" type="password" autoComplete="new-password" placeholder="New password (12+ characters)" required />
          <button className={button}>Set password</button>
        </form>
      )}
      {step === "signin" && (
        <form action={signIn} className="space-y-3">
          <input suppressHydrationWarning className={input} name="email" type="email" autoComplete="username" placeholder="Email" defaultValue={email} required />
          <input suppressHydrationWarning className={input} name="password" type="password" autoComplete="current-password" placeholder="Password" required />
          <button className={button}>Sign in</button>
          <a className="block text-center text-sm text-brand-500 hover:underline" href="/signin?step=forgot">Forgot password or first sign-in</a>
        </form>
      )}
    </Frame>
  );
}
