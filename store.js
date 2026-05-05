/**Store interface — delegates to the active shell transport.
 *
 * Object stores:
 *   posts_index  — key: path, indexes: section, date, tags (multiEntry)
 *   search_corpus — key: path
 *   user_state   — key: string (e.g. "prefs")
 */
import {
  storeOpen, storePut, storeGet, storeGetAll,
  storeQueryByIndex, getMeta as _getMeta, setMeta as _setMeta,
} from './transport.js';

export const open = storeOpen;
export const put = storePut;
export const get = storeGet;
export const getAll = storeGetAll;
export const queryByIndex = storeQueryByIndex;
export const getMeta = _getMeta;
export const setMeta = _setMeta;
