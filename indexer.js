/**Background indexer — populates store from build-generated JSON indexes.*/
import { getIndex, storePut, setMeta } from './transport.js';

export async function init() {
  await _indexFirstLoad();
  _indexSearchCorpus();
}

async function _indexFirstLoad() {
  const posts = await getIndex('first-load');
  for (const post of posts) {
    // IDB keyPath is 'path'; index JSON uses 'url_path'.
    const entry = {
      path: post.url_path.replace(/^\//, '').replace(/\/$/, ''),
      title: post.title,
      date: post.publish_date,
      section: post.content_path.includes('/') ? post.content_path.split('/')[0] : '',
      tags: post.tags,
      excerpt: post.excerpt,
    };
    await storePut('posts_index', entry);
  }
}

async function _indexSearchCorpus() {
  const entries = await getIndex('search');
  for (const entry of entries) {
    await storePut('search_corpus', entry);
  }
  await setMeta('index_version', Date.now());
}
