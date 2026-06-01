/**Input element — text, email, textarea with label binding.*/

let _idCounter = 0;

export function createInput({ label, type = 'text', name, hint, required = false } = {}) {
  if (!label) throw new Error('Input requires a label');
  if (!name) throw new Error('Input requires a name');

  const id = `el-input-${++_idCounter}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'el-input-group';

  const labelEl = document.createElement('label');
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  wrapper.appendChild(labelEl);

  let inputEl;
  if (type === 'textarea') {
    inputEl = document.createElement('textarea');
  } else {
    inputEl = document.createElement('input');
    inputEl.type = type;
  }
  inputEl.id = id;
  inputEl.name = name;
  inputEl.className = 'el-input';
  if (required) inputEl.required = true;

  if (hint) {
    const hintId = id + '-hint';
    const hintEl = document.createElement('span');
    hintEl.id = hintId;
    hintEl.className = 'el-input-hint';
    hintEl.textContent = hint;
    inputEl.setAttribute('aria-describedby', hintId);
    wrapper.appendChild(inputEl);
    wrapper.appendChild(hintEl);
  } else {
    wrapper.appendChild(inputEl);
  }

  return wrapper;
}
