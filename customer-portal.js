(function () {
  'use strict';

  function filePayload(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Choose a JPG, PNG, or PDF document.'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('The file must be 5 MB or smaller.'));
      if (['image/jpeg', 'image/png', 'application/pdf'].indexOf(file.type) < 0) return reject(new Error('The file must be JPG, PNG, or PDF.'));
      var reader = new FileReader();
      reader.onload = function () { resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result || '') }); };
      reader.onerror = function () { reject(new Error('The selected document could not be read.')); };
      reader.readAsDataURL(file);
    });
  }

  var form = document.querySelector('[data-customer-document-upload]');
  if (!form) return;
  var status = form.querySelector('[data-document-upload-status]');
  var button = form.querySelector('button[type="submit"]');
  function show(text, error) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('err', !!error);
  }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (button && button.disabled) return;
    var input = form.elements.documentFile;
    try {
      if (button) { button.disabled = true; button.textContent = 'Uploading...'; }
      show('Encrypting the connection and uploading your document...');
      var values = new FormData(form);
      var payload = {
        type: values.get('type'),
        provider: values.get('provider'),
        reference: values.get('reference'),
        expires: values.get('expires'),
        notes: values.get('notes'),
        file: await filePayload(input && input.files && input.files[0])
      };
      var response = await fetch('/customer/document-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok || result.ok === false) throw new Error(result.error || 'The document could not be uploaded.');
      show(result.message || 'Document uploaded securely.');
      window.setTimeout(function () { window.location.href = '/customer#portal-documents'; }, 450);
    } catch (error) {
      show(error.message || 'The document could not be uploaded.', true);
      if (button) { button.disabled = false; button.textContent = 'Upload securely'; }
    }
  });
})();
