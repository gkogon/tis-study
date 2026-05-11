import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import ForFirmsPage from "@/pages/for-firms";
import TisPage from "@/pages/tis";
import AdminPage from "@/pages/admin";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import PricingPage from "@/pages/pricing";
import SignupPage from "@/pages/signup";
import SettingsBillingPage from "@/pages/settings-billing";
import SettingsFirmPage from "@/pages/settings-firm";
import InviteAcceptPage from "@/pages/invite-accept";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/for-firms" component={ForFirmsPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/tis" component={TisPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:id" component={ProjectDetailPage} />
      <Route path="/settings/billing" component={SettingsBillingPage} />
      <Route path="/settings/firm" component={SettingsFirmPage} />
      <Route path="/invites/accept" component={InviteAcceptPage} />
      <Route path="/admin" component={AdminPage} />
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
