import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffApp } from './StaffApp';
import './staff-next.css';

const root = document.getElementById('staff-next-root');
if (!root) throw new Error('WheelsonAuto staff root was not found.');

createRoot(root).render(<StrictMode><StaffApp /></StrictMode>);
