import { useState } from 'react';
import '../components_css/SearchBar.css';

export default function SearchBar({ onSelectLocation }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Uses OpenStreetMap's free Nominatim geocoder. Swap for your own
  // /api endpoint later if you want search results scoped to your service area.
  const runSearch = async (q) => {
    setQuery(q);
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePick = (r) => {
    onSelectLocation({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name });
    setQuery(r.display_name);
    setResults([]);
  };

  return (
    <div className="search-wrap">
      <div className="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder={loading ? 'Searching…' : 'Search a place or address'}
        />
      </div>
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <div key={r.place_id} className="search-result" onClick={() => handlePick(r)}>
              {r.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}