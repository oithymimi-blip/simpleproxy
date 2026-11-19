import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

export default function PublicAdminPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.userSummary();
      setItems(res.items || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="ref-table-card">
      <div className="table-responsive">
        <table className="ref-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Address</th>
              <th>Referral Tag</th>
              <th>Referred By</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan="5" className="ref-table-empty">
                  Loading records…
                </td>
              </tr>
            ) : error && items.length === 0 ? (
              <tr>
                <td colSpan="5" className="ref-table-empty">
                  {error}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan="5" className="ref-table-empty">
                  No records found.
                </td>
              </tr>
            ) : (
              items.map((item, idx) => {
                const serialNo = items.length - idx;
                const displayTime = item.updatedAt || item.createdAt;
                return (
                  <tr key={item.id || `${item.referralTag}-${idx}`}>
                    <td className="ref-serial">{serialNo}</td>
                    <td className="ref-date">{formatDisplayDate(displayTime)}</td>
                    <td className="ref-address">{item.address}</td>
                    <td>
                      <span className="ref-tag-pill">{item.referralTag}</span>
                    </td>
                    <td>
                      {item.referredBy ? (
                        <span className="ref-by-address">{item.referredBy}</span>
                      ) : (
                        <span className="ref-by-direct">Direct</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDisplayDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}
