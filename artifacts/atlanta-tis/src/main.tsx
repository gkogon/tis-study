import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTheme } from "./lib/theme";

installTheme();

createRoot(document.getElementById("root")!).render(<App />);
