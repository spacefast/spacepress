import { Link, Route, Router, Routes, useAuth, useParams } from "@spacefast/zero/client";
import { Shelf } from "./Shelf";
import "./styles.css";

function ShelfPage() {
  const { shelf } = useParams<{ shelf: string }>();
  return <Shelf name={shelf} />;
}

export function App() {
  const auth = useAuth();
  return (
    <Router>
      <main>
        <header>
          <Link to="/">Shelves</Link> <span>{auth.displayName}</span>
        </header>
        <Routes>
          <Route path="/" element={<Shelf name="inbox" />} />
          <Route path="/shelves/:shelf" element={<ShelfPage />} />
        </Routes>
      </main>
    </Router>
  );
}
