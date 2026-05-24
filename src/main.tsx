import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';

// Dark mode is the only mode now — index.html stamps `class="dark"`
// on <html> directly. Clean up any leftover preference from when the
// theme toggle existed.
try {
  localStorage.removeItem('badminton-elo-theme');
} catch {
  // ignore (private mode / disabled storage)
}

// Single QueryClient for the whole app. Defaults tuned for a chatty
// realtime club app:
//   * staleTime 30s — most data is fresh enough for that window;
//     anything mutated invalidates immediately via the mutation hooks
//   * refetchOnWindowFocus true — picks up changes when you tab back
//   * retry 1 — Supabase errors usually aren't transient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
