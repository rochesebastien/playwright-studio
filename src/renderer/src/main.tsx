import React from 'react';
import { createRoot } from 'react-dom/client';
// Police Bricolage Grotesque auto-hébergée (aucune ressource externe au runtime).
import '@fontsource-variable/bricolage-grotesque';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Élément racine #root introuvable dans index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
