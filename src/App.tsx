import { useData, useRoute } from './lib';
import Overview from './pages/Overview';
import { IssuePage, Publications, ReadIndex, Receive } from './pages/Read';
import { Capture, DraftsIndex, PiecePage } from './pages/Drafts';
import Publish from './pages/Publish';
import SettingsPage from './pages/Settings';

const NAV = [
  { id: '', label: 'Desk' },
  { id: 'read', label: 'Read' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'publish', label: 'Publish' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const route = useRoute();
  const data = useData();
  const [head = '', sub, third] = route;

  if (!data) return <div className="boot">Opening the desk…</div>;

  let page;
  if (!head) page = <Overview data={data} />;
  else if (head === 'read') {
    if (sub === 'receive') page = <Receive data={data} />;
    else if (sub === 'publications') page = <Publications data={data} />;
    else if (sub) page = <IssuePage data={data} issueId={sub} />;
    else page = <ReadIndex data={data} />;
  } else if (head === 'drafts') {
    if (sub === 'capture') page = <Capture data={data} />;
    else if (sub && third === 'capture') page = <Capture data={data} pieceId={sub} />;
    else if (sub) page = <PiecePage data={data} pieceId={sub} />;
    else page = <DraftsIndex data={data} />;
  } else if (head === 'publish') page = <Publish data={data} tab={sub} />;
  else if (head === 'settings') page = <SettingsPage data={data} />;
  else page = <div className="boot"><h1>Not here</h1><a href="#/">Back to the desk</a></div>;

  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/">Desk</a>
        <nav>
          {NAV.slice(1).map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={head === n.id ? 'on' : ''}>{n.label}</a>
          ))}
        </nav>
      </header>
      <main className="page">{page}</main>
    </div>
  );
}
