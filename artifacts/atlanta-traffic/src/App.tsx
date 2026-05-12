import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Tomorrow from "@/pages/tomorrow";
import LiveTraffic from "@/pages/live-traffic";
import Backtest from "@/pages/backtest";
import Pitch from "@/pages/pitch";
import ExecSummary from "@/pages/exec-summary";
import Parking from "@/pages/parking";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/tomorrow" component={Tomorrow} />
      <Route path="/live-traffic" component={LiveTraffic} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/pitch" component={Pitch} />
      <Route path="/exec-summary" component={ExecSummary} />
      <Route path="/parking" component={Parking} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
