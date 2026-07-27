import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerApp } from './CustomerApp';
import './customer-next.css';

const root = document.getElementById('customer-next-root');
if (!root) throw new Error('WheelsonAuto customer root was not found.');

createRoot(root).render(<StrictMode><CustomerApp /></StrictMode>);

