export function SignInPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-court-700 text-white">
      <div className="w-full max-w-sm rounded-2xl bg-white text-court-900 p-6 shadow-xl">
        <h1 className="text-xl font-bold mb-1">Badminton ELO</h1>
        <p className="text-sm text-gray-600 mb-4">
          Sign in with your email to track your matches.
        </p>
        <p className="text-xs text-gray-500">Auth UI to be wired to Supabase.</p>
      </div>
    </div>
  );
}
