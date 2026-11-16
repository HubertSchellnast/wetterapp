// Generic bottom-sheet modal used for warnings, radar and the spread chart.
let onCloseHandler = null;

const $ = (id) => document.getElementById(id);

export function openModal(title, content, { onClose } = {}) {
  closeModal(); // run cleanup of a previous modal first
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(content);
  $('modal').hidden = false;
  onCloseHandler = onClose || null;
}

export function setModalContent(content) {
  $('modal-body').replaceChildren(content);
}

export function closeModal() {
  const modal = $('modal');
  if (modal.hidden) return;
  modal.hidden = true;
  $('modal-body').replaceChildren();
  if (onCloseHandler) {
    const fn = onCloseHandler;
    onCloseHandler = null;
    fn();
  }
}

export function isModalOpen() {
  return !$('modal').hidden;
}
