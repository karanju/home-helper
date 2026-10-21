import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'motion/react';
// Base styles first, so component stylesheets imported by App can override them
import './index.css';
import App from './App.jsx';

// "user": with Reduce Motion on, Motion skips transform animations and keeps opacity
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>
);
