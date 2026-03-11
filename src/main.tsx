import React from "react";
import ReactDOM from "react-dom/client";
import "./main.css";
import "@radix-ui/themes/styles.css";

import { QueryClient } from "@tanstack/react-query";
import App from "./App";
import { EveFrontierProvider } from "@evefrontier/dapp-kit";
import { Theme } from "@radix-ui/themes";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Theme appearance="dark" accentColor="orange" grayColor="sand">
      <EveFrontierProvider queryClient={queryClient}>
        <App />
      </EveFrontierProvider>
    </Theme>
  </React.StrictMode>,
);
