import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppRouter } from './api/transport';
import { AuthProvider } from './state/AuthContext';
import { OfflineProvider } from './state/OfflineContext';
import { ToastProvider } from './state/ToastContext';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing');

createRoot(root).render(
  <StrictMode>
    <AppRouter>
      <ToastProvider>
        <AuthProvider>
          <OfflineProvider>
            <App />
          </OfflineProvider>
        </AuthProvider>
      </ToastProvider>
    </AppRouter>
  </StrictMode>
);

// Register the service worker so the application keeps working with poor or no
// connectivity. Registration failure is non-fatal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell unavailable - the app still runs online */
    });
  });
}
