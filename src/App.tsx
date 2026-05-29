import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { RecordMatchPage } from './pages/RecordMatchPage';
import { NewMatchPage } from './pages/NewMatchPage';
import { EditMatchPage } from './pages/EditMatchPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';
import { ShopPage } from './pages/ShopPage';
import { PetSpacesPage } from './pages/PetSpacesPage';
import { ScoringGuidePage } from './pages/ScoringGuidePage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { RequireAuth } from './lib/auth';

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/record" element={<RecordMatchPage />} />
        <Route path="/record/new" element={<NewMatchPage />} />
        <Route path="/record/:matchId/edit" element={<EditMatchPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/pets" element={<PetSpacesPage />} />
        <Route path="/scoring-guide" element={<ScoringGuidePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
