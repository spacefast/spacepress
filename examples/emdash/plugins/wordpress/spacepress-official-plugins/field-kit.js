/** Native SCF enhancement: the persisted value remains a normal JSON textarea. */
function enhanceTags() {
  for (const textarea of document.querySelectorAll('.acf-field[data-name="sp_tags"] textarea')) {
    if (textarea.dataset.tagsEnhanced) continue;
    textarea.dataset.tagsEnhanced = '1';
    const widget = document.createElement('div');
    const chips = document.createElement('div');
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Add a tag and press Enter'; input.setAttribute('aria-label', 'New tag');
    let tags;
    try { tags = JSON.parse(textarea.value || '[]'); } catch { continue; }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) continue;
    function render() {
      chips.replaceChildren();
      for (const tag of tags) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button'; button.textContent = `${tag} ×`; button.setAttribute('aria-label', `Remove ${tag}`);
        button.addEventListener('click', () => { tags = tags.filter((item) => item !== tag); save(); }); chips.append(button, document.createTextNode(' '));
      }
    }
    function save() { textarea.value = JSON.stringify(tags); textarea.dispatchEvent(new Event('change', { bubbles: true })); render(); }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault(); const tag = input.value.trim();
        if (tag && !tags.includes(tag)) { tags.push(tag); save(); } input.value = '';
      } else if (event.key === 'Backspace' && input.value === '') { tags.pop(); save(); }
    });
    widget.append(chips, input); textarea.before(widget); textarea.hidden = true; render();
  }
}
document.addEventListener('DOMContentLoaded', enhanceTags);
if (window.acf) { window.acf.addAction('ready', enhanceTags); window.acf.addAction('append', enhanceTags); }
