const endpoint = new URL('/wp-json/first-plugins/v1/', location.origin);
const message = (container, text) => { container.textContent = text; };
async function api(path, options) {
  const response = await fetch(new URL(path, endpoint), options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || 'The request failed.');
  return value;
}
function isVisible(field, values) {
  if (!field.condition) return true;
  const value = values.get(field.condition.field) || '';
  switch (field.condition.op) {
    case 'eq': return value === field.condition.value;
    case 'neq': return value !== field.condition.value;
    case 'filled': return value !== '';
    case 'empty': return value === '';
    default: return false;
  }
}
async function renderForm(container) {
  const definition = await api(`forms/${container.dataset.formId}/definition`);
  const form = document.createElement('form');
  const title = document.createElement('h3'); title.textContent = definition.name; form.append(title);
  const pages = [];
  const controls = [];
  for (const [pageIndex, page] of definition.pages.entries()) {
    const fieldset = document.createElement('fieldset');
    if (page.title) { const legend = document.createElement('legend'); legend.textContent = page.title; fieldset.append(legend); }
    for (const field of page.fields) {
      const grouped = ['radio', 'checkbox-group'].includes(field.type);
      const label = document.createElement(grouped ? 'div' : 'label'); label.textContent = field.label;
      if (grouped) { label.setAttribute('role', 'group'); label.setAttribute('aria-label', field.label); }
      if (field.type === 'hidden') label.style.display = 'none';
      const fields = [];
      const inputType = field.type === 'checkbox-group' ? 'checkbox' : field.type;
      if (['radio', 'checkbox-group'].includes(field.type)) {
        for (const option of field.options || []) {
          const choice = document.createElement('label');
          const input = document.createElement('input'); input.type = inputType; input.name = field.name; input.value = option.value;
          choice.append(input, document.createTextNode(option.label)); label.append(choice); fields.push(input);
        }
      } else {
        const input = document.createElement(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
        if (input instanceof HTMLInputElement) input.type = field.type;
        input.name = field.name;
        for (const option of field.options || []) {
          const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; input.append(element);
        }
        if (field.defaultValue !== undefined) input.value = field.defaultValue;
        if (field.placeholder) input.placeholder = field.placeholder;
        for (const [key, value] of Object.entries(field.validation || {})) {
          if (['minLength', 'maxLength', 'min', 'max', 'pattern', 'accept'].includes(key)) input.setAttribute(key, String(value));
        }
        input.required = Boolean(field.required); label.append(input); fields.push(input);
      }
      controls.push({ field, label, inputs: fields, pageIndex }); fieldset.append(label);
    }
    pages.push(fieldset); form.append(fieldset);
  }
  let pageIndex = 0;
  const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = definition.settings.prevLabel || 'Previous';
  const next = document.createElement('button'); next.type = 'button'; next.textContent = definition.settings.nextLabel || 'Next';
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = definition.settings.submitLabel || 'Send';
  const feedback = document.createElement('p'); feedback.className = 'form-message'; feedback.setAttribute('aria-live', 'polite');
  const honeypot = document.createElement('input'); honeypot.name = 'website'; honeypot.tabIndex = -1; honeypot.className = 'honeypot'; honeypot.autocomplete = 'off'; honeypot.setAttribute('aria-label', 'Leave this field empty');
  form.append(honeypot, previous, next, submit, feedback); container.append(form);
  function refresh() {
    const values = new FormData(form);
    pages.forEach((page, index) => { page.hidden = index !== pageIndex; });
    controls.forEach(({ field, label, inputs, pageIndex: owner }) => {
      const visible = isVisible(field, values); label.hidden = !visible;
      inputs.forEach((input) => { input.disabled = !visible; input.required = visible && owner === pageIndex && Boolean(field.required) && field.type !== 'checkbox-group'; });
    });
    previous.hidden = pageIndex === 0; next.hidden = pageIndex === pages.length - 1; submit.hidden = !next.hidden;
  }
  previous.addEventListener('click', () => { pageIndex--; refresh(); });
  next.addEventListener('click', () => { if (form.reportValidity()) { pageIndex++; refresh(); } });
  form.addEventListener('input', refresh);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); submit.disabled = true;
    try {
      const raw = new FormData(form); const data = {}; const body = new FormData();
      for (const { field, label, inputs } of controls) {
        if (label.hidden) continue;
        if (field.type === 'file') { const file = inputs[0].files[0]; if (file) body.set(field.name, file); }
        else if (field.type === 'checkbox-group') data[field.name] = raw.getAll(field.name);
        else if (field.type === 'checkbox') data[field.name] = inputs[0].checked;
        else data[field.name] = raw.get(field.name) || '';
      }
      body.set('data', JSON.stringify(data)); body.set('website', raw.get('website') || '');
      const result = await api(`forms/${definition.id}/submit`, { method: 'POST', body });
      message(feedback, result.message); form.reset(); pageIndex = 0; refresh();
    } catch (error) { message(feedback, error.message); }
    finally { submit.disabled = false; }
  });
  refresh();
}
for (const container of document.querySelectorAll('.public-form')) renderForm(container).catch((error) => message(container, error.message));
document.querySelector('#search')?.addEventListener('submit', async (event) => {
  event.preventDefault(); const output = document.querySelector('#search-results');
  try {
    const result = await api(`search?q=${encodeURIComponent(new FormData(event.target).get('q'))}`);
    output.replaceChildren();
    for (const item of result.results) { const link = document.createElement('a'); link.href = item.url; link.textContent = item.title; output.append(link, document.createElement('br')); }
    if (!result.results.length) message(output, 'No stories found.');
  } catch (error) { message(output, error.message); }
});
