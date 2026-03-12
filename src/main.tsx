import React from "react";
import ReactDOM from "react-dom/client";
import "./main.css";
import "@radix-ui/themes/styles.css";

import { QueryClient } from "@tanstack/react-query";
import App from "./App";
import { EveFrontierProvider } from "@evefrontier/dapp-kit";
import { Theme } from "@radix-ui/themes";
import { registerSlushWallet } from "@mysten/slush-wallet";

// Register EVE Vault as a popup wallet using the same DappPostMessageChannel
// protocol as Slush — EVE Vault is built on the same Mysten stack and supports it.
registerSlushWallet("EVE Vault", {
  origin: "https://test.evevault.evefrontier.com",
});

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
