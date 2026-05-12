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
import StudiesPage from "@/pages/studies";
import ParkingStudyPage from "@/pages/studies-parking";
import WarrantsStudyPage from "@/pages/studies-warrants";
import SightDistanceStudyPage from "@/pages/studies-sight";
import QueuingStudyPage from "@/pages/studies-queuing";
import RoadDietStudyPage from "@/pages/studies-road-diet";
import MonitoringPage from "@/pages/monitoring";
import LegalTermsPage from "@/pages/legal-terms";
import LegalPrivacyPage from "@/pages/legal-privacy";
import LegalDisclaimerPage from "@/pages/legal-disclaimer";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/auth-forgot";
import ResetPasswordPage from "@/pages/auth-reset";
import { DevAuthWidget } from "@/components/dev-auth-widget";
import { SiteNav } from "@/components/site-nav";
import { CookieBanner } from "@/components/cookie-banner";
import ProfileSettingsPage from "@/pages/settings-profile";
import AboutPage from "@/pages/about";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/for-firms" component={ForFirmsPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/auth/forgot" component={ForgotPasswordPage} />
      <Route path="/auth/reset" component={ResetPasswordPage} />
      <Route path="/studies" component={StudiesPage} />
      <Route path="/studies/parking" component={ParkingStudyPage} />
      <Route path="/studies/warrants" component={WarrantsStudyPage} />
      <Route path="/studies/sight-distance" component={SightDistanceStudyPage} />
      <Route path="/studies/queuing" component={QueuingStudyPage} />
      <Route path="/studies/road-diet" component={RoadDietStudyPage} />
      <Route path="/monitoring" component={MonitoringPage} />
      <Route path="/legal/terms" component={LegalTermsPage} />
      <Route path="/legal/privacy" component={LegalPrivacyPage} />
      <Route path="/legal/disclaimer" component={LegalDisclaimerPage} />
      <Route path="/tis" component={TisPage} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/:id" component={ProjectDetailPage} />
      <Route path="/settings/billing" component={SettingsBillingPage} />
      <Route path="/settings/firm" component={SettingsFirmPage} />
      <Route path="/settings/profile" component={ProfileSettingsPage} />
      <Route path="/about" component={AboutPage} />
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
          <SiteNav />
          <Router />
          <CookieBanner />
          <DevAuthWidget />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
