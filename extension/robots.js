/**
 * robots.txt, read the way a polite crawler reads it. Shared by the
 * extension (which does the fetching) and by Desk (for the proxy route).
 *
 * Groups are matched by product token; the most specific matching group
 * wins, else `*`. Within a group the longest matching rule wins, and Allow
 * beats Disallow on a tie. `*` and `$` wildcards are honoured.
 */

/** The token Desk identifies as. */
export const AGENT = 'DeskReader';

/**
 * @param {string} text
 * @returns {{ agents: string[], rules: { allow: boolean, path: string }[] }[]}
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) {
        // "Disallow:" with no path allows everything.
        if (key === 'disallow' && !value) continue;
        current.rules.push({ allow: key === 'allow', path: value });
      }
    }
  }
  return groups;
}

function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

/**
 * @param {ReturnType<typeof parseRobots>} groups
 * @param {string} pathWithQuery
 * @param {string} [agent]
 */
export function isAllowed(groups, pathWithQuery, agent = AGENT) {
  const token = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!matches(r.path, pathWithQuery)) continue;
      const len = r.path.replace(/[*$]/g, '').length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}

/** Minimum gap between requests to one host, in ms, unless robots asks for more. */
export const MIN_GAP_MS = 3000;

/** Crawl-delay for our group, in ms, if robots.txt sets one. */
export function crawlDelay(text, agent = AGENT) {
  let applies = false;
  let delay = 0;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      const a = value.toLowerCase();
      applies = (lastWasAgent && applies) || a === '*' || agent.toLowerCase().includes(a);
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (applies && key === 'crawl-delay') delay = Math.max(delay, parseFloat(value) * 1000 || 0);
    }
  }
  return delay;
}
