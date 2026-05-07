import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
