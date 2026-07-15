(function(){
  'use strict';

  function one(selector, root){ return (root || document).querySelector(selector); }
  function all(selector, root){ return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function message(text, error){
    var boxes = all('[data-form-message]');
    boxes.forEach(function(box){ box.textContent = text || ''; box.classList.toggle('error', !!error); if(box.classList.contains('floating-message')) box.style.display = text ? 'block' : 'none'; });
  }
  async function request(url, payload){
    document.body.classList.add('busy');
    try{
      var response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify(payload || {}) });
      var data = await response.json().catch(function(){ return {}; });
      if(!response.ok || data.ok === false) throw new Error(data.error || 'That step could not be saved.');
      return data;
    } finally { document.body.classList.remove('busy'); }
  }
  function values(form){
    var data = {};
    new FormData(form).forEach(function(value, key){
      if(value instanceof File) return;
      data[key] = value;
    });
    all('input[type="checkbox"]', form).forEach(function(input){ data[input.name] = input.checked; });
    return data;
  }
  function normalizePhone(value){ return String(value || '').replace(/\D/g, '').slice(-10); }
  function passwordValid(password){ return String(password || '').length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password); }
  function filePayload(file){
    return new Promise(function(resolve, reject){
      if(!file){ reject(new Error('Choose every required document.')); return; }
      if(file.size > 5 * 1024 * 1024){ reject(new Error(file.name + ' is larger than 5 MB.')); return; }
      if(['image/jpeg','image/png','application/pdf'].indexOf(file.type) < 0){ reject(new Error(file.name + ' must be JPG, PNG, or PDF.')); return; }
      var reader = new FileReader();
      reader.onload = function(){ resolve({ name:file.name, type:file.type, size:file.size, dataUrl:String(reader.result || '') }); };
      reader.onerror = function(){ reject(new Error(file.name + ' could not be read.')); };
      reader.readAsDataURL(file);
    });
  }
  function onboardingToken(){ var shell = one('[data-onboarding-token]'); return shell && shell.getAttribute('data-onboarding-token') || ''; }
  function reloadSoon(){ window.setTimeout(function(){ window.location.reload(); }, 450); }

  var menu = one('[data-site-menu]');
  if(menu) menu.addEventListener('click', function(){ one('.site-header').classList.toggle('open'); });

  var search = one('[data-inventory-search]');
  if(search){
    search.addEventListener('input', function(){
      var words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean), shown = 0;
      all('.vehicle-card', one('[data-inventory-grid]')).forEach(function(card){
        var match = !words.length || words.every(function(word){ return card.textContent.toLowerCase().indexOf(word) >= 0; });
        card.style.display = match ? '' : 'none';
        if(match) shown += 1;
      });
      var count = one('[data-inventory-count]'); if(count) count.textContent = shown;
    });
  }

  var applicationForm = one('#nativeApplicationForm');
  if(applicationForm){
    applicationForm.addEventListener('submit', async function(event){
      event.preventDefault(); message('');
      var payload = values(applicationForm);
      payload.phone = normalizePhone(payload.phone);
      payload.name = [payload.firstName, payload.lastName].filter(Boolean).join(' ').trim();
      payload.applicationConsent = !!payload.applicationConsent;
      if(payload.phone.length !== 10){ message('Enter a valid 10-digit mobile phone number.', true); return; }
      if(payload.password !== payload.confirmPassword){ message('The two passwords do not match.', true); return; }
      if(!passwordValid(payload.password)){ message('Password must contain at least eight characters, including a letter and number.', true); return; }
      delete payload.confirmPassword;
      try{
        var result = await request('/api/public/applications', payload);
        applicationForm.innerHTML = '<div class="form-title"><span>Application received</span><h2>Thank you, ' + String(payload.firstName || '').replace(/[<>]/g,'') + '.</h2><p>Your application for ' + String(result.application && result.application.vehicle || 'this vehicle').replace(/[<>]/g,'') + ' is now in staff review. No payment has been charged. WheelsonAuto will send your secure onboarding link after approval.</p></div><a class="button primary wide" href="/customer/login">Customer login</a>';
        window.scrollTo({top:applicationForm.offsetTop - 90, behavior:'smooth'});
      }catch(error){ message(error.message, true); }
    });
  }

  all('[data-signature-pad]').forEach(function(canvas){
    var context = canvas.getContext('2d'), drawing = false, last = null;
    context.lineWidth = 4; context.lineCap = 'round'; context.strokeStyle = '#151515';
    function point(event){
      var rect = canvas.getBoundingClientRect(), source = event.touches && event.touches[0] || event;
      return { x:(source.clientX - rect.left) * canvas.width / rect.width, y:(source.clientY - rect.top) * canvas.height / rect.height };
    }
    function start(event){ event.preventDefault(); drawing = true; last = point(event); canvas.dataset.signed = '1'; }
    function move(event){ if(!drawing) return; event.preventDefault(); var next = point(event); context.beginPath(); context.moveTo(last.x,last.y); context.lineTo(next.x,next.y); context.stroke(); last = next; }
    function end(){ drawing = false; last = null; var hidden = one('[data-signature-data]', canvas.closest('form')); if(hidden) hidden.value = canvas.toDataURL('image/png'); }
    canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); window.addEventListener('pointerup', end);
    canvas.addEventListener('touchstart', start, {passive:false}); canvas.addEventListener('touchmove', move, {passive:false}); canvas.addEventListener('touchend', end);
    var clear = one('[data-clear-signature]', canvas.parentNode);
    if(clear) clear.addEventListener('click', function(){ context.clearRect(0,0,canvas.width,canvas.height); canvas.dataset.signed=''; var hidden=one('[data-signature-data]',canvas.closest('form')); if(hidden) hidden.value=''; });
  });

  all('form[data-onboarding-form]').forEach(function(form){
    form.addEventListener('submit', async function(event){
      event.preventDefault(); message('');
      var token = onboardingToken(), kind = form.getAttribute('data-onboarding-form'), payload = values(form), url = '/api/public/onboarding/' + encodeURIComponent(token) + '/' + kind;
      try{
        if(kind === 'documents'){
          payload.documents = await Promise.all(['driver_license_front','driver_license_back','insurance'].map(async function(name){
            var input = form.elements[name], document = await filePayload(input && input.files && input.files[0]); document.kind = name; return document;
          }));
        }
        if(kind === 'signature'){
          var canvas = one('[data-signature-pad]', form), hidden = one('[data-signature-data]', form);
          if(!canvas || canvas.dataset.signed !== '1' || !hidden.value){ throw new Error('Draw your complete signature before signing.'); }
          payload.signatureData = hidden.value;
        }
        var result = await request(url, payload);
        if(result.redirectUrl){ window.location.href = result.redirectUrl; return; }
        message(result.message || 'Saved securely.'); reloadSoon();
      }catch(error){ message(error.message, true); }
    });
  });
})();
