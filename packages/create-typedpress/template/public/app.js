const status = document.getElementById('status');
const notes = document.getElementById('notes');
try {
  const response = await fetch('/wp-json/typedpress/v1/notes');
  if (!response.ok) throw new Error(`The API returned ${response.status}.`);
  const { data } = await response.json();
  if (!Array.isArray(data)) throw new Error('The API returned an unexpected response.');
  status.textContent = data.length ? '' : 'Your first note starts in WordPress. Click “Write a note” to add one.';
  for (const note of data) {
    const article = document.createElement('article');
    const title = document.createElement('h2');
    const body = document.createElement('p');
    title.textContent = note.title;
    body.textContent = note.body;
    article.append(title, body);
    notes.append(article);
  }
} catch (error) {
  status.textContent = `Could not load notes. ${error.message} Check the terminal running TypedPress, then refresh.`;
}
