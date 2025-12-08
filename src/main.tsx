import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initPWA } from "./lib/pwaRegistration";

// Initialize PWA features
initPWA();

createRoot(document.getElementById("root")!).render(<App />);
