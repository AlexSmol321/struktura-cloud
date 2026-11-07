const form = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const submit = document.getElementById('login-submit');
const errorBox = document.getElementById('login-error');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

async function login() {
  clearError();
  submit.disabled = true;
  submit.textContent = 'Вход…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || 'Не удалось войти');
      return;
    }
    location.replace('/');
  } catch {
    showError('Сервер недоступен. Проверьте подключение.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  login();
});

document.querySelectorAll('[data-demo]').forEach((button) => {
  button.addEventListener('click', () => {
    const role = button.dataset.demo;
    emailInput.value = role === 'owner' ? 'owner@demo.ru' : 'partner@demo.ru';
    passwordInput.value = 'demo1234';
    login();
  });
});
