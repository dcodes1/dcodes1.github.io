/*
 * Entry for the translator UI. Loaded by the portfolio's router the first time
 * /translator is shown; mounts into #translator-root.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const el = document.getElementById('translator-root');
if (el && !el.dataset['mounted']) {
  el.dataset['mounted'] = '1';
  el.textContent = '';
  createRoot(el).render(<StrictMode><App /></StrictMode>);
}
