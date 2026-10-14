import { requestReset, resetPassword, signIn } from "./actions";

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const button = "w-full rounded-lg bg-brand-500 px-3 py-2 font-medium text-white";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { step = "signin", error, email = "", notice } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 px-4">
      <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">TIN Command Center</h1>
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
          <a className="block text-center text-sm underline" href="/signin?step=forgot">Forgot password or first sign-in</a>
        </form>
      )}
    </main>
  );
}
