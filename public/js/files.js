// Облачное хранилище: данные и сессия на сервере.

export const isDesktop = () => false;

export function getStorageLabel() {
  return 'облако · данные на сервере';
}

export async function loadPersisted() {
  const res = await fetch('/api/state', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  if (res.status === 401) {
    location.replace('/login');
    return null;
  }
  if (!res.ok) throw new Error('Не удалось загрузить данные с сервера');
  const data = await res.json();
  window.__WEB_USER__ = data.user;
  document.body.classList.toggle('web-readonly', !!data.user.readOnly);
  return data.state;
}

export async function persist(state) {
  if (window.__WEB_USER__?.readOnly) return true;
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    if (res.status === 401) {
      location.replace('/login');
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveBinary(bytes, filename) {
  const blob = new Blob([bytes], {
    type: filename.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

export async function saveText(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

export async function openTextFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await file.text());
    };
    input.click();
  });
}

export async function openExternal(url) {
  window.open(url, '_blank', 'noopener');
}
