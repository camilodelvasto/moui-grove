/**RSS background check + incremental fetch.
 *
 * Flow:
 * 1. Fetch feed XML via transport
 * 2. Compare pubDate against last_feed_check in store
 * 3. For each new entry: fetch HTML page, cache via transport, update posts_index
 */
import { fetchFeed, fetchPage, cachePage, storePut, getMeta, setMeta } from './transport.js';

export async function init() {
  setTimeout(() => _checkFeed(), 3000);
}

async function _checkFeed() {
  const text = await fetchFeed();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const items = doc.querySelectorAll('item');

  const lastCheckRaw = await getMeta('last_feed_check');
  // First check: 0 means all items are new
  const lastCheck = lastCheckRaw === undefined ? 0 : lastCheckRaw;
  const newPosts = [];

  items.forEach(item => {
    const pubDate = item.querySelector('pubDate');
    const link = item.querySelector('link');
    const title = item.querySelector('title');

    if (!pubDate || !link || !title) {
      // Skip malformed entries — required fields missing
      return;
    }

    const timestamp = new Date(pubDate.textContent).getTime();
    if (timestamp > lastCheck) {
      newPosts.push({
        url: link.textContent,
        title: title.textContent,
        date: pubDate.textContent,
      });
    }
  });

  if (newPosts.length === 0) return;

  for (const post of newPosts) {
    await _fetchAndCache(post);
  }

  await setMeta('last_feed_check', Date.now());
}

async function _fetchAndCache(post) {
  let url;
  try {
    url = new URL(post.url).pathname;
  } catch (e) {
    console.error('Malformed feed entry URL, skipping:', post.url);
    return;
  }

  const response = await fetchPage(url);
  if (!response.ok) {
    console.error('Feed entry fetch failed:', url);
    return;
  }

  await cachePage(url, response);

  const path = url.replace(/^\//, '').replace(/\/index\.html$/, '').replace(/\/$/, '');
  const entry = {
    path,
    title: post.title,
    date: post.date,
    section: path.includes('/') ? path.split('/')[0] : '',
  };
  // tags and excerpt unavailable from RSS — omitted rather than faking empty values
  await storePut('posts_index', entry);
}
