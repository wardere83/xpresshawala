import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { AppLock } from './native/AppLock'
import { NativeShell } from './native/NativeShell'
import { isNative } from './native/capabilities'
import { I18nProvider } from './i18n/I18nProvider'
import { AccountDataProvider } from './state/AccountDataProvider'
import { TransferProvider } from './state/TransferProvider'
import { AuthProvider } from './auth/AuthProvider'
import { Login, RequireAuth, Register, ForgotPassword, ResetPassword, DeleteAccount } from './auth/AuthScreens'
import { Privacy, Support as LegalSupport } from './marketing/Legal'

const AdminConsole = lazy(() => import('./admin/AdminConsole').then(module => ({ default: module.AdminConsole })))

const InviteAccept = lazy(() => import('./admin/InviteAccept').then(module => ({ default: module.InviteAccept })))

const StaffPasswordReset = lazy(() => import('./admin/StaffPasswordReset').then(module => ({ default: module.StaffPasswordReset })))

const Marketing = lazy(() => import('./marketing/Marketing').then(module => ({ default: module.Marketing })))

const Company = lazy(() => import('./marketing/Company').then(module => ({ default: module.Company })))
const Compliance = lazy(() => import('./marketing/Company').then(module => ({ default: module.Compliance })))
const Philanthropy = lazy(() => import('./marketing/Philanthropy').then(module => ({ default: module.Philanthropy })))
const Security = lazy(() => import('./marketing/Company').then(module => ({ default: module.Security })))

const Home = lazy(() => import('./screens/Home').then(module => ({ default: module.Home })))

const Voice = lazy(() => import('./screens/Voice').then(module => ({ default: module.Voice })))

const Assistant = lazy(() => import('./screens/Assistant').then(module => ({ default: module.Assistant })))

const SendMoney = lazy(() => import('./screens/SendMoney').then(module => ({ default: module.SendMoney })))

const Review = lazy(() => import('./screens/Review').then(module => ({ default: module.Review })))

const Success = lazy(() => import('./screens/Success').then(module => ({ default: module.Success })))

const Recipients = lazy(() => import('./screens/Recipients').then(module => ({ default: module.Recipients })))

const Activity = lazy(() => import('./screens/Activity').then(module => ({ default: module.Activity })))

const Profile = lazy(() => import('./screens/Profile').then(module => ({ default: module.Profile })))

const Help = lazy(() => import('./screens/Info').then(module => ({ default: module.Help })))
const Rates = lazy(() => import('./screens/Info').then(module => ({ default: module.Rates })))
const Refer = lazy(() => import('./screens/Info').then(module => ({ default: module.Refer })))
const Support = lazy(() => import('./screens/Info').then(module => ({ default: module.Support })))

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AccountDataProvider>
        <TransferProvider>
          <HashRouter>
            <NativeShell />
            <Suspense fallback={<div role="status" className="grid min-h-dvh place-items-center bg-canvas">Loading XpressTend…</div>}>
            <Routes>
              {/* Public shopfront and the way in. */}
              <Route path="/" element={isNative ? <Navigate to="/app" replace /> : <Marketing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password/:token" element={<ResetPassword />} />
              {/* Public instructions; DeleteAccount locks its authenticated content. */}
              <Route path="/delete-account" element={<DeleteAccount />} />
              {/* Apple requires both of these to be reachable before an app can
                  be submitted for review. */}
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/support" element={<LegalSupport />} />
              {/* The company as an institution: what a partner, a bank's
                  onboarding team or an examiner opens before anything else. */}
              <Route path="/company" element={<Company />} />
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/security" element={<Security />} />
              <Route path="/philanthropy" element={<Philanthropy />} />
              {/* The former partnerships address; old links land on philanthropy. */}
              <Route path="/partners" element={<Navigate to="/philanthropy" replace />} />

              {/* Staff console — its own login, never the customer session. */}
              <Route path="/admin" element={<AdminConsole />} />
              <Route path="/invite/:token" element={<InviteAccept />} />
              <Route path="/staff/reset/:token" element={<StaffPasswordReset />} />

              {/* The product. */}
              {/* Real sessions and the explicitly selected local explore mode
                  share the same product screens. */}
              <Route element={<RequireAuth><AppLock><AppLayout /></AppLock></RequireAuth>}>
                <Route path="/app" element={<Home />} />
                <Route path="voice" element={<Voice />} />
                <Route path="assistant" element={<Assistant />} />
                <Route path="send" element={<SendMoney />} />
                <Route path="review" element={<Review />} />
                <Route path="success" element={<Success />} />
                <Route path="recipients" element={<Recipients />} />
                <Route path="activity" element={<Activity />} />
                <Route path="profile" element={<Profile />} />
                <Route path="rates" element={<Rates />} />
                <Route path="help" element={<Help />} />
                <Route path="refer" element={<Refer />} />
                <Route path="support" element={<Support />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </HashRouter>
        </TransferProvider>
        </AccountDataProvider>
      </AuthProvider>
    </I18nProvider>
  )
}
