/* Carta Interactiva — Admin Panel JS */

// ─── Toast auto-hide ──────────────────────────────────────────────────────────
document.querySelectorAll('.toast').forEach(t => {
  setTimeout(() => {
    t.classList.add('toast--hiding');
    setTimeout(() => t.remove(), 420);
  }, 4000);
});

// ─── Toggle category open/closed ─────────────────────────────────────────────
function toggleCat(catId) {
  const body   = document.getElementById('cat-body-' + catId);
  const toggle = document.getElementById('cat-toggle-' + catId);
  if (!body || !toggle) return;

  const isOpen = !body.classList.contains('hidden');
  body.classList.toggle('hidden', isOpen);
  toggle.classList.toggle('collapsed', isOpen);
}

// ─── Toggle category rename form ──────────────────────────────────────────────
function toggleRename(catId) {
  const form = document.getElementById('rename-' + catId);
  if (!form) return;

  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden', !isHidden);

  if (isHidden) {
    const input = form.querySelector('input[name="name"]');
    if (input) { input.focus(); input.select(); }
  }
}

// ─── Toggle dish edit form ────────────────────────────────────────────────────
function toggleEditDish(dishId) {
  const form = document.getElementById('edit-dish-' + dishId);
  if (!form) return;

  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden', !isHidden);

  if (isHidden) {
    const input = form.querySelector('input[name="name"]');
    if (input) input.focus();
  }
}

// ─── Toggle add dish form ─────────────────────────────────────────────────────
function toggleAddDish(catId) {
  const form = document.getElementById('add-dish-' + catId);
  if (!form) return;

  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden', !isHidden);

  if (isHidden) {
    const input = form.querySelector('input[name="name"]');
    if (input) input.focus();
  }
}
